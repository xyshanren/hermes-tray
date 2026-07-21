// v0.2-alpha-13 — SettingsModal (Preact JSX) per SVG 11 design.
//
// Renders the settings panel into the existing <div id="settings-modal">
// overlay root. The store in ./settings-modal-store drives visibility;
// main.ts owns openSettings wrapper + the sidebar/tray-menu entry points.
//
// Groups per SVG 11 (in order):
//   1. 连接 — Gateway mode toggle (auto/remote), distro+port in auto mode,
//      single URL in remote mode, API Key + 测试连接 button always visible.
//      Preserves alpha-12's UX where local users don't type a URL.
//   2. 新建会话默认值 — default project path + default model (db_config keys).
//   3. 偏好 — 主题 segmented + 费用货币 segmented + auto_connect / auto_rename
//      switches + 会话列表排序 select. NEW alpha-13: 4 new fields wired to
//      db_config_set/get via the schema in src/lib/config-schema.ts.
//   4. 数据危险操作区 — 4 destructive-action buttons in a red-outlined
//      panel. Backup create/restore open the backup modal (existing
//      alpha-9 view, reused). "清除所有会话" + "重置所有设置" are stubs
//      that show a toast — Rust commands land in alpha-14.
//
// Save flow (unchanged from alpha-12):
//   - hermes_save_config for legacy keys (wsl_distro / port / api_key).
//   - db_config_set for db-backed keys (theme / default_project_path /
//     default_model / currency / auto_connect / auto_rename / sort_order).
//   - On save: setApiKey + setGatewayUrl (state.ts). Mode-aware (auto vs
//     remote). onDefaultsChanged callback so main.ts can refresh its
//     module-level defaultProjectPath / defaultModel lets used by
//     sendMessage + model picker.

import { useEffect, useRef, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff } from "lucide-preact";
import {
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
import {
  coerceConfigValue,
  formatBoolPref,
  parseBoolPref,
  type Currency,
  type SortOrder,
} from "../lib/config-schema";
import { Switch } from "../components/ui/switch";
import { CountdownButton } from "../components/ui/countdown-button";
import { settingsStore } from "./settings-modal-store";
import { backupStore } from "./backup-modal-store";

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

  // ── Form fields ────────────────────────────────────────────────────────
  const [theme, setThemeMode] = useState<ThemeMode>(
    coerceConfigValue("theme", undefined) as ThemeMode,
  );
  const [mode, setMode] = useState<GatewayMode>("auto");
  const [gatewayUrl, setGatewayUrlField] = useState<string>(getGatewayUrl());
  const [autoUrlPreview, setAutoUrlPreview] = useState<string>(getGatewayUrl());
  const [apiKey, setApiKeyField] = useState<string>(getApiKey());
  const [wslDistros, setWslDistros] = useState<string[]>([]);
  const [wslDistro, setWslDistro] = useState<string>("");
  const [port, setPort] = useState<string>("8642");

  // 新建会话默认值
  const [defaultProjectPath, setDefaultProjectPathField] = useState<string>(
    coerceConfigValue("default_project_path", undefined),
  );
  const [defaultModel, setDefaultModelField] = useState<string>(
    coerceConfigValue("default_model", undefined),
  );

  // 偏好 (alpha-13 new)
  const [currency, setCurrency] = useState<Currency>(
    coerceConfigValue("currency", undefined) as Currency,
  );
  const [autoConnect, setAutoConnect] = useState<boolean>(
    parseBoolPref(coerceConfigValue("auto_connect", undefined)),
  );
  const [autoRename, setAutoRename] = useState<boolean>(
    parseBoolPref(coerceConfigValue("auto_rename", undefined)),
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    coerceConfigValue("sort_order", undefined) as SortOrder,
  );

  const [test, setTest] = useState<ConnectionTestState>({
    status: "idle",
    detail: "未测试",
    latencyMs: null,
  });

  // Load everything on open rising edge.
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

    // DB-backed keys via the schema.
    const dbGet = async (key: string): Promise<string | null> => {
      try {
        const entry = (await invoke("db_config_get", { key })) as {
          value: string;
        } | null;
        return entry?.value?.trim() ?? null;
      } catch {
        return null;
      }
    };

    const projPath = await dbGet("default_project_path");
    if (projPath !== null) setDefaultProjectPathField(projPath);

    const model = await dbGet("default_model");
    if (model !== null) setDefaultModelField(model);

    const dbTheme = await dbGet("theme");
    if (dbTheme) setThemeMode(coerceConfigValue("theme", dbTheme) as ThemeMode);

    const dbCurrency = await dbGet("currency");
    if (dbCurrency) setCurrency(coerceConfigValue("currency", dbCurrency) as Currency);

    const dbAutoConnect = await dbGet("auto_connect");
    if (dbAutoConnect !== null) setAutoConnect(parseBoolPref(dbAutoConnect));

    const dbAutoRename = await dbGet("auto_rename");
    if (dbAutoRename !== null) setAutoRename(parseBoolPref(dbAutoRename));

    const dbSortOrder = await dbGet("sort_order");
    if (dbSortOrder) setSortOrder(coerceConfigValue("sort_order", dbSortOrder) as SortOrder);

    // Sync current runtime URL/Key into the form.
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

      // 偏好 (alpha-13 new keys)
      await invoke("db_config_set", { key: "theme", value: theme });
      await invoke("db_config_set", { key: "currency", value: currency });
      await invoke("db_config_set", {
        key: "auto_connect",
        value: formatBoolPref(autoConnect),
      });
      await invoke("db_config_set", {
        key: "auto_rename",
        value: formatBoolPref(autoRename),
      });
      await invoke("db_config_set", { key: "sort_order", value: sortOrder });

      // Apply at runtime.
      if (apiKey) setApiKey(apiKey);
      // v0.2-alpha-24 — apply the chosen theme immediately so the
      // user sees the dark/light flip without restart. Without this
      // call the segmented control would update localStorage via
      // db_config_set but `<html class="dark">` would not flip —
      // the .dark class on <html> is what triggers all the dark
      // theme rules in styles.css.
      setTheme(theme);

      // Mode-aware gateway resolution.
      if (mode === "remote" && gatewayUrl.trim()) {
        setGatewayUrl(gatewayUrl.trim());
      } else {
        try {
          await resolveGatewayUrl();
          if (port) applyPortOverride(port);
        } catch {
          /* keep old URL on resolve failure */
        }
      }
      setAutoUrlPreview(getGatewayUrl());

      showToast(
        "设置已保存",
        "配置已更新，部分设置可能需要重启后生效",
        "success",
      );

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
    let proposedUrl: string;
    if (mode === "remote" && gatewayUrl.trim()) {
      proposedUrl = gatewayUrl.trim();
    } else if (mode === "auto") {
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
      setGatewayUrl(savedUrl);
      setApiKey(savedKey);
    }
  }

  // ── Danger zone handlers (alpha-14) ────────────────────────────────────

  function handleBackupCreate(): void {
    // v0.2-alpha-32.2: keep settings open and layer the backup modal
    // on top (z-index bumped in styles.css for #backup-modal). This
    // way closing the backup modal returns the user to the settings
    // page they came from instead of dropping them straight back to
    // the chat. The user can dismiss settings separately when done.
    backupStore.setOpen(true);
  }

  function handleBackupRestore(): void {
    backupStore.setOpen(true);
  }

  async function handleClearAllSessions(): Promise<void> {
    try {
      const removed = await invoke<number>("session_clear_all");
      showToast(
        "已清除所有会话",
        `共删除 ${removed} 个会话（消息 + 标签随外键级联删除）`,
        "success",
      );
      settingsStore.setOpen(false);
    } catch (e) {
      showToast("清除失败", String(e), "error");
    }
  }

  async function handleResetAllSettings(): Promise<void> {
    // Two-step: wipe db_config table + delete legacy config.json.
    // Both commands are idempotent so a partial failure is recoverable.
    try {
      const dbRemoved = await invoke<number>("db_config_reset_all");
      await invoke("hermes_reset_config");
      showToast(
        "已重置所有设置",
        `已清除 ${dbRemoved} 个 db_config 项；下次启动将使用 CONFIG_SCHEMA 默认值`,
        "success",
      );
      settingsStore.setOpen(false);
    } catch (e) {
      showToast("重置失败", String(e), "error");
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
        <ConnectionGroup
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
        <NewSessionDefaultsGroup
          defaultProjectPath={defaultProjectPath}
          onProjectPathChange={setDefaultProjectPathField}
          defaultModel={defaultModel}
          onDefaultModelChange={setDefaultModelField}
        />
        <PreferencesGroup
          theme={theme}
          onThemeChange={setThemeMode}
          currency={currency}
          onCurrencyChange={setCurrency}
          autoConnect={autoConnect}
          onAutoConnectChange={setAutoConnect}
          autoRename={autoRename}
          onAutoRenameChange={setAutoRename}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
        />
        <StorageInfoGroup />
        <DangerZoneGroup
          onBackupCreate={handleBackupCreate}
          onBackupRestore={handleBackupRestore}
          onClearAllSessions={handleClearAllSessions}
          onResetAllSettings={handleResetAllSettings}
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

// ── 连接 (per SVG 11) ─────────────────────────────────────────────────────

function ConnectionGroup({
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
    <section class="settings-group" aria-labelledby="settings-connection-title">
      <h3 id="settings-connection-title">连接</h3>
      <div
        class="settings-mode-toggle"
        role="radiogroup"
        aria-labelledby="settings-connection-title"
      >
        <label class={`settings-mode-option${mode === "auto" ? " active" : ""}`}>
          <input
            type="radio"
            name="gateway-mode"
            value="auto"
            checked={mode === "auto"}
            onChange={() => onModeChange("auto")}
          />
          <div class="settings-mode-option-text">
            <span class="settings-mode-option-label">自动</span>
            <span class="settings-mode-option-hint">本机 WSL，自动解析 IP</span>
          </div>
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
          <div class="settings-mode-option-text">
            <span class="settings-mode-option-label">自定义</span>
            <span class="settings-mode-option-hint">远程，手动输入 URL</span>
          </div>
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
            <label for="setting-port">端口</label>
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
          <span class="form-hint">远程 hermes gateway 的完整地址。</span>
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
              mode === "remote"
                ? "远程 hermes 的 API Key"
                : "本地 WSL Gateway 的 API Key"
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
  const latency = test.latencyMs !== null ? ` (${test.latencyMs}ms)` : "";
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

// ── 新建会话默认值 (per SVG 11) ──────────────────────────────────────────

function NewSessionDefaultsGroup({
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
    <section
      class="settings-group"
      aria-labelledby="settings-newsession-title"
    >
      <h3 id="settings-newsession-title">新建会话默认值</h3>
      <div class="form-group">
        <label for="setting-default-project-path">默认项目上下文</label>
        <input
          id="setting-default-project-path"
          type="text"
          placeholder="例如 F:\work\workspace\MiniMax\hermes-tray 或 /home/user/proj"
          value={defaultProjectPath}
          onInput={(e) =>
            onProjectPathChange((e.currentTarget as HTMLInputElement).value)
          }
        />
        <span class="form-hint form-hint--emphasis" role="note">
          <span aria-hidden="true">ℹ️</span>{" "}
          这里是给 AI 提供项目背景，<strong>不是</strong>存数据的地方。
          新建会话时会自动读项目根目录的 README、package.json / Cargo.toml /
          pyproject.toml / go.mod、.git/config，压缩成 4KB 摘要塞给 AI，
          让它不用你贴就能聊这个项目。要备份数据请用<strong>数据 → 创建加密备份</strong>。
        </span>
      </div>
      <div class="form-group">
        <label for="setting-default-model">默认模型</label>
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

// ── 偏好 (per SVG 11, alpha-13 new fields) ───────────────────────────────

function PreferencesGroup({
  theme,
  onThemeChange,
  currency,
  onCurrencyChange,
  autoConnect,
  onAutoConnectChange,
  autoRename,
  onAutoRenameChange,
  sortOrder,
  onSortOrderChange,
}: {
  theme: ThemeMode;
  onThemeChange: (m: ThemeMode) => void;
  currency: Currency;
  onCurrencyChange: (c: Currency) => void;
  autoConnect: boolean;
  onAutoConnectChange: (v: boolean) => void;
  autoRename: boolean;
  onAutoRenameChange: (v: boolean) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (s: SortOrder) => void;
}) {
  function handleThemeClick(mode: ThemeMode): void {
    onThemeChange(mode);
    applyTheme(mode);
    setTheme(mode);
  }

  const currencyLabels: Record<Currency, string> = {
    CNY: "人民币",
    USD: "美元",
    model: "按模型",
  };

  const sortOrderLabels: Record<SortOrder, string> = {
    recent: "最近活跃",
    created: "创建时间",
    name: "按名称",
  };

  return (
    <section class="settings-group" aria-labelledby="settings-prefs-title">
      <h3 id="settings-prefs-title">偏好</h3>

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
              onClick={() => handleThemeClick(m)}
            >
              {m === "light"
                ? "☀️ 浅色"
                : m === "dark"
                  ? "🌙 深色"
                  : "💻 跟随系统"}
            </button>
          ))}
        </div>
      </div>

      <div class="form-group">
        <label id="setting-currency-label">费用货币</label>
        <div
          class="segmented"
          role="radiogroup"
          aria-labelledby="setting-currency-label"
        >
          {(["CNY", "USD", "model"] as Currency[]).map((c) => (
            <button
              key={c}
              type="button"
              class={`segmented-btn${currency === c ? " active" : ""}`}
              role="radio"
              data-currency={c}
              aria-checked={currency === c ? "true" : "false"}
              onClick={() => onCurrencyChange(c)}
            >
              {currencyLabels[c]}
            </button>
          ))}
        </div>
        <span class="form-hint">
          用于统计面板的费用展示。「按模型」按模型原生货币显示（gpt 用 USD，国产模型用 RMB）。
        </span>
      </div>

      <div class="form-group settings-toggle-row">
        <label for="setting-auto-connect">启动时自动连接</label>
        <Switch
          id="setting-auto-connect"
          checked={autoConnect}
          onCheckedChange={onAutoConnectChange}
          ariaLabel="启动时自动连接"
        />
      </div>

      <div class="form-group settings-toggle-row">
        <label for="setting-auto-rename">自动生成会话名</label>
        <Switch
          id="setting-auto-rename"
          checked={autoRename}
          onCheckedChange={onAutoRenameChange}
          ariaLabel="自动生成会话名"
        />
      </div>

      <div class="form-group">
        <label for="setting-sort-order">会话列表排序</label>
        <select
          id="setting-sort-order"
          value={sortOrder}
          onChange={(e) =>
            onSortOrderChange(
              (e.currentTarget as HTMLSelectElement).value as SortOrder,
            )
          }
        >
          {(["recent", "created", "name"] as SortOrder[]).map((s) => (
            <option key={s} value={s}>
              {sortOrderLabels[s]}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

// ── 数据危险操作区 (per SVG 11 + alpha-14 2-step confirmation) ────────
//
// alpha-14 upgrade: clear-all-sessions + reset-all-settings now go
// through a 2-step confirmation flow (per AGENTS.md §4 dangerous-action
// rule):
//   1. User clicks the action button to reveal an inline panel.
//   2. User checks "我已了解…" to acknowledge data loss.
//   3. CountdownButton locks for 5s before "确认 X" becomes clickable.
//   4. Click → invoke real command → close settings modal.
//
// Backup create/restore open the backup modal directly (no inline
// confirmation here — alpha-9 already does that flow inside the
// backup modal with PasswordInput + CountdownButton).

// ── v0.2-alpha-32.3: 数据存储位置 (Issue 4) ────────────────────────────────
//
// Manual verification of alpha-32 surfaced "默认项目路径感觉是个摆设"
// — users assumed sessions/files would be written into the project
// directory, then were confused that it stayed empty. In fact the
// project path is metadata (scanned into a 4 KB summary for the
// system prompt). All actual app data lives in the OS-standard
// app config dir, regardless of project path.
//
// The group is collapsed by default (click to expand) so it doesn't
// add visual weight for users who don't care. Inside: an OS-keyed
// list of paths for sessions.db / config.json / media cache, plus
// an explicit reminder that the project path is NOT a storage path,
// and a one-click link into the backup modal.

function StorageInfoGroup(): preact.JSX.Element {
  // Path constants match the Tauri config_dir layout. Update
  // src-tauri/tauri.conf.json → identifier if these change.
  const identifier = "com.admin.hermes-tray-tauri";
  const paths: Array<{ os: string; config: string; data: string; media: string }> = [
    {
      os: "Windows",
      config: `%APPDATA%\\${identifier}\\`,
      data: `%APPDATA%\\${identifier}\\sessions.db`,
      media: `%APPDATA%\\${identifier}\\media\\`,
    },
    {
      os: "macOS",
      config: `~/Library/Application Support/${identifier}/`,
      data: `~/Library/Application Support/${identifier}/sessions.db`,
      media: `~/Library/Application Support/${identifier}/media/`,
    },
    {
      os: "Linux",
      config: `~/.config/${identifier}/`,
      data: `~/.config/${identifier}/sessions.db`,
      media: `~/.config/${identifier}/media/`,
    },
  ];

  return (
    <section
      class="settings-group settings-group--collapsible"
      aria-labelledby="settings-storage-title"
    >
      <details class="settings-storage-info">
        <summary>
          <span aria-hidden="true">📂</span>{" "}
          <span id="settings-storage-title">数据存储位置</span>
          <span class="settings-storage-info-hint">
            （点开查看）会话/Persona/项目元数据存在哪
          </span>
        </summary>
        <div class="settings-storage-info-body">
          <table class="settings-storage-table" aria-label="按平台列出数据存储路径">
            <thead>
              <tr>
                <th scope="col">平台</th>
                <th scope="col">路径</th>
              </tr>
            </thead>
            <tbody>
              {paths.flatMap((p) => [
                <tr>
                  <th scope="row">{p.os}</th>
                  <td>
                    <code>{p.data}</code>
                    <br />
                    <small>
                      <code>{p.config}</code>config.json · media/
                    </small>
                  </td>
                </tr>,
              ])}
            </tbody>
          </table>
          <p class="settings-storage-info-callout">
            <strong>默认项目上下文</strong>是给 AI 提供项目背景
            （README / package.json / .git/config），不会写文件到这里。
            备份请用下方<strong>创建加密备份</strong>。
          </p>
        </div>
      </details>
    </section>
  );
}

function DangerZoneGroup({
  onBackupCreate,
  onBackupRestore,
  onClearAllSessions,
  onResetAllSettings,
}: {
  onBackupCreate: () => void;
  onBackupRestore: () => void;
  onClearAllSessions: () => Promise<void>;
  onResetAllSettings: () => Promise<void>;
}) {
  // Which destructive action is currently showing its confirmation
  // panel? Only one at a time.
  const [confirming, setConfirming] = useState<"clear" | "reset" | null>(null);
  const [understand, setUnderstand] = useState(false);

  // Opening one confirmation closes the other + resets the checkbox.
  function openPanel(target: "clear" | "reset"): void {
    if (confirming === target) {
      setConfirming(null);
      setUnderstand(false);
    } else {
      setConfirming(target);
      setUnderstand(false);
    }
  }

  async function handleConfirmed(): Promise<void> {
    // Reset understanding before closing so reopening starts fresh.
    setUnderstand(false);
    setConfirming(null);
    if (confirming === "clear") {
      await onClearAllSessions();
    } else if (confirming === "reset") {
      await onResetAllSettings();
    }
  }

  return (
    <section class="settings-group settings-danger-zone" aria-labelledby="settings-danger-title">
      <h3 id="settings-danger-title">
        <span aria-hidden="true">⚠️</span> 数据 <span aria-hidden="true">⚠️</span> 危险操作区
      </h3>
      <p class="form-hint">操作不可逆，请谨慎。</p>
      <div class="settings-danger-grid">
        <button
          type="button"
          class="settings-danger-btn"
          onClick={onBackupCreate}
        >
          <span class="settings-danger-icon" aria-hidden="true">🛡️</span>
          <span>创建加密备份</span>
        </button>
        <button
          type="button"
          class="settings-danger-btn"
          onClick={onBackupRestore}
        >
          <span class="settings-danger-icon" aria-hidden="true">📥</span>
          <span>恢复备份</span>
        </button>
        <button
          type="button"
          class={`settings-danger-btn${confirming === "clear" ? " active" : ""}`}
          aria-expanded={confirming === "clear" ? "true" : "false"}
          onClick={() => openPanel("clear")}
        >
          <span class="settings-danger-icon" aria-hidden="true">🗑️</span>
          <span>清除所有会话</span>
        </button>
        <button
          type="button"
          class={`settings-danger-btn${confirming === "reset" ? " active" : ""}`}
          aria-expanded={confirming === "reset" ? "true" : "false"}
          onClick={() => openPanel("reset")}
        >
          <span class="settings-danger-icon" aria-hidden="true">↺</span>
          <span>重置所有设置</span>
        </button>
      </div>

      {confirming === "clear" ? (
        <DangerConfirmPanel
          kind="clear"
          understand={understand}
          onUnderstandChange={setUnderstand}
          onCancel={() => {
            setConfirming(null);
            setUnderstand(false);
          }}
          onConfirm={() => void handleConfirmed()}
        />
      ) : confirming === "reset" ? (
        <DangerConfirmPanel
          kind="reset"
          understand={understand}
          onUnderstandChange={setUnderstand}
          onCancel={() => {
            setConfirming(null);
            setUnderstand(false);
          }}
          onConfirm={() => void handleConfirmed()}
        />
      ) : null}
    </section>
  );
}

// Inline confirmation panel for the 2-step dangerous-action flow.
//
// Shows a warning text specific to the destructive kind, an "我已了解"
// checkbox, and a CountdownButton that locks for 5s before becoming
// clickable. AGENTS.md §4: red outline (not solid red) + 2-step + checkbox.

function DangerConfirmPanel({
  kind,
  understand,
  onUnderstandChange,
  onCancel,
  onConfirm,
}: {
  kind: "clear" | "reset";
  understand: boolean;
  onUnderstandChange: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const warning =
    kind === "clear"
      ? "将永久删除所有会话及其消息（外键级联）。下次启动需要新建会话。"
      : "将清空所有偏好设置（主题 / 费用货币 / 自动连接 / 自动重命名 / 排序）以及本地 WSL Gateway 配置。下次启动将使用 CONFIG_SCHEMA 默认值。";
  const readyLabel = kind === "clear" ? "🗑️ 确认清除所有会话" : "↺ 确认重置所有设置";

  return (
    <div class="settings-danger-confirm" role="region" aria-label={readyLabel}>
      <p class="settings-danger-warning">{warning}</p>
      <label class="settings-confirm-row">
        <input
          type="checkbox"
          checked={understand}
          onChange={(e) =>
            onUnderstandChange((e.currentTarget as HTMLInputElement).checked)
          }
        />
        <span>我已了解：此操作不可恢复</span>
      </label>
      <div class="settings-danger-confirm-actions">
        <button type="button" class="btn btn-secondary" onClick={onCancel}>
          取消
        </button>
        <CountdownButton
          readyLabel={readyLabel}
          blocked={!understand}
          onConfirm={onConfirm}
          className="danger"
        />
      </div>
    </div>
  );
}