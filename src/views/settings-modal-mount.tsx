// v0.2-alpha-11 — Mount the SettingsModal Preact component into the
// `<div id="settings-modal">` overlay root defined in index.html.
//
// The overlay's hidden class still controls visibility — this module
// just renders the inner modal panel and wires up the store subscription
// so external openSettings()/closeSettings() calls drive re-renders.
//
// onDefaultsChanged is called after a successful save so main.ts can
// refresh its module-level defaultProjectPath + defaultModel lets.

import { render } from "preact";
import { SettingsModal } from "./settings-modal";
import { settingsStore } from "./settings-modal-store";

export function mountSettingsModal(opts: {
  onDefaultsChanged: (defaults: {
    defaultProjectPath: string | null;
    defaultModel: string | null;
  }) => void;
}): void {
  const root = document.getElementById("settings-modal");
  if (!root) {
    console.warn("[Hermes] #settings-modal mount point missing in index.html");
    return;
  }

  // Sync the overlay's hidden class with the store so external callers
  // (openSettings/closeSettings) keep toggling visibility as before.
  const syncHidden = (open: boolean) => {
    root.classList.toggle("hidden", !open);
  };
  syncHidden(settingsStore.getOpen());
  settingsStore.subscribe(syncHidden);

  // v0.3: click-outside-to-close. Settings are auto-saved on change
  // so dismissing via overlay click never loses data.
  root.addEventListener("click", (e) => {
    if (e.target === root) settingsStore.setOpen(false);
  });

  render(<SettingsModal onDefaultsChanged={opts.onDefaultsChanged} />, root);
}