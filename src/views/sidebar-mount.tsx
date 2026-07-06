// v0.2-alpha-17 — Wire the sidebar <aside> visibility to sidebarStore.
//
// The sidebar's outer container is static markup in index.html
// (the header with action buttons + <div id="session-list">). All we
// need here is a tiny subscription that toggles the `hidden` class on
// the <aside> + the showBtn style, in sync with the store.
//
// Why a separate file instead of inlining in main.ts? Because the
// subscription belongs with the store module — anyone who imports
// sidebarStore gets visibility behaviour wired for free. main.ts just
// calls mountSidebar() in DOMContentLoaded.

import { sidebarStore } from "./sidebar-store";

// Re-export so main.ts has a single import path.
export { sidebarStore };

export function mountSidebar(): void {
  const sidebar = document.getElementById("sidebar");
  const showBtn = document.getElementById("sidebar-show-btn");
  if (!sidebar || !showBtn) {
    console.warn("[Hermes] #sidebar / #sidebar-show-btn mount points missing");
    return;
  }
  // Sync the DOM with the store. Both sidebar.hidden + showBtn.display
  // are derived purely from the boolean — the showBtn is visible iff
  // the sidebar is hidden (and vice versa). The CSS uses display:none
  // for the showBtn when the sidebar is visible so the header collapses
  // neatly on narrow windows.
  const sync = (visible: boolean) => {
    sidebar.classList.toggle("hidden", !visible);
    showBtn.style.display = visible ? "none" : "";
  };
  sync(sidebarStore.get());
  sidebarStore.subscribe(sync);
}