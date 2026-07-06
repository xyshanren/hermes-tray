// verification/harness/mock-tauri.js — Inject BEFORE the app bundle
// loads. Defines a no-op `window.__TAURI_INTERNALS__` shim so the
// v0.2 app boots without crashing in a plain browser (no real Tauri
// runtime). main.ts's `invoke<T>(...)` calls resolve to type-safe
// defaults; the boot sequence still mounts splash → modals →
// sidebar → chat view. We can then trigger specific states via
// playwright + read them back from stores.
//
// The shim is intentionally permissive — most commands return
// benign empty values. A few commands return the shape main.ts
// expects so the UI doesn't error-loop:
//   - session_list → [] (so loadSessionList marks hasSessions=false
//     and the first-run welcome renders)
//   - persona_list → [] (so the picker shows the single default option)
//   - project_scan → null (caller checks for null before using)
//   - hermes_get → '' (no saved api key/port)
//   - everything else → undefined (callers handle missing data)
//
// Mount path: included as a <script> tag in each harness HTML
// page BEFORE the bundle's <script type="module"> tag.

(function () {
  const noop = () => Promise.resolve(undefined);

  // Map of command → resolver. Keep this small — main.ts gracefully
  // handles undefined for commands it doesn't expect.
  const commands = {
    session_list: () => Promise.resolve([]),
    session_get: () => Promise.resolve(null),
    session_create: () => Promise.resolve({
      id: "mock-session",
      title: "Mock session",
      created_at: Date.now(),
      updated_at: Date.now(),
      persona_id: null,
      project_path: null,
      model: "mock-model",
    }),
    session_delete: () => Promise.resolve(undefined),
    session_update: () => Promise.resolve({}),
    session_touch: () => Promise.resolve(undefined),
    message_list: () => Promise.resolve([]),
    persona_list: () => Promise.resolve([]),
    project_scan: () => Promise.resolve(null),
    hermes_get: () => Promise.resolve(""),
    hermes_get_config: () => Promise.resolve(""),
    hermes_set_config: () => Promise.resolve(undefined),
    db_config_get: () => Promise.resolve(null),
    db_config_set: () => Promise.resolve(undefined),
    db_config_list: () => Promise.resolve({}),
  };

  window.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => {
      const resolver = commands[cmd];
      if (resolver) return resolver(args);
      // Fall through with a no-op so main.ts's `if (data) {...}`
      // guards treat the result as "no data" without throwing.
      return Promise.resolve(undefined);
    },
    transformCallback: (cb) => cb,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };

  // Listen for the `tauri://close-requested` window event so unload
  // handlers don't throw.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = undefined;
})();