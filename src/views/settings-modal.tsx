// v0.2-alpha-12 — SettingsModal (Preact JSX) with unified Gateway group.
//
// Renders the settings panel into the existing <div id="settings-modal">
// overlay root. The store in ./settings-modal-store drives visibility;
// main.ts owns openSettings wrapper + the sidebar/tray-menu entry points.
//
// Groups (in order):
//   1. 主题 — segmented control (☀️/🌙/💻), live preview, persisted on save.
//   2. Gateway 连接 — single unified group for both local + remote.
//      - Radio toggle: 「自动（本机 WSL）」 vs 「自定义（远程）」.
//      - Auto mode: WSL distro + port + read-only "当前 URL" preview
//        (what tray auto-resolved). Same UX as v0.1.5.
//      - Remote mode: single URL input. User fills in remote gateway.
//      - API Key + 测试连接 button + status badge are always visible.
//   3. 默认值 — default project path + default model (db_config keys).
//
// Why the unified group (alpha-12 redesign over alpha-11):
//   alpha-11 split Gateway 连接 (remote URL) and 本地 WSL Gateway (distro
//   + port) into two separate sections. That made local users feel they
//   "lost" the auto-resolve convenience compared to v0.1.5, because the
//   new "Gateway 连接" group required manually typing a URL. The radio
//   toggle here keeps the v0.1.5 local-UX identical while still exposing
//   the remote override as a peer option.
//
// Save flow (mode-aware, single state.gatewayUrl):
//   - hermes_save_config for legacy keys (wsl_distro / port / api_key).
//   - db_config_set for db-backed keys (theme / default_project_path / default_model).
//   - On save: setApiKey + setGatewayUrl (state.ts).
//       - Auto mode: resolveGatewayUrl() + applyPortOverride(port).
//       - Remote mode: setGatewayUrl(userFilledUrl).
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

// ── Gateway mode ──────────────────────────────────────────────────────────

type GatewayMode = "auto" | "remote";

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
  const [mode, setMode] = useState<GatewayMode>("auto");
  const [gatewayUrl, setGatewayUrlField] = useState<string>(getGatewayUrl());
  const [autoUrlPreview, setAutoUrlPreview] = useState<string>(getGatewayUrl());
  const [apiKey, setApiKeyField] = useState<string>(getApiKey());
  const [wslDistros, setWslDistros] = useState<string[]>([]);
  const [wslDistro, setWslDistro] = useState<string>("");
  const [port, setPort] = useState<string>("8642");
  const [defaultProjectPath, setDefaultProjectPathField] = useState<string>("");
  const [defaultModel, setDefaultModelField] = useState<string>("");

  // Connection test state for the Gateway 连接 group.
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

    // Sync current runtime URL/Key into the form. The current URL
    // becomes the auto-mode preview; if it doesn't match any local
    // resolution (i.e. someone set it manually via a previous remote
    // session), we leave mode='auto' so the user can opt into remote
    // mode explicitly to see their URL.
    const currentUrl = getGatewayUrl();
    setAutoUrlPreview(currentUrl);
    setGatewayUrlField(currentUrl);
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

      // Mode-aware gateway resolution.
      if (mode === "remote" && gatewayUrl.trim()) {
        setGatewayUrl(gatewayUrl.trim());
      } else {
        // Auto mode: fall back to the WSL distro + port resolve path.
        try {
          await resolveGatewayUrl();
          if (port) applyPortOverride(port);
        } catch {
          /* keep old URL on resolve failure */
        }
      }
      // Refresh auto-mode preview to reflect whatever the runtime state is now.
      setAutoUrlPreview(getGatewayUrl());

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
    // Decide which URL to test based on the current mode + form input.
    let proposedUrl: string;
    if (mode === "remote" && gatewayUrl.trim()) {
      proposedUrl = gatewayUrl.trim();
    } else if (mode === "auto") {
      // Auto mode: ask the tray to resolve from the current distro + port.
      // resolveGatewayUrl mutates state.gatewayUrl as a side effect — we
      // capture its return and restore the original URL in `finally` so
      // the test is non-destructive (the running app is unaffected).
      const savedUrl = getGatewayUrl();
      try {
        proposedUrl = await resolveGatewayUrl();
        if (port) {
          proposedUrl = proposedUrl.replace(/:\d+$/, `:${port}`);
        }
      } finally {
        setGatewayUrl(savedUrl);
      }
    } else {
      // Remote mode with empty URL — nothing to test.
      setTest({
        status: "fail",
        detail: "请先填写 Gateway URL",
        latencyMs: null,
      });
      return;
    }

    const proposedKey = apiKey.trim();
    setTest({ status: "testing", detail: "正在连接…", latencyMs: null });

    const savedUrl = getGatewayUrl();
    const savedKey = getApiKey();
    setGatewayUrl(proposedUrl);
    if (proposedKey) setApiKey(proposedKey);

    const t0 = performance.now();
    try {
      const res = await hermesGet("/health");
      const latencyMs = Math.round(performance.now() - t0);
      if (res.ok && res.status >= 200 && res.status < 300) {
        setTest({
          status: "ok",
          detail: `已连接 ${proposedUrl}`,
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
          mode={mode}
          onModeChange={setMode}
          gatewayUrl={gatewayUrl}
          onUrlChange={setGatewayUrlField}
          autoUrlPreview={autoUrlPreview}
          apiKey={apiKey}
          onApiKeyChange={setApiKeyField}
          wslDistros={wslDistros}
          wslDistro={wslDistro}
          onDistroChange={setWslDistro}
          port={port}
          onPortChange={setPort}
          test={test}
          onTest={handleTestConnection}
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

// ── Gateway 连接 (unified group, alpha-12) ────────────────────────────────
//
// One group, two modes via radio toggle:
//   - auto:   WSL distro + port, with auto-resolved URL shown as preview.
//   - remote: single URL input.
// API Key + 测试连接 button are always visible regardless of mode.

function GatewayConnectionGroup({
  mode,
  onModeChange,
  gatewayUrl,
  onUrlChange,
  autoUrlPreview,
  apiKey,
  onApiKeyChange,
  wslDistros,
  wslDistro,
  onDistroChange,
  port,
  onPortChange,
  test,
  onTest,
}: {
  mode: GatewayMode;
  onModeChange: (m: GatewayMode) => void;
  gatewayUrl: string;
  onUrlChange: (v: string) => void;
  autoUrlPreview: string;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  wslDistros: string[];
  wslDistro: string;
  onDistroChange: (v: string) => void;
  port: string;
  onPortChange: (v: string) => void;
  test: ConnectionTestState;
  onTest: () => void;
}) {
  const [keyVisible, setKeyVisible] = useState(false);

  return (
    <section class="settings-group" aria-labelledby="settings-gateway-title">
      <h3 id="settings-gateway-title">Gateway 连接</h3>
      <div
        class="settings-mode-toggle"
        role="radiogroup"
        aria-labelledby="settings-gateway-title"
      >
        <label
          class={`settings-mode-option${mode === "auto" ? " active" : ""}`}
        >
          <input
            type="radio"
            name="gateway-mode"
            value="auto"
            checked={mode === "auto"}
            onChange={() => onModeChange("auto")}
          />
          <span>自动（本机 WSL，自动解析 IP）</span>
        </label>
        <label
          class={`settings-mode-option${mode === "remote" ? " active" : ""}`}
        >
          <input
            type="radio"
            name="gateway-mode"
            value="remote"
            checked={mode === "remote"}
            onChange={() => onModeChange("remote")}
          />
          <span>自定义（远程，手动输入 URL）</span>
        </label>
      </div>

      {mode === "auto" ? (
        <div class="form-group">
          <label for="setting-wsl-distro">WSL 发行版</label>
          <select
            id="setting-wsl-distro"
            value={wslDistro}
            onChange={(e) =>
              onDistroChange((e.currentTarget as HTMLSelectElement).value)
            }
          >
            {wslDistros.length === 0 ? (
              <option value="">(未检测到 WSL)</option>
            ) : (
              wslDistros.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))
            )}
          </select>
          <div class="form-group">
            <label for="setting-port">Gateway 端口</label>
            <input
              id="setting-port"
              type="number"
              min="1024"
              max="65535"
              placeholder="8642"
              value={port}
              onInput={(e) =>
                onPortChange((e.currentTarget as HTMLInputElement).value)
              }
            />
          </div>
          <div class="settings-url-preview">
            <span class="form-hint">当前 URL（自动解析）</span>
            <code>{autoUrlPreview || "(未解析)"}</code>
          </div>
        </div>
      ) : (
        <div class="form-group">
          <label for="setting-gateway-url">Gateway URL</label>
          <input
            id="setting-gateway-url"
            type="text"
            placeholder="例如 http://192.168.1.100:8642"
            value={gatewayUrl}
            onInput={(e) => onUrlChange((e.currentTarget as HTMLInputElement).value)}
          />
          <span class="form-hint">
            远程 hermes gateway 的完整地址。
          </span>
        </div>
      )}

      <div class="form-group">
        <label for="setting-gateway-api-key">API Key</label>
        <div class="password-input-row">
          <input
            id="setting-gateway-api-key"
            type={keyVisible ? "text" : "password"}
            class="password-input"
            placeholder={
              mode === "remote" ? "远程 hermes 的 API Key" : "本地 WSL Gateway 的 API Key"
            }
            autocomplete="current-password"
            value={apiKey}
            onInput={(e) =>
              onApiKeyChange((e.currentTarget as HTMLInputElement).value)
            }
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