// v0.2-alpha-32.5 — Mount the ProjectPicker Preact component into the
// `<div id="header-project-picker">` container in the header.
//
// Replaces the static #header-project-chip / #header-project-name spans
// from alpha-27. The picker is always rendered (it self-hides when no
// session is active via the store's sessionId === null check).

import { render } from "preact";
import { ProjectPicker, type ProjectPickerProps } from "./project-picker";

export function mountProjectPicker(props: ProjectPickerProps): void {
  const root = document.getElementById("header-project-picker");
  if (!root) {
    console.warn("[Hermes] #header-project-picker mount point missing in index.html");
    return;
  }
  render(<ProjectPicker {...props} />, root);
}
