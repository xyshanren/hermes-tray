// v0.2-alpha-13 — Switch component (shadcn-style toggle switch).
//
// Pure CSS + Preact — no Radix dependency. Used by the SettingsModal
// "偏好" section (auto_connect / auto_rename toggles per SVG 11).
//
// Inspired by shadcn/ui's switch component but simplified for the v0.2
// tray (no controlled-vs-uncontrolled split, no animation primitives).
// The visible handle slides via CSS transform on the data-state attribute.

import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Accessible label id. Render a <label htmlFor=...> separately. */
  id?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  id,
  disabled,
  className,
  ariaLabel,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked ? "true" : "false"}
      aria-label={ariaLabel}
      disabled={disabled}
      data-state={checked ? "checked" : "unchecked"}
      class={cn("switch", className)}
      onClick={() => !disabled && onCheckedChange(!checked)}
    >
      <span class="switch-thumb" data-state={checked ? "checked" : "unchecked"} />
    </button>
  );
}