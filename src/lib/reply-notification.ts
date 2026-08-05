import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

const REPLY_NOTIFICATION_KIND = "reply-complete";

export function replyNotificationBody(userPrompt: string): string {
  const compact = userPrompt.replace(/\s+/g, " ").trim();
  const preview = compact.length > 30 ? `${compact.slice(0, 30)}…` : compact;
  return preview
    ? `“${preview}”已回复，点击查看`
    : "你的消息已回复，点击查看";
}

export async function notifyReplyIfBackground(userPrompt: string): Promise<boolean> {
  try {
    const appWindow = getCurrentWindow();
    if (await appWindow.isFocused()) return false;

    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return false;

    sendNotification({
      title: "Hermes Chat",
      body: replyNotificationBody(userPrompt),
      autoCancel: true,
      extra: { kind: REPLY_NOTIFICATION_KIND },
    });
    return true;
  } catch (error) {
    console.warn("[P1-12] Failed to send reply notification:", error);
    return false;
  }
}

export async function initReplyNotificationActions(): Promise<() => Promise<void>> {
  const listener = await onAction((notification) => {
    if (notification.extra?.kind !== REPLY_NOTIFICATION_KIND) return;
    const appWindow = getCurrentWindow();
    void appWindow.show().then(() => appWindow.setFocus()).catch((error) => {
      console.warn("[P1-12] Failed to focus window from notification:", error);
    });
  });
  return () => listener.unregister();
}
