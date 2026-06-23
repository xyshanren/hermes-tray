-- Hermes Tray v2 — initial SQLite schema (T-Q-S1)
-- Location: %APPDATA%\com.hermes.tray\sessions.db (Windows)
-- Engine: SQLite 3.40+ with FTS5 (bundled via rusqlite bundled feature)

-- ============================================================================
-- Schema version tracking
-- (the `schema_version` table itself is created by `schema::run_migrations`
-- before this script runs, so we just record v1 once it's applied.)
-- ============================================================================

-- ============================================================================
-- Sessions: top-level conversation container
-- ============================================================================
CREATE TABLE sessions (
    id           TEXT    PRIMARY KEY,                    -- uuid v4 (string)
    title        TEXT    NOT NULL,
    persona_id   TEXT             REFERENCES personas(id) ON DELETE SET NULL,
    project_dir  TEXT,
    created_at   INTEGER NOT NULL,                      -- unix ms
    updated_at   INTEGER NOT NULL,
    last_msg_at  INTEGER,
    msg_count    INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    model        TEXT,
    metadata     TEXT                                    -- JSON blob
);

CREATE INDEX idx_sessions_last_msg_at ON sessions(last_msg_at DESC);
CREATE INDEX idx_sessions_persona_id  ON sessions(persona_id);
CREATE INDEX idx_sessions_created_at  ON sessions(created_at DESC);

-- ============================================================================
-- Messages: chat messages within a session
-- ============================================================================
CREATE TABLE messages (
    id          TEXT    PRIMARY KEY,                    -- uuid v4
    session_id  TEXT    NOT NULL  REFERENCES sessions(id) ON DELETE CASCADE,
    role        TEXT    NOT NULL  CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content     TEXT    NOT NULL,
    tokens      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    tool_calls  TEXT,                                    -- JSON array
    metadata    TEXT                                    -- JSON blob
);

CREATE INDEX idx_messages_session_id     ON messages(session_id, created_at);
CREATE INDEX idx_messages_session_role   ON messages(session_id, role);

-- ============================================================================
-- Personas: assistant role definitions
-- ============================================================================
CREATE TABLE personas (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL,
    description   TEXT,
    system_prompt TEXT    NOT NULL DEFAULT '',
    avatar        TEXT,                                  -- emoji or URL
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    is_builtin    INTEGER NOT NULL DEFAULT 0              -- 0=user, 1=builtin
);

CREATE INDEX idx_personas_name ON personas(name);

-- ============================================================================
-- Tags: free-form labels for sessions
-- ============================================================================
CREATE TABLE tags (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL UNIQUE,
    color         TEXT,
    session_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tags_name ON tags(name);

-- ============================================================================
-- Session-Tag junction table (many-to-many)
-- ============================================================================
CREATE TABLE session_tags (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
    PRIMARY KEY (session_id, tag_id)
);

CREATE INDEX idx_session_tags_tag_id ON session_tags(tag_id);

-- ============================================================================
-- Config: key-value store (replaces config.json)
-- ============================================================================
CREATE TABLE config (
    key        TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL,                         -- JSON-encoded
    updated_at INTEGER NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1                -- schema migration tracking
);

-- ============================================================================
-- Feedback: RLAIF data (thumbs + comments)
-- ============================================================================
CREATE TABLE feedback (
    id         TEXT    PRIMARY KEY,
    session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    msg_id     TEXT             REFERENCES messages(id) ON DELETE CASCADE,
    thumb      INTEGER NOT NULL CHECK(thumb IN (0, 1)),  -- 1=up, 0=down
    comment    TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_feedback_session_id ON feedback(session_id, created_at DESC);
CREATE INDEX idx_feedback_msg_id     ON feedback(msg_id);
CREATE INDEX idx_feedback_thumb      ON feedback(thumb);

-- ============================================================================
-- FTS5: full-text search across messages
-- ============================================================================
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    session_id UNINDEXED,
    role       UNINDEXED,
    msg_id     UNINDEXED,
    tokenize='porter unicode61'
);

-- Triggers: keep FTS in sync with messages table
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, session_id, role, msg_id)
    VALUES (new.rowid, new.content, new.session_id, new.role, new.id);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
    UPDATE messages_fts SET content = new.content WHERE rowid = new.rowid;
END;