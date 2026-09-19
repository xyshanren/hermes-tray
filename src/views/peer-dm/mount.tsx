// v0.4.1 — Mount the PeerDMView Preact component into the existing
// `<div id="messages">` shell (跟 bot-chat/mount.tsx 1:1 配对 — v0.4.0
// 交付时 peer-dm 缺 mount 文件, 本文件补齐; v0.4.1 视图切换器接入)。

import { render } from "preact";
import { PeerDMView } from "./PeerDMView";

export { peerDMStore } from "./peer-dm-store";

export function mountPeerDMView(): void {
  const root = document.getElementById("messages");
  if (!root) {
    console.warn("[Hermes] #messages mount point missing in index.html (peer-dm)");
    return;
  }
  root.innerHTML = "";
  render(<PeerDMView />, root);
}
