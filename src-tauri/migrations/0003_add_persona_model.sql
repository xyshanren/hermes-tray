-- Hermes Tray v2 — T-Q-S12-light add persona.model override
--
-- The `personas.model` column lets a user pin a specific model name to
-- a persona. When the persona is selected, the chat sends requests
-- with that model — overriding the global default_model config and
-- the model reported by the gateway via /v1/models.
--
-- Why: the tray is a GUI; routing between providers / cost-aware
-- selection lives in hermes-agent. The tray only sends the *name*
-- the user picked. hermes-agent then decides which credentials to
-- use, retries, etc. (see hermes-agent-cn's fallback_config.py +
-- plugins.py middleware).
--
-- NULL means "no override — fall back to the chat's current model".
-- This is the default for personas created before this migration
-- and for builtin personas that don't have a specific model bias.

ALTER TABLE personas ADD COLUMN model TEXT;
