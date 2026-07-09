// v0.2-alpha-9 — BackupModal (Preact JSX).
//
// Single flat view with two stacked cards per AGENTS.md §4 ("Backup modal:
// separation cards, not tabs"). The previous tab-based UI was a known v0.1.5
// UX bug (CSS layout glitch on tab switch); the cards layout avoids it.
//
// Hard requirements satisfied here:
//   - Password fields: eye icon toggle + strength meter (create form)
//   - Restore: 2-step confirmation — checkbox + 5s countdown button
//   - Dangerous actions: red outline (NOT solid red), warning text in Chinese
//   - Backup commands go through Rust via invoke (same as v0.1.5)

import { useEffect, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Eye, EyeOff } from "lucide-preact";
import { showToast } from "../lib/toast";
import { CountdownButton } from "../components/ui/countdown-button";
import { backupStore } from "./backup-modal-store";

// ── Password strength (pure function) ──────────────────────────────────────
//
// Simple entropy score 0..4: 0 = too short, 1..4 = weak / fair / good / strong.
// Mirrors what the existing v0.1.5 UX wanted but never implemented.

export function passwordStrength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (pw.length < 8) return 0;
  let score = 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4) as 1 | 2 | 3 | 4 | 4; // ensure 1-4 when length >= 8
}

// ── PasswordInput: text + eye toggle (+ optional strength meter) ──────────

interface PasswordInputProps {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  /** When provided, render a strength meter below the input. */
  showStrength?: boolean;
  /** When true, the strength meter compares against a "confirm" value
   *  to highlight mismatch instead of (or in addition to) entropy. */
  confirmValue?: string;
  autoComplete?: string;
  onInput: (value: string) => void;
}

export function PasswordInput({
  id,
  label,
  value,
  placeholder,
  showStrength,
  confirmValue,
  autoComplete,
  onInput,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const strength = passwordStrength(value);
  // v0.2-alpha-32.2: only flag a mismatch when BOTH sides have content
  // long enough to be considered (>= 8 chars, same threshold as the
  // strength floor). Previously the check fired as soon as the first
  // input had any non-empty value, even if the confirm field was still
  // untouched — confusing because it shows "两次密码不一致" before
  // the user has typed in the second box.
  const mismatch =
    confirmValue !== undefined &&
    value.length >= 8 &&
    confirmValue.length >= 8 &&
    value !== confirmValue;

  return (
    <div class="form-group">
      <label for={id}>{label}</label>
      <div class="password-input-row">
        <input
          id={id}
          type={visible ? "text" : "password"}
          class="password-input"
          placeholder={placeholder}
          autocomplete={autoComplete}
          value={value}
          onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="password-eye"
          aria-label={visible ? "隐藏密码" : "显示密码"}
          title={visible ? "隐藏密码" : "显示密码"}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {showStrength ? (
        <div
          class="password-strength"
          data-strength={strength}
          data-mismatch={mismatch ? "true" : "false"}
        >
          <div class="password-strength-bar" />
          <span class="password-strength-label">
            {mismatch
              ? "两次密码不一致"
              : strength === 0
                ? "至少 8 位"
                : strength === 1
                  ? "弱：建议加大小写 + 数字 + 符号"
                  : strength === 2
                    ? "一般"
                    : strength === 3
                      ? "良好"
                      : "强"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── CountdownButton moved to src/components/ui/countdown-button.tsx in
//    alpha-14 so settings-modal (and future modals) can reuse the same
//    5s lockout UX for destructive actions without coupling to the
//    backup view.

// ── Main modal ─────────────────────────────────────────────────────────────

export function BackupModal() {
  const [open, setOpen] = useState(backupStore.getOpen());
  useEffect(() => backupStore.subscribe(setOpen), []);
  if (!open) return null;

  return (
    <div class="modal modal-backup">
      <div class="modal-header">
        <h2>💾 加密备份</h2>
        <button
          class="modal-close-btn"
          aria-label="关闭备份"
          onClick={() => backupStore.setOpen(false)}
        >
          ×
        </button>
      </div>
      <div class="modal-body">
        <CreateCard />
        <RestoreCard />
      </div>
    </div>
  );
}

// ── Create card ────────────────────────────────────────────────────────────

function CreateCard() {
  const [path, setPath] = useState("");
  const [pw, setPw] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");

  async function handleCreate() {
    if (!path.trim()) {
      showToast("请填写输出路径", "", "error");
      return;
    }
    if (passwordStrength(pw) === 0) {
      showToast("密码太短", "建议至少 8 位", "error");
      return;
    }
    if (pw !== pwConfirm) {
      showToast("两次密码不一致", "", "error");
      return;
    }
    try {
      const info = await invoke<{
        output_path: string;
        plaintext_bytes: number;
        encrypted_bytes: number;
      }>("backup_create", {
        outputPath: path.trim(),
        password: pw,
      });
      showToast(
        "备份已创建",
        `${info.output_path}\n明文 ${formatBytes(info.plaintext_bytes)} → 加密 ${formatBytes(info.encrypted_bytes)}`,
        "success",
      );
      setPw("");
      setPwConfirm("");
      backupStore.setOpen(false);
    } catch (e) {
      showToast("备份失败", String(e), "error");
    }
  }

  return (
    <section class="backup-card" aria-labelledby="backup-create-title">
      <header class="backup-card-header">
        <span class="backup-card-icon" aria-hidden="true">📤</span>
        <h3 id="backup-create-title">创建加密备份</h3>
      </header>
      <p class="backup-card-desc">
        把当前所有会话、Persona、项目数据导出到一个加密文件。建议后缀{" "}
        <code>.htbk</code>，可放在 U 盘 / 云盘。
      </p>
      <div class="form-group">
        <label for="backup-create-path">输出路径</label>
        <div class="backup-path-row">
          <input
            id="backup-create-path"
            type="text"
            placeholder="例如 F:\backups\hermes-2026-06-26.htbk"
            value={path}
            onInput={(e) => setPath((e.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="backup-path-browse"
            title="弹出系统保存对话框选择输出路径"
            onClick={async () => {
              try {
                const picked = await saveDialog({
                  title: "选择备份输出路径",
                  defaultPath: path || "hermes-backup.htbk",
                  filters: [
                    { name: "Hermes Backup", extensions: ["htbk"] },
                    { name: "All Files", extensions: ["*"] },
                  ],
                });
                if (typeof picked === "string") setPath(picked);
              } catch (e) {
                showToast("无法打开文件对话框", String(e), "error");
              }
            }}
          >
            📂 浏览…
          </button>
        </div>
      </div>
      <PasswordInput
        id="backup-create-password"
        label="密码"
        placeholder="至少 8 位，记住它"
        autoComplete="new-password"
        value={pw}
        showStrength
        confirmValue={pwConfirm}
        onInput={setPw}
      />
      <PasswordInput
        id="backup-create-password-confirm"
        label="确认密码"
        placeholder="再次输入"
        autoComplete="new-password"
        value={pwConfirm}
        onInput={setPwConfirm}
      />
      <div class="backup-actions">
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => void handleCreate()}
        >
          🔐 创建加密备份
        </button>
      </div>
    </section>
  );
}

// ── Restore card ───────────────────────────────────────────────────────────

function RestoreCard() {
  const [path, setPath] = useState("");
  const [pw, setPw] = useState("");
  const [pwVisible, setPwVisible] = useState(false);
  const [verified, setVerified] = useState(false);
  const [understand, setUnderstand] = useState(false);

  async function handleVerify() {
    if (!path.trim() || !pw) {
      showToast("请填写路径和密码", "", "error");
      return;
    }
    try {
      const ok = await invoke<boolean>("backup_verify", {
        inputPath: path.trim(),
        password: pw,
      });
      if (ok) {
        showToast("密码正确", "可以安全恢复", "success");
        setVerified(true);
      } else {
        showToast("密码错误", "请检查后重试", "error");
        setVerified(false);
      }
    } catch (e) {
      showToast("验证失败", String(e), "error");
      setVerified(false);
    }
  }

  async function handleRestore() {
    if (!path.trim() || !pw) {
      showToast("请填写路径和密码", "", "error");
      return;
    }
    try {
      const info = await invoke<{
        input_path: string;
        plaintext_bytes: number;
        requires_restart: boolean;
      }>("backup_restore", {
        inputPath: path.trim(),
        password: pw,
      });
      if (info.requires_restart) {
        showToast("恢复成功", "请重启应用以加载新数据", "success");
      } else {
        showToast(
          "恢复成功",
          `${info.plaintext_bytes} 字节已加载`,
          "success",
        );
      }
      backupStore.setOpen(false);
    } catch (e) {
      showToast("恢复失败", String(e), "error");
    }
  }

  return (
    <section class="backup-card backup-card-danger" aria-labelledby="backup-restore-title">
      <header class="backup-card-header">
        <span class="backup-card-icon" aria-hidden="true">📥</span>
        <h3 id="backup-restore-title">恢复备份</h3>
      </header>
      <div class="backup-warning">
        ⚠️ 恢复会覆盖当前所有会话/Persona/项目数据。操作完成后需重启应用才能加载恢复后的数据。
      </div>
      <div class="form-group">
        <label for="backup-restore-path">输入文件（.htbk）</label>
        <div class="backup-path-row">
          <input
            id="backup-restore-path"
            type="text"
            placeholder="备份文件的完整路径"
            value={path}
            onInput={(e) => {
              setPath((e.currentTarget as HTMLInputElement).value);
              // Path changed — require re-verification.
              setVerified(false);
            }}
          />
          <button
            type="button"
            class="backup-path-browse"
            title="弹出系统打开对话框选择 .htbk 文件"
            onClick={async () => {
              try {
                const picked = await openDialog({
                  title: "选择要恢复的备份",
                  multiple: false,
                  directory: false,
                  filters: [
                    { name: "Hermes Backup", extensions: ["htbk"] },
                    { name: "All Files", extensions: ["*"] },
                  ],
                });
                if (typeof picked === "string") {
                  setPath(picked);
                  setVerified(false);
                }
              } catch (e) {
                showToast("无法打开文件对话框", String(e), "error");
              }
            }}
          >
            📂 打开…
          </button>
        </div>
      </div>
      <div class="form-group">
        <label for="backup-restore-password">密码</label>
        <div class="password-input-row">
          <input
            id="backup-restore-password"
            type={pwVisible ? "text" : "password"}
            class="password-input"
            placeholder="创建备份时设置的密码"
            autocomplete="current-password"
            value={pw}
            onInput={(e) => {
              setPw((e.currentTarget as HTMLInputElement).value);
              setVerified(false);
            }}
          />
          <button
            type="button"
            class="password-eye"
            aria-label={pwVisible ? "隐藏密码" : "显示密码"}
            title={pwVisible ? "隐藏密码" : "显示密码"}
            onClick={() => setPwVisible((v) => !v)}
          >
            {pwVisible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div class="backup-actions">
        <button
          type="button"
          class="btn btn-secondary"
          onClick={() => void handleVerify()}
        >
          🔍 验证密码
        </button>
        {verified ? (
          <span class="backup-verified-badge" aria-live="polite">
            ✓ 已验证
          </span>
        ) : null}
      </div>
      <label class="backup-confirm-row">
        <input
          type="checkbox"
          checked={understand}
          onChange={(e) => setUnderstand((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>我已了解：恢复会覆盖当前所有数据，且需重启应用</span>
      </label>
      <CountdownButton
        readyLabel="📥 确认恢复"
        onConfirm={() => void handleRestore()}
        blocked={!verified || !understand}
        className={!verified || !understand ? "" : "danger"}
      />
    </section>
  );
}

// ── bytes formatter (also used in toast) ───────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}