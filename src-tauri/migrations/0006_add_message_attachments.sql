-- v0.3.0 alpha-33b P1-3 — persist message image attachments separately
-- from messages.metadata so switching sessions can reconstruct data URLs
-- without inflating a JSON text column.

CREATE TABLE IF NOT EXISTS message_attachments (
    id         TEXT    PRIMARY KEY,
    message_id TEXT    NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    mime       TEXT    NOT NULL,
    size       INTEGER NOT NULL CHECK(size >= 0),
    data       BLOB    NOT NULL,
    sort_idx   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id
    ON message_attachments(message_id, sort_idx, id);
