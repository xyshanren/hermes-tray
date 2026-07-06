// v0.2-alpha-19 — Shortcuts modal store.
//
// Pub-sub for the keyboard-shortcuts reference modal (design 16 in
// the SVG set). Lists 7 shortcuts across 3 groups — the modal is a
// pure renderer so main.ts only flips the visibility.
//
// Trigger: Ctrl+/ opens the modal (handler added to the global
// keydown listener in DOMContentLoaded). Escape closes it.

interface ShortcutsModalState {
  open: boolean;
}

export type { ShortcutsModalState };

type Listener = (state: ShortcutsModalState) => void;

let state: ShortcutsModalState = { open: false };
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(state);
}

export const shortcutsModalStore = {
  get(): ShortcutsModalState {
    return state;
  },
  setOpen(open: boolean): void {
    if (state.open === open) return;
    state = { open };
    notify();
  },
  toggle(): boolean {
    state = { open: !state.open };
    notify();
    return state.open;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  },
  __resetForTests(): void {
    state = { open: false };
    listeners.clear();
  },
};

/**
 * The 7 keyboard shortcuts grouped per design 16. The view
 * iterates this array — keep the order matching the SVG layout so
 * step-9 pixel verification passes (group headers + items in the
 * same vertical position).
 */
export interface ShortcutRow {
  keys: string[];
  description: string;
}

export interface ShortcutGroup {
  name: string;
  shortcuts: ShortcutRow[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: "全局",
    shortcuts: [
      { keys: ["Ctrl", "N"], description: "新建会话" },
      { keys: ["Ctrl", "K"], description: "搜索会话" },
      { keys: ["Ctrl", "/"], description: "显示快捷键面板" },
    ],
  },
  {
    name: "输入区",
    shortcuts: [
      { keys: ["Enter"], description: "发送消息" },
      { keys: ["Shift", "Enter"], description: "输入框换行" },
    ],
  },
  {
    name: "通用",
    shortcuts: [
      { keys: ["Esc"], description: "关闭 modal / 取消编辑" },
      { keys: ["Ctrl", ","], description: "打开设置" },
    ],
  },
];