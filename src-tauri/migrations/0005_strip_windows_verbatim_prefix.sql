-- v0.2-alpha-32.4: strip Windows verbatim-path prefix (\\?\) from old
-- session.project_context rows. The Rust scanner in
-- src-tauri/src/db/project.rs learned to strip this prefix in
-- alpha-31, but rows written by alpha-13..alpha-30 still have
-- `\\?\D:\work\…` baked into their JSON. Manual verification of
-- alpha-32.3 surfaced the `\\?\` leaking into the sidebar
-- tooltip (it looks like garbled text to users who don't know
-- what `\\?\` means).
--
-- This migration is idempotent: a no-op when no rows match
-- (the WHERE clause is also a guard so we don't churn rows that
-- are already clean). The path is stored inside a JSON blob, so
-- we use SQLite's JSON1 functions (bundled with rusqlite's
-- "bundled" feature):
--   - json_extract(blob, '$.project_dir') returns the raw string
--   - substr(value, 1, 4) = '\\?\' checks the verbatim prefix
--   - substr(value, 5) returns the rest
--   - json_replace(blob, '$.project_dir', new_value) writes back
--
-- Note on the literal: in SQL, backslash is NOT a special
-- character. The 4-char prefix is exactly the 4 characters
-- `\`, `\`, `?`, `\` — written as the 4-character SQL literal
-- `'\\?\`. Same as how the Rust string slice is written.

UPDATE sessions
SET project_context = json_replace(
  project_context,
  '$.project_dir',
  substr(json_extract(project_context, '$.project_dir'), 5)
)
WHERE project_context IS NOT NULL
  AND json_extract(project_context, '$.project_dir') IS NOT NULL
  AND substr(json_extract(project_context, '$.project_dir'), 1, 4) = '\\?\';
