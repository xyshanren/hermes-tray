// v0.4.0 — PeerDMView Preact component (跟 BotChatView 60% 复用, 跟 plan
// §1.2 1:1 配对).
//
// 0 改 BotChatView (跟 mavis "UX 倒退审计" 1:1 配对 0 改 happy path), 走独立
// 3 件套 (跟 mavis MEMORY 30-34 行 "三件套" 1:1 配对).
//
// 跟 BotChat 差异 (跟 plan §1.2 1:1 配对):
//   - 1 peer only (单聊, 0 群组 0 mention 路由)
//   - 0 头像/0 Discord 风格 (跟 mavis 9-03 12:40 拍 "轻量" 1:1 配对)
//   - 显示 gateway URL (跨 Gateway Tailscale / VPN 私网内 标识)
//   - Mock reply 0.5s 模拟 (跟 D.1 BotChat 1:1 配对, 留 v0.4.1 接 IPC bridge)

import { useEffect, useState } from "preact/hooks";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card } from "../../components/ui/card";
import {
  peerDMStore,
  type PeerDMState,
  type PeerDMMessage,
} from "./peer-dm-store";

const MOCK_REPLY_DELAY_MS = 500;

function MessageBubble({ msg }: { msg: PeerDMMessage }) {
  const isUser = msg.from === "user";
  return (
    <div class={`mb-2 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        class={`max-w-[80%] rounded-lg px-3 py-2 ${
          isUser ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-900"
        }`}
      >
        <div class="mb-1 text-xs opacity-70">
          {msg.timestamp.toLocaleTimeString()}
        </div>
        <div class="whitespace-pre-wrap text-sm">{msg.content}</div>
      </div>
    </div>
  );
}

function StreamingBubbleView({ content }: { content: string }) {
  return (
    <div class="mb-2 flex justify-start">
      <div class="max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-slate-900">
        <div class="whitespace-pre-wrap text-sm">{content || "..."}</div>
      </div>
    </div>
  );
}

export function PeerDMView() {
  const [s, setS] = useState<PeerDMState>(peerDMStore.get());
  const [draft, setDraft] = useState("");

  useEffect(() => {
    return peerDMStore.subscribe(setS);
  }, []);

  function handleSend() {
    if (!s.peer) {
      peerDMStore.setError("No peer selected. Call setPeer() first.");
      return;
    }
    const content = draft.trim();
    if (!content || s.isLoading) return;
    peerDMStore.addUserMessage(content);
    setDraft("");

    // Mock reply (跟 D.1 BotChat 1:1 配对 1:1 pattern)
    peerDMStore.startPeerStream();
    const replyText = `[${s.peer.name}] echo: ${content}`;
    let i = 0;
    const interval = setInterval(() => {
      if (i >= replyText.length) {
        clearInterval(interval);
        peerDMStore.finishPeerStream();
        return;
      }
      peerDMStore.appendPeerChunk(replyText[i] ?? "");
      i += 1;
    }, MOCK_REPLY_DELAY_MS / Math.max(replyText.length, 1));
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!s.peer) {
    return (
      <div class="flex h-full items-center justify-center p-4">
        <Card class="p-4 text-center text-sm text-slate-500">
          No peer selected. Use peerDMStore.setPeer() with a Tailscale / VPN
          gateway URL to start a DM session.
        </Card>
      </div>
    );
  }

  return (
    <div class="flex h-full flex-col" data-testid="peer-dm-root">
      <div class="mb-2 flex items-center justify-between border-b pb-2">
        <div>
          <h2 class="text-lg font-semibold">{s.peer.name}</h2>
          <div class="text-xs text-slate-500" data-testid="peer-dm-gateway">
            {s.peer.gateway}
          </div>
        </div>
        {s.hasPersistedHistory && (
          <span class="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
            history loaded
          </span>
        )}
      </div>

      <div class="flex-1 overflow-y-auto" data-testid="peer-dm-messages">
        {s.messages.length === 0 && !s.streaming && (
          <Card class="p-4 text-center text-sm text-slate-500">
            Start a conversation. Messages mock-reply in 0.5s (跟 plan §1.2
            "mock reply" 1:1 配对, 留 v0.4.1 接 Tauri IPC bridge).
          </Card>
        )}
        {s.messages.map((m) => (
          <MessageBubble
            key={m.id ?? `${m.timestamp.getTime()}-${m.from}`}
            msg={m}
          />
        ))}
        {s.streaming && <StreamingBubbleView content={s.streaming.content} />}
        {s.error && (
          <div class="mb-2 rounded bg-red-100 px-3 py-2 text-sm text-red-700">
            {s.error}
          </div>
        )}
      </div>

      <div class="mt-2 flex gap-2 border-t pt-2">
        <Input
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={handleKey}
          placeholder="Message (DM mock reply)"
          disabled={s.isLoading}
          data-testid="peer-dm-input"
        />
        <Button onClick={handleSend} disabled={s.isLoading || !draft.trim()}>
          {s.isLoading ? "..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
