// v0.2-alpha-19 — Mount the SplashScreen Preact component into the
// existing <div id="splash"> shell defined in index.html. The shell is
// visible by default (no .hidden class) so the user sees the splash
// while the JS bundle loads.

import { render } from "preact";
import { SplashScreen } from "./splash-view";

export function mountSplashScreen(targetId = "splash"): HTMLElement {
  const root = document.getElementById(targetId);
  if (!root) {
    console.warn(`[Hermes] #${targetId} mount point missing`);
    throw new Error(`mount point #${targetId} not found`);
  }
  render(<SplashScreen />, root);
  return root;
}