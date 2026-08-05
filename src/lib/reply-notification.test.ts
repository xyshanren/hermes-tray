import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isFocused: vi.fn(),
  show: vi.fn(),
  setFocus: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  onAction: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: mocks.isFocused,
    show: mocks.show,
    setFocus: mocks.setFocus,
  }),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: mocks.isPermissionGranted,
  requestPermission: mocks.requestPermission,
  sendNotification: mocks.sendNotification,
  onAction: mocks.onAction,
}));

import {
  initReplyNotificationActions,
  notifyReplyIfBackground,
  replyNotificationBody,
} from "./reply-notification";

describe("reply notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.show.mockResolvedValue(undefined);
    mocks.setFocus.mockResolvedValue(undefined);
    mocks.unregister.mockResolvedValue(undefined);
    mocks.onAction.mockResolvedValue({ unregister: mocks.unregister });
  });

  it("compacts and truncates the user prompt", () => {
    expect(replyNotificationBody("  hello\n world  ")).toBe(
      "“hello world”已回复，点击查看",
    );
    expect(replyNotificationBody("123456789012345678901234567890x")).toBe(
      "“123456789012345678901234567890…”已回复，点击查看",
    );
  });

  it("skips notification while the window is focused", async () => {
    mocks.isFocused.mockResolvedValue(true);

    await expect(notifyReplyIfBackground("hello")).resolves.toBe(false);

    expect(mocks.isPermissionGranted).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("sends a native notification for a background reply", async () => {
    mocks.isFocused.mockResolvedValue(false);
    mocks.isPermissionGranted.mockResolvedValue(true);

    await expect(notifyReplyIfBackground("hello")).resolves.toBe(true);

    expect(mocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Hermes Chat",
      body: "“hello”已回复，点击查看",
      extra: { kind: "reply-complete" },
    }));
  });

  it("focuses the main window when the reply notification is activated", async () => {
    let action: ((notification: { extra?: Record<string, unknown> }) => void) | undefined;
    mocks.onAction.mockImplementation(async (callback) => {
      action = callback;
      return { unregister: mocks.unregister };
    });

    const dispose = await initReplyNotificationActions();
    action?.({ extra: { kind: "reply-complete" } });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.show).toHaveBeenCalled();
    expect(mocks.setFocus).toHaveBeenCalled();
    await dispose();
    expect(mocks.unregister).toHaveBeenCalled();
  });
});
