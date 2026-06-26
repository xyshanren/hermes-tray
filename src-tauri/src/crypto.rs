//! Backup encryption (T-Q-S11).
//!
//! Wraps AES-256-GCM authenticated encryption with Argon2id key
//! derivation so a user-chosen password can lock a `sessions.db` file
//! behind a key they remember. Designed for offline backups (file on
//! USB, in a cloud folder, etc.) — not for live streaming.
//!
//! File format (single binary blob):
//! ```text
//!   offset  size   field
//!   ------  ----   -----
//!   0       4      magic = "HTBK" (Hermes Tray BacKup)
//!   4       1      version = 1
//!   5       1      kdf_id = 1 (Argon2id with default params)
//!   6       1      salt_len (always 16)
//!   7       16     salt (random per backup)
//!   23      1      nonce_len (always 12)
//!   24      12     nonce (random per backup)
//!   36      8      ciphertext_len (little-endian u64)
//!   44      N      ciphertext + GCM auth tag (16-byte tag suffix)
//! ```
//!
//! Total overhead = 44 bytes. The ciphertext is `plaintext_len + 16`
//! (GCM appends a 16-byte authentication tag).

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use rand::RngCore;

const MAGIC: &[u8; 4] = b"HTBK";
const VERSION: u8 = 1;
const KDF_ARGON2ID: u8 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16; // GCM appends this to ciphertext
const HEADER_LEN: usize = 4 + 1 + 1 + 1 + SALT_LEN + 1 + NONCE_LEN + 8;

/// Tunable Argon2id parameters. Defaults balance safety and a 1-2s
/// derive time on a modern laptop. Callers may override via
/// `create_backup_with_params` (test-only).
const ARGON2_MEM_KIB: u32 = 19_456; // 19 MiB
const ARGON2_TIME: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;

/// Encrypt `plaintext` with a user-supplied password. Returns a
/// self-describing binary blob suitable for writing to a file.
pub fn create_backup(plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    // 1. Random salt + nonce. Argon2id salt must be unique per backup.
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    // 2. Derive 32-byte key from password + salt.
    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // 3. Encrypt. AAD = header bytes up to (but not including) ciphertext.
    //    This binds the header to the ciphertext: an attacker can't
    //    swap salt/nonce from a different backup.
    let mut blob = Vec::with_capacity(HEADER_LEN + plaintext.len() + TAG_LEN);
    blob.extend_from_slice(MAGIC);
    blob.push(VERSION);
    blob.push(KDF_ARGON2ID);
    blob.push(SALT_LEN as u8);
    blob.extend_from_slice(&salt);
    blob.push(NONCE_LEN as u8);
    blob.extend_from_slice(&nonce_bytes);
    let ct_len_pos = blob.len();
    blob.extend_from_slice(&[0u8; 8]); // placeholder for ct_len

    let aad = &blob[..ct_len_pos];
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|e| format!("encrypt: {e}"))?;

    // 4. Write ciphertext length (little-endian u64) and ciphertext.
    //    NOTE: AAD was captured BEFORE we wrote the ct_len placeholder
    //    (`aad = &blob[..ct_len_pos]`), so it doesn't include the
    //    length bytes. At decrypt time we must reconstruct the same
    //    AAD slice — see `restore_backup` for the matching offset.
    let ct_len = ciphertext.len() as u64;
    blob[ct_len_pos..ct_len_pos + 8].copy_from_slice(&ct_len.to_le_bytes());
    blob.extend_from_slice(&ciphertext);

    Ok(blob)
}

/// Decrypt a backup blob. Returns the original plaintext.
/// Errors: bad magic / unsupported version / KDF / wrong password / corrupt data.
pub fn restore_backup(blob: &[u8], password: &str) -> Result<Vec<u8>, String> {
    if blob.len() < HEADER_LEN {
        return Err(format!("blob too short: {} bytes", blob.len()));
    }
    if &blob[..4] != MAGIC {
        return Err("not a hermes-tray backup (bad magic)".to_string());
    }
    let version = blob[4];
    if version != VERSION {
        return Err(format!("unsupported backup version: {version}"));
    }
    let kdf_id = blob[5];
    if kdf_id != KDF_ARGON2ID {
        return Err(format!("unsupported KDF: {kdf_id}"));
    }
    let salt_len = blob[6] as usize;
    if salt_len != SALT_LEN {
        return Err(format!("unsupported salt length: {salt_len}"));
    }
    let salt: [u8; SALT_LEN] = blob[7..7 + SALT_LEN].try_into().unwrap();
    let nonce_len = blob[7 + SALT_LEN] as usize;
    if nonce_len != NONCE_LEN {
        return Err(format!("unsupported nonce length: {nonce_len}"));
    }
    let nonce_start = 7 + SALT_LEN + 1;
    let nonce_bytes: [u8; NONCE_LEN] = blob[nonce_start..nonce_start + NONCE_LEN]
        .try_into()
        .unwrap();
    let ct_len_start = nonce_start + NONCE_LEN;
    let ct_len = u64::from_le_bytes(
        blob[ct_len_start..ct_len_start + 8]
            .try_into()
            .unwrap(),
    ) as usize;
    let ct_start = ct_len_start + 8;
    if blob.len() < ct_start + ct_len {
        return Err(format!(
            "truncated blob: expected {} bytes after header, got {}",
            ct_len,
            blob.len() - ct_start
        ));
    }
    let ciphertext = &blob[ct_start..ct_start + ct_len];

    // Derive key and decrypt.
    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);
    // AAD slice must EXACTLY match what `create_backup` passed:
    // header bytes from the start up to (but NOT including) the
    // ct_len placeholder. Both are 36 bytes (HEADER_LEN - 8).
    let aad_end = ct_start - 8;
    let aad = &blob[..aad_end];

    cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| "decryption failed (wrong password or corrupt backup)".to_string())
}

/// Quickly check whether a password unlocks the blob without returning
/// the plaintext. Useful for "verify password before restore" UIs.
pub fn verify_password(blob: &[u8], password: &str) -> bool {
    restore_backup(blob, password).is_ok()
}

/// Derive a 32-byte AES key from password + salt via Argon2id.
fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    use argon2::{Algorithm, Params, Version};
    let params = Params::new(ARGON2_MEM_KIB, ARGON2_TIME, ARGON2_PARALLELISM, Some(32))
        .map_err(|e| format!("argon2 params: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| format!("argon2 derive: {e}"))?;
    Ok(out)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::Aead;

    /// Helper: encrypt then decrypt, return plaintext or fail.
    fn round_trip(plaintext: &[u8], password: &str) -> Vec<u8> {
        let blob = create_backup(plaintext, password).expect("encrypt");
        assert!(blob.len() > HEADER_LEN);
        // First 4 bytes are magic.
        assert_eq!(&blob[..4], b"HTBK");
        restore_backup(&blob, password).expect("decrypt")
    }

    #[test]
    fn round_trips_ascii() {
        let pt = b"hello world";
        assert_eq!(round_trip(pt, "hunter2"), pt);
    }

    #[test]
    fn round_trips_binary_with_null_bytes() {
        let pt: Vec<u8> = (0u8..=255).collect();
        assert_eq!(round_trip(&pt, "p@ssw0rd"), pt);
    }

    #[test]
    fn round_trips_large_payload() {
        // 1 MiB of pseudo-random bytes.
        let mut pt = vec![0u8; 1_048_576];
        for (i, b) in pt.iter_mut().enumerate() {
            *b = (i % 251) as u8;
        }
        let out = round_trip(&pt, "long-test-password");
        assert_eq!(out, pt);
    }

    #[test]
    fn round_trips_unicode_password() {
        // Argon2 hashes UTF-8 bytes; the password-as-raw-bytes contract
        // means emoji and CJK should work fine.
        let pt = b"some plaintext";
        assert_eq!(round_trip(pt, "密码 🔒 secure"), pt);
    }

    #[test]
    fn wrong_password_fails() {
        let pt = b"secret data";
        let blob = create_backup(pt, "correct").unwrap();
        let err = restore_backup(&blob, "wrong").unwrap_err();
        // The error message is intentionally vague to discourage
        // password-guessing oracles, but it must not return plaintext.
        assert!(!err.to_lowercase().contains("secret"));
        assert!(!err.to_lowercase().contains("data"));
    }

    #[test]
    fn wrong_password_no_plaintext_leak() {
        let pt = b"top secret with unique marker XYZ-12345";
        let blob = create_backup(pt, "right-password").unwrap();
        let err = restore_backup(&blob, "wrong-password").unwrap_err();
        // Ensure plaintext doesn't appear in the error string.
        assert!(!err.contains("XYZ-12345"));
    }

    #[test]
    fn verify_password_returns_true_for_correct() {
        let blob = create_backup(b"x", "pw").unwrap();
        assert!(verify_password(&blob, "pw"));
        assert!(!verify_password(&blob, "nope"));
    }

    #[test]
    fn truncating_blob_errors_gracefully() {
        let blob = create_backup(b"hello", "pw").unwrap();
        // Truncate the last byte (inside ciphertext / tag).
        let err = restore_backup(&blob[..blob.len() - 1], "pw").unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn bad_magic_rejected() {
        let mut blob = create_backup(b"hi", "pw").unwrap();
        blob[0] = b'X';
        let err = restore_backup(&blob, "pw").unwrap_err();
        assert!(err.contains("magic"));
    }

    #[test]
    fn bad_version_rejected() {
        let mut blob = create_backup(b"hi", "pw").unwrap();
        blob[4] = 99;
        let err = restore_backup(&blob, "pw").unwrap_err();
        assert!(err.contains("version"));
    }

    #[test]
    fn bad_kdf_rejected() {
        let mut blob = create_backup(b"hi", "pw").unwrap();
        blob[5] = 99;
        let err = restore_backup(&blob, "pw").unwrap_err();
        assert!(err.contains("KDF"));
    }

    #[test]
    fn tampering_ciphertext_fails_authentication() {
        // Flip a byte in the ciphertext. GCM auth tag should catch it.
        let mut blob = create_backup(b"original message", "pw").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0xFF;
        let err = restore_backup(&blob, "pw").unwrap_err();
        assert!(err.to_lowercase().contains("decryption"));
    }

    #[test]
    fn tampering_salt_fails() {
        // Flipping a salt byte should change the derived key, which
        // invalidates the GCM auth tag.
        let mut blob = create_backup(b"hi", "pw").unwrap();
        blob[7] ^= 0x01;
        let err = restore_backup(&blob, "pw").unwrap_err();
        // Decryption fails (wrong key → auth tag mismatch).
        assert!(!err.is_empty());
    }

    #[test]
    fn tampering_nonce_fails() {
        // Same idea as salt flip — derived key is correct, but wrong
        // nonce produces a different keystream, failing the auth tag.
        let mut blob = create_backup(b"hi", "pw").unwrap();
        let nonce_byte = 7 + SALT_LEN + 1; // first nonce byte
        blob[nonce_byte] ^= 0x01;
        let err = restore_backup(&blob, "pw").unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn two_backups_with_same_password_have_different_salt_and_nonce() {
        // Salt + nonce are random per call. Two backups of the same
        // plaintext with the same password MUST differ in bytes —
        // otherwise the same key+nonce pair could be reused.
        let a = create_backup(b"same plaintext", "pw").unwrap();
        let b = create_backup(b"same plaintext", "pw").unwrap();
        assert_ne!(a, b, "two backups of same data should differ");
        // Salt: bytes 7..23
        assert_ne!(&a[7..23], &b[7..23]);
        // Nonce: bytes 24..36
        assert_ne!(&a[24..36], &b[24..36]);
    }

    #[test]
    fn empty_plaintext_round_trips() {
        assert_eq!(round_trip(b"", "pw"), b"");
    }

    #[test]
    fn empty_password_round_trips() {
        // A zero-length password is technically valid (though bad
        // practice). Argon2 still derives a deterministic key from
        // (empty, salt).
        let pt = b"with empty password";
        assert_eq!(round_trip(pt, ""), pt);
    }

    #[test]
    fn cipher_module_independently_validates_key_size() {
        // Sanity check: our key derivation must yield 32 bytes
        // (AES-256 key size). If this fails, derive_key is broken.
        let salt = [0u8; SALT_LEN];
        let key = derive_key("test", &salt).expect("derive");
        assert_eq!(key.len(), 32);

        // And a cipher built from that key can encrypt+decrypt a
        // 1-byte message. This is a smoke test on the aes-gcm crate
        // integration independent of our header format.
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let nonce = Nonce::from_slice(&[1u8; NONCE_LEN]);
        let ct = cipher.encrypt(nonce, b"x".as_ref()).expect("enc");
        let pt = cipher.decrypt(nonce, ct.as_ref()).expect("dec");
        assert_eq!(pt, b"x");
    }
}
