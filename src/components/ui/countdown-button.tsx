// v0.2-alpha-14 — CountdownButton (shared).
//
// Extracted from src/views/backup-modal.tsx (originally inline) so other
// modals can reuse the same 5s lockout UX for destructive actions
// without coupling to the backup view.
//
// Per AGENTS.md §4 dangerous-action rule: red outline (not solid red)
// + 2-step confirmation. This component renders the "确认" button
// that stays disabled for `durationMs` (default 5000) then enables.
// The CALLER is responsible for adding the "我已了解" checkbox
// (so the user explicitly acknowledges the destructive intent) —
// this component just handles the time-lockout half of the flow.

import { useEffect, useState } from "preact/hooks";

interface CountdownButtonProps {
  /** Total countdown duration in ms. Default 5000. */
  durationMs?: number;
  /** Label shown during countdown (e.g. "请等待 Xs…"). */
  countdownLabel?: (secondsLeft: number) => string;
  /** Label shown when the button is enabled and ready to click. */
  readyLabel: string;
  /** Called once when the user actually clicks. */
  onConfirm: () => void | Promise<void>;
  /** Optional extra class appended to the base `countdown-confirm` class
   *  for variant styling (e.g. `danger` outline, `ghost`, etc.). */
  className?: string;
  /** When true, the button stays disabled regardless of countdown (e.g.
   *  the user hasn't checked "我已了解"). */
  blocked?: boolean;
}

export function CountdownButton({
  durationMs = 5000,
  countdownLabel,
  readyLabel,
  onConfirm,
  className,
  blocked = false,
}: CountdownButtonProps) {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(durationMs / 1000));
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) return;
    const handle = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(handle);
          setDone(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(handle);
  }, [done]);

  const enabled = done && !blocked;

  return (
    <button
      type="button"
      class={`countdown-confirm ${className ?? ""}`}
      disabled={!enabled}
      aria-disabled={!enabled}
      onClick={() => void onConfirm()}
    >
      {!done
        ? (countdownLabel ?? ((s) => `请等待 ${s}s…`))(secondsLeft)
        : readyLabel}
    </button>
  );
}