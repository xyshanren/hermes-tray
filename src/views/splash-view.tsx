// v0.2-alpha-19 — Splash screen (Preact JSX).
//
// Renders the boot-time splash overlay per design 17 in the SVG set:
// LOGO (👔) + "Hermes Chat" + version + purple progress bar +
// connection status text + copyright line.
//
// The splash starts at progress=0 + status="连接 Hermes Gateway..."
// and fills as main.ts drives the store. Once the chat view is mounted
// and the initial state fetched, main.ts calls splashStore.hide() —
// the view fades out via CSS (.is-hiding class) and unmounts after
// the transition ends.
//
// The view renders NOTHING once visible=false — that way the user
// sees the chat view underneath. We don't keep an empty overlay
// hanging around because that would block clicks.

import { useEffect, useState } from "preact/hooks";
import { splashStore } from "./splash-store";
import type { SplashState } from "./splash-store";

export function SplashScreen() {
  const state = useSplashStoreState();
  if (!state.visible) return null;
  return (
    <div class="splash-screen" role="status" aria-live="polite">
      <div class="splash-content">
        <div class="splash-logo">👔</div>
        <div class="splash-brand">
          <span class="splash-brand-name">Hermes Chat</span>
          <span class="splash-brand-version">v{APP_VERSION}</span>
        </div>
        <div class="splash-progress-track">
          <div
            class="splash-progress-fill"
            style={`width: ${state.progress}%`}
          />
        </div>
        <div class="splash-status">{state.status}</div>
        <div class="splash-copyright">Copyright 2026 Hermes</div>
      </div>
    </div>
  );
}

/**
 * The version string is hardcoded here for now — Tauri reads it from
 * Cargo.toml + package.json but we don't ship a runtime version API
 * yet. Update alongside releases.
 */
const APP_VERSION = "0.2.0";

function useSplashStoreState(): SplashState {
  const [state, setState] = useState<SplashState>(splashStore.get());
  useEffect(() => splashStore.subscribe(setState), []);
  return state;
}