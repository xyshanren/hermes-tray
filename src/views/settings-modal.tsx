// v0.2-alpha-11 — SettingsModal (Preact JSX).
//
// Renders the settings panel into the existing <div id="settings-modal">
// overlay root. The store in ./settings-modal-store drives visibility;
// main.ts owns openSettings wrapper + the sidebar/tray-menu entry
// points.
//
// Groups (in order):
//   1. Theme segmented control (☀️/🌙/💻) — live preview, persisted on save.
//   2. Gateway 连接 (NEW in alpha-11) — gateway URL override + API Key
//      with eye icon + 测试连接 button + status indicator. Enabling
//      remote-hermes support: leave URL empty to use the legacy
//      WSL-distro + port resolve path; set URL to point at a remote
//      gateway.
//   3. 本地 WSL Gateway — distro + port (used by the legacy resolve path).
//   4. 默认值 — default project path + default model (db_config keys).
//
// Save flow:
//   - hermes_save_config for legacy keys (wsl_distro / port / api_key).
//   - db_config_set for db-backed keys (theme / default_project_path / default_model).
//   - On save: setApiKey + setGatewayUrl (state.ts). If Gateway URL is
//     non-empty, skip resolveGatewayUrl and use the override directly.
//   - onDefaultsChanged callback so main.ts can refresh its module-level
//     defaultProjectPath / defaultModel lets used by sendMessage + model picker.

import { useEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff } from "lucide-preact";
import {
  getStoredTheme,
  setTheme,
  applyTheme,
  type ThemeMode,
} from "../lib/theme";
import {
  setApiKey,
  setGatewayUrl,
  applyPortOverride,
  resolveGatewayUrl,
  getGatewayUrl,
  getApiKey,
} from "../lib/state";
import { hermesGet } from "../lib/api";
import { showToast } from "../lib/toast";
import { settingsStore } from "./settings-modal-store";

// ── Mount props ───────────────────────────────────────────────────────────

export interface SettingsModalProps {
  /**
   * Called after a successful save so main.ts can refresh its
   * module-level defaultProjectPath + defaultModel lets.
   */
  onDefaultsChanged: (defaults: {
    defaultProjectPath: string | null;
    defaultModel: string | null;
  }) => void;
}

// ── Connection test state ─────────────────────────────────────────────────

interface ConnectionTestState {
  status: "idle" | "testing" | "ok" | "fail";
  detail: string;
  latencyMs: number | null;
}

// ── Main modal ────────────────────────────────────────────────────────────

export function SettingsModal({ onDefaultsChanged }: SettingsModalProps) {
  const [open, setOpen] = useState(settingsStore.getOpen());
  useEffect(() => settingsStore.subscribe(setOpen), []);

  // Form fields (controlled). Re-init on each open to capture current
  // external state (e.g. someone updated the URL via another route).
  const [theme, setThemeMode] = useState<ThemeMode>(getStoredTheme());
  const [gatewayUrl, setGatewayUrlField] = useState<string>(getGatewayUrl());
  const [apiKey, setApiKeyField] = useState<string>(getApiKey());
  const [wslDistros, setWslDistros] = useState<string[]>([]);
  const [wslDistro, setWslDistro] = useState<string>("");
  const [port, setPort] = useState<string>("8642");
  const [defaultProjectPath, setDefaultProjectPathField] = useState<string>("");
  const [defaultModel, setDefaultModelField] = useState<string>("");

  // Connection test state for the new Gateway 连接 group.
  const [test, setTest] = useState<ConnectionTestState>({
    status: "idle",
    detail: "未测试",
    latencyMs: null,
  });

  // Load everything on open rising edge. Using a ref guard prevents the
  // effect from re-running and clobbering in-flight form state on every
  // re-render — same pattern search-modal.tsx uses.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      void loadAll();
    }
    prevOpenRef.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll(): Promise<void> {
    // WSL distro list.
    try {
      const distros = await invoke<string[]>("hermes_list_wsl_distros");
      setWslDistros(distros);
    } catch {
      setWslDistros([]);
    }

    // Legacy hermes config (wsl_distro + port + api_key).
    try {
      const config = (await invoke("hermes_get_config")) as Record<string, any>;
      if (config.wsl_distro) setWslDistro(config.wsl_distro);
      if (config.port) setPort(String(config.port));
      if (config.api_key) setApiKeyField(config.api_key);
    } catch {
      /* no config yet */
    }

    // DB-backed keys.
    const dbGet = async (key: string): Promise<string | null> => {
      try {
        const entry = (await invoke("db_config_get", { key })) as {
          value: string;
        } | null;
        return entry?.value?.trim() || null;
      } catch {
        return null;
      }
    };

    const projPath = await dbGet("default_project_path");
    if (projPath) setDefaultProjectPathField(projPath);

    const model = await dbGet("default_model");
    if (model) setDefaultModelField(model);

    const dbTheme = await dbGet("theme");
    if (dbTheme === "light" || dbTheme === "dark" || dbTheme === "system") {
      setThemeMode(dbTheme);
    }

    // Sync current runtime URL/Key into the form (in case another path
    // mutated them since last save).
    setGatewayUrlField(getGatewayUrl());
    setApiKeyField(getApiKey());

    setTest({ status: "idle", detail: "未测试", latencyMs: null });
  }

  async function handleSave(): Promise<void> {
    const updates: Record<string, any> = {};
    if (wslDistro) updates.wsl_distro = wslDistro;
    if (port) updates.port = Number(port);
    if (apiKey) updates.api_key = apiKey;

    try {
      await invoke("hermes_save_config", { updates });

      const newDefaultPath = defaultProjectPath.trim();
      await invoke("db_config_set", {
        key: "default_project_path",
        value: newDefaultPath.length > 0 ? newDefaultPath : "",
      });

      const newDefaultModel = defaultModel.trim();
      await invoke("db_config_set", {
        key: "default_model",
        value: newDefaultModel.length > 0 ? newDefaultModel : "",
      });

      await invoke("db_config_set", { key: "theme", value: theme });

      // Apply at runtime.
      if (apiKey) setApiKey(apiKey);

      // Gateway URL: non-empty overrides the legacy resolve path.
      // Empty means "fall back to WSL distro + port resolve".
      if (gatewayUrl.trim()) {
        setGatewayUrl(gatewayUrl.trim());
      } else {
        try {
          await resolveGatewayUrl();
          if (port) applyPortOverride(port);
        } catch {
          /* keep old URL on resolve failure */
        }
      }

      showToast(
        "设置已保存",
        "配置已更新，部分设置可能需要重启后生效",
        "success",
      );

      // Let main.ts refresh its module-level lets used by sendMessage + model picker.
      onDefaultsChanged({
        defaultProjectPath: newDefaultPath.length > 0 ? newDefaultPath : null,
        defaultModel: newDefaultModel.length > 0 ? newDefaultModel : null,
      });

      settingsStore.setOpen(false);
    } catch (e) {
      showToast("保存失败", String(e), "error");
    }
  }

  async function handleTestConnection(): Promise<void> {
    setTest({ status: "testing", detail: "正在连接…", latencyMs: null });

    // Use the user's proposed values WITHOUT saving — restore runtime
    // state in `finally` so the app doesn't see a half-applied config.
    const proposedUrl = gatewayUrl.trim();
    const proposedKey = apiKey.trim();

    const savedUrl = getGatewayUrl();
    const savedKey = getApiKey();
    setGatewayUrl(proposedUrl || savedUrl);
    if (proposedKey) setApiKey(proposedKey);

    const t0 = performance.now();
    try {
      const res = await hermesGet("/health");
      const latencyMs = Math.round(performance.now() - t0);
      if (res.ok && res.status >= 200 && res.status < 300) {
        setTest({
          status: "ok",
          detail: `已连接 ${proposedUrl || savedUrl}`,
          latencyMs,
        });
      } else {
        setTest({
          status: "fail",
          detail: `HTTP ${res.status}: ${(res.body || "").slice(0, 80)}`,
          latencyMs,
        });
      }
    } catch (e) {
      const latencyMs = Math.round(performance.now() - t0);
      setTest({
        status: "fail",
        detail: `无法连接: ${String(e).slice(0, 80)}`,
        latencyMs,
      });
    } finally {
      // Restore runtime state — the test is non-destructive.
      setGatewayUrl(savedUrl);
      setApiKey(savedKey);
    }
  }

  if (!open) return null;

  return (
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>⚙️ 设置</h2>
        <button
          class="modal-close-btn"
          aria-label="关闭设置"
          onClick={() => settingsStore.setOpen(false)}
        >
          ×
        </button>
      </div>
      <div class="modal-body">
        <ThemeGroup theme={theme} onChange={setThemeMode} />
        <GatewayConnectionGroup
          gatewayUrl={gatewayUrl}
          onUrlChange={setGatewayUrlField}
          apiKey={apiKey}
          onApiKeyChange={setApiKeyField}
          test={test}
          onTest={handleTestConnection}
        />
        <LocalGatewayGroup
          distros={wslDistros}
          distro={wslDistro}
          onDistroChange={setWslDistro}
          port={port}
          onPortChange={setPort}
        />
        <DefaultsGroup
          defaultProjectPath={defaultProjectPath}
          onProjectPathChange={setDefaultProjectPathField}
          defaultModel={defaultModel}
          onDefaultModelChange={setDefaultModelField}
        />
      </div>
      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-secondary"
          onClick={() => settingsStore.setOpen(false)}
        >
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => void handleSave()}
        >
          保存
        </button>
      </div>
    </div>
  );
}

// ── Theme segmented control ───────────────────────────────────────────────

function ThemeGroup({
  theme,
  onChange,
}: {
  theme: ThemeMode;
  onChange: (next: ThemeMode) => void;
}) {
  // Live preview on click — apply immediately, persist on save.
  function handleClick(mode: ThemeMode): void {
    onChange(mode);
    applyTheme(mode); // sets .dark on <html>
    setTheme(mode); // localStorage update + a11y tag
  }

  return (
    <section class="settings-group" aria-labelledby="settings-theme-title">
      <h3 id="settings-theme-title">主题</h3>
      <div class="form-group">
        <label id="setting-theme-label">主题</label>
        <div
          class="segmented"
          role="radiogroup"
          aria-labelledby="setting-theme-label"
        >
          {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              class={`segmented-btn${theme === m ? " active" : ""}`}
              role="radio"
              data-theme={m}
              aria-checked={theme === m ? "true" : "false"}
              onClick={() => handleClick(m)}
            >
              {m === "light" ? "☀️ 浅色" : m === "dark" ? "🌙 深色" : "💻 跟随系统"}
            </button>
          ))}
        </div>
        <span class="form-hint">
          界面外观。点击立即生效，重启后保留（写入配置数据库）。
        </span>
      </div>
    </section>
  );
}

// ── Gateway 连接 (NEW in alpha-11) ─────────────────────────────────────────

function GatewayConnectionGroup({
  gatewayUrl,
  onUrlChange,
  apiKey,
  onApiKeyChange,
  test,
  onTest,
}: {
  gatewayUrl: string;
  onUrlChange: (v: string) => void;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  test: ConnectionTestState;
  onTest: () => void;
}) {
  const [keyVisible, setKeyVisible] = useState(false);

  return (
    <section class="settings-group" aria-labelledby="settings-gateway-title">
      <h3 id="settings-gateway-title">Gateway 连接</h3>
      <span class="form-hint">
        留空 = 使用本机 WSL Gateway（按下面的「本地 WSL Gateway」解析）。
        填地址 = 直连远程 hermes gateway。
      </span>
      <div class="form-group">
        <label for="setting-gateway-url">Gateway 地址</label>
        <input
          id="setting-gateway-url"
          type="text"
          placeholder="例如 http://192.168.1.100:8642"
          value={gatewayUrl}
          onInput={(e) => onUrlChange((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="form-group">
        <label for="setting-gateway-api-key">API Key</label>
        <div class="password-input-row">
          <input
            id="setting-gateway-api-key"
            type={keyVisible ? "text" : "password"}
            class="password-input"
            placeholder="远程 hermes 的 API Key"
            autocomplete="current-password"
            value={apiKey}
            onInput={(e) => onApiKeyChange((e.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="password-eye"
            aria-label={keyVisible ? "隐藏 Key" : "显示 Key"}
            title={keyVisible ? "隐藏 Key" : "显示 Key"}
            onClick={() => setKeyVisible((v) => !v)}
          >
            {keyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div class="settings-test-row">
        <button
          type="button"
          class="btn btn-secondary"
          disabled={test.status === "testing"}
          onClick={() => void onTest()}
        >
          {test.status === "testing" ? "测试中…" : "🔍 测试连接"}
        </button>
        <ConnectionStatusBadge test={test} />
      </div>
    </section>
  );
}

function ConnectionStatusBadge({ test }: { test: ConnectionTestState }) {
  const dot =
    test.status === "ok"
      ? "settings-status-dot-ok"
      : test.status === "fail"
        ? "settings-status-dot-fail"
        : test.status === "testing"
          ? "settings-status-dot-testing"
          : "settings-status-dot-idle";
  const latency =
    test.latencyMs !== null ? ` (${test.latencyMs}ms)` : "";
  return (
    <span class="settings-status" role="status" aria-live="polite">
      <span class={`settings-status-dot ${dot}`} aria-hidden="true" />
      <span>
        {test.detail}
        {latency}
      </span>
    </span>
  );
}

// ── 本地 WSL Gateway ──────────────────────────────────────────────────────

function LocalGatewayGroup({
  distros,
  distro,
  onDistroChange,
  port,
  onPortChange,
}: {
  distros: string[];
  distro: string;
  onDistroChange: (v: string) => void;
  port: string;
  onPortChange: (v: string) => void;
}) {
  return (
    <section class="settings-group" aria-labelledby="settings-local-title">
      <h3 id="settings-local-title">本地 WSL Gateway</h3>
      <span class="form-hint">
        仅当 Gateway 地址留空时使用。Hermes Gateway 监听在选中的 WSL 发行版内。
      </span>
      <div class="form-group">
        <label for="setting-wsl-distro">WSL 发行版</label>
        <select
          id="setting-wsl-distro"
          value={distro}
          onChange={(e) => onDistroChange((e.currentTarget as HTMLSelectElement).value)}
        >
          {distros.length === 0 ? (
            <option value="">(未检测到 WSL)</option>
          ) : (
            distros.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))
          )}
        </select>
      </div>
      <div class="form-group">
        <label for="setting-port">Gateway 端口</label>
        <input
          id="setting-port"
          type="number"
          min="1024"
          max="65535"
          placeholder="8642"
          value={port}
          onInput={(e) => onPortChange((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
    </section>
  );
}

// ── 默认值 ───────────────────────────────────────────────────────────────

function DefaultsGroup({
  defaultProjectPath,
  onProjectPathChange,
  defaultModel,
  onDefaultModelChange,
}: {
  defaultProjectPath: string;
  onProjectPathChange: (v: string) => void;
  defaultModel: string;
  onDefaultModelChange: (v: string) => void;
}) {
  return (
    <section class="settings-group" aria-labelledby="settings-defaults-title">
      <h3 id="settings-defaults-title">默认值</h3>
      <div class="form-group">
        <label for="setting-default-project-path">默认项目路径 (T-Q-S8)</label>
        <input
          id="setting-default-project-path"
          type="text"
          placeholder="例如 F:\work\workspace\MiniMax\hermes-tray 或 /home/user/proj"
          value={defaultProjectPath}
          onInput={(e) =>
            onProjectPathChange((e.currentTarget as HTMLInputElement).value)
          }
        />
        <span class="form-hint">
          新建会话时自动扫描此目录的 README + manifest + git 信息，注入到 system prompt。留空则不附加项目上下文。
        </span>
      </div>
      <div class="form-group">
        <label for="setting-default-model">默认 Model (T-Q-S12-light)</label>
        <input
          id="setting-default-model"
          type="text"
          placeholder="例如 gpt-4o-mini / deepseek-chat / hermes-agent"
          value={defaultModel}
          onInput={(e) =>
            onDefaultModelChange((e.currentTarget as HTMLInputElement).value)
          }
        />
        <span class="form-hint">
          无 persona 绑定时使用的 model 名称。留空 = gateway 默认。路由/重试由 hermes-agent 处理（不在 tray）。
        </span>
      </div>
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────