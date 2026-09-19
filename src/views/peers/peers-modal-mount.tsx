// v0.4.1 — Mount the PeersModal into the <div id="peers-modal"> overlay
// root defined in index.html (跟 confirm-modal-mount 教训 ④ hidden-sync
// pattern 1:1 配对: Preact panel render 进 shell 但父级 display:none 必须
// 由 store subscription 同步, 否则 open 后用户看不到).

import { render } from "preact";
import { PeersModal } from "./PeersModal";
import { peersModalStore } from "./peers-modal-store";

// Re-export so main.ts has a single import path (跟 confirm-modal-mount
// "single import path for mount + request API" 1:1 配对).
export { peersModalStore } from "./peers-modal-store";
export { peerCatalog, PEER_ENDPOINTS_CONFIG_KEY } from "./peer-catalog";

export function mountPeersModal(targetId = "peers-modal"): HTMLElement {
  const root = document.getElementById(targetId);
  if (!root) {
    console.warn(`[Hermes] #${targetId} mount point missing`);
    throw new Error(`mount point #${targetId} not found`);
  }
  const syncHidden = (s: { open: boolean }) => {
    root.classList.toggle("hidden", !s.open);
  };
  syncHidden(peersModalStore.get());
  peersModalStore.subscribe(syncHidden);
  render(<PeersModal />, root);
  return root;
}
