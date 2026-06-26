-- Hermes Tray v2 — T-Q-S8 add project context storage
--
-- The `sessions.project_dir` column already exists (added in v1) but was
-- unused. This migration adds `sessions.project_context` — a JSON blob
-- produced by `project::scan_project()` and rendered to a markdown
-- summary ready for system-prompt injection.
--
-- Why a separate column from project_dir?
--   - project_dir is the *input* (a path the user picked).
--   - project_context is the *cached scan result* (manifest fields,
--     README excerpt, languages, summary_markdown). Re-scanning on
--     every message send would be wasteful; this column is the cache.
--
-- Cache invalidation strategy: frontends should re-scan when
-- `scanned_at` is older than the project's mtime, or when the user
-- explicitly clicks "Refresh". The DB doesn't auto-invalidate.

ALTER TABLE sessions ADD COLUMN project_context TEXT;
