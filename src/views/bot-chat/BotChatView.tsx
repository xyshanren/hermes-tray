// v0.4.0 — BotChatView Preact component (跟 chat-view.tsx 1:1 配对 渲染 pattern,
// 跟 mavis MEMORY 30-34 行 "三件套" 1:1 配对).
//
// 轻量多 bot 群聊 UI (单聊 + 群组简版, 跟 plan §1.1 1:1 配对):
//   - 6 bot 同室 (跟 plan §1.1 1:1 配对)
//   - @ mention 路由: @researcher / @coder / @tester
//   - 0 头像/0 Discord 风格 (跟 mavis 9-03 12:40 拍 "轻量" 1:1 配对)
//   - Mock reply 0.5s 模拟 (跟 plan §1.1 0 实际 Tauri invoke 1:1 配对,
//     留 v0.4.1 接 Tauri IPC bridge)
//
// 跟现有 chat-view.tsx 1:1 配对:
//   - 0 改 chat-view.tsx (跟 mavis "UX 倒退审计" 1:1 配对 0 改 happy path)
//   - 复用 tailwind + shadcn/ui 组件 (Card / Button / Input / 等)
//   - 复用 markdown 解析 (跟 chat-view.tsx 1:1 配对, 留 v0.4.1)

import { useEffect, useState } from "preact/hooks";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card } from "../../components/ui/card";
import { botChatStore, type BotMessage, type BotPeer, type BotChatStoreState } from "./bot-chat-store";

const MOCK_REPLY_DELAY_MS = 500;

function parseMentions(text: string, peers: BotPeer[]): string[] {
  // 跟 plan §1.1 "@researcher / @coder / @tester" 1:1 配对
  const validMentions = new Set(peers.map((p) => p.mention));
  const matches: string[] = [];
  const regex = /@(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (validMentions.has(m[1]) && !matches.includes(m[1])) {
      matches.push(m[1]);
    }
  }
  return matches;
}

function PeerBadge({ peer }: { peer: BotPeer }) {
  // 0 头像/0 Discord 风格 (跟 mavis 9-03 12:40 拍 1:1 配对): 走纯文字 badge
  return (
    <span class="inline-block rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
      @{peer.mention}
    </span>
  );
}

function MessageBubble({ msg, peers }: { msg: BotMessage; peers: BotPeer[] }) {
  const isUser = msg.from === "user";
  const peer = peers.find((p) => p.id === msg.from);
  return (
    <div class={`mb-2 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        class={`max-w-[80%] rounded-lg px-3 py-2 ${
          isUser ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-900"
        }`}
      >
        <div class="mb-1 flex items-center gap-2 text-xs">
          {peer ? <PeerBadge peer={peer} /> : <span class="text-xs opacity-70">You</span>}
          <span class="opacity-70">{msg.timestamp.toLocaleTimeString()}</span>
        </div>
        <div class="whitespace-pre-wrap text-sm">{msg.content}</div>
        {msg.mentions && msg.mentions.length > 0 && (
          <div class="mt-1 flex flex-wrap gap-1">
            {msg.mentions.map((m) => (
              <span key={m} class="rounded bg-yellow-200 px-1 text-xs text-yellow-900">
                routed→@{m}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StreamingBubbleView({ content, peers }: { content: string; peers: BotPeer[] }) {
  return (
    <div class="mb-2 flex justify-start">
      <div class="max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-slate-900">
        <div class="mb-1 text-xs opacity-70">{peers[0]?.mention ?? "..."}</div>
        <div class="whitespace-pre-wrap text-sm">{content || "..."}</div>
      </div>
    </div>
  );
}

export function BotChatView() {
  const [s, setS] = useState<BotChatStoreState>(botChatStore.get());
  const [draft, setDraft] = useState("");

  useEffect(() => {
    return botChatStore.subscribe(setS);
  }, []);

  function handleSend() {
    const content = draft.trim();
    if (!content || s.isLoading) return;
    const mentions = parseMentions(content, s.peers);
    botChatStore.addUserMessage(content, mentions);
    setDraft("");

    // Mock reply: route to peer via mentions, then stream 0.5s
    const peerId = botChatStore.routeMockReply(mentions);
    botChatStore.startBotStream(peerId);
    let accumulated = "";
    const replyText = `[${peerId}] echo: ${content}`;
    let i = 0;
    const interval = setInterval(() => {
      if (i >= replyText.length) {
        clearInterval(interval);
        botChatStore.finishBotStream();
        return;
      }
      accumulated += replyText[i];
      i += 1;
      botChatStore.appendBotChunk(replyText[i - 1] ?? "");
    }, MOCK_REPLY_DELAY_MS / Math.max(replyText.length, 1));
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div class="flex h-full flex-col">
      <div class="mb-2 flex items-center justify-between border-b pb-2">
        <h2 class="text-lg font-semibold">Bot Chat</h2>
        <div class="flex gap-1">
          {s.peers.map((p) => (
            <PeerBadge key={p.id} peer={p} />
          ))}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto" data-testid="bot-chat-messages">
        {s.messages.length === 0 && !s.streaming && (
          <Card class="p-4 text-center text-sm text-slate-500">
            Start a conversation. Use @researcher / @coder / @tester to route to a
            specific bot. 0 mention routes to the first peer.
          </Card>
        )}
        {s.messages.map((m) => (
          <MessageBubble key={m.id ?? `${m.timestamp.getTime()}-${m.from}`} msg={m} peers={s.peers} />
        ))}
        {s.streaming && (
          <StreamingBubbleView content={s.streaming.content} peers={s.peers} />
        )}
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
          placeholder="Message (use @researcher / @coder / @tester to route)"
          disabled={s.isLoading}
          data-testid="bot-chat-input"
        />
        <Button onClick={handleSend} disabled={s.isLoading || !draft.trim()}>
          {s.isLoading ? "..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
