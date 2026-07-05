// v0.2-alpha-5 — SegmentedControl (companion to the .segmented styles).
//
// Used for small single-choice option groups (theme picker, sort order, etc).
// Radix has no dedicated primitive; built on top of plain buttons + ARIA
// radiogroup semantics so screen readers announce it correctly without
// pulling in @radix-ui/react-toggle-group just for this one widget.
//
// API is intentionally narrow — pass an options array and you get back
// the selected value via onChange. The visual styling lives in styles.css
// under .segmented / .segmented-btn (set up in alpha-2 for the settings
// modal theme picker stop-gap; this component reuses the same classes).

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Optional aria-label override; defaults to the option's label text. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  /** Accessible label for the whole group (required for a11y). */
  "aria-label": string;
  className?: string;
  /** Disable the entire control. */
  disabled?: boolean;
}

export function SegmentedControl<T extends string>(
  props: SegmentedControlProps<T>,
): React.JSX.Element {
  const { value, onChange, options, className, disabled } = props;
  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      className={cn("segmented", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            disabled={disabled}
            data-value={opt.value}
            className={cn("segmented-btn", active && "active")}
            onClick={() => {
              if (!active) onChange(opt.value);
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}