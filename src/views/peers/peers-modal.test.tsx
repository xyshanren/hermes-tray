// v0.4.1 — PeersModal 渲染 + 交互 tests (跟 backup-modal.test.tsx /
// shortcuts-modal.test.tsx 的 mount + act pattern 1:1 配对)。
// discoverAgent 走 fake transport (__setTransportForTests, 跟
// peer-bridge.test.ts 隔离 pattern 1:1 配对)。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { PeersModal } from "./PeersModal";
import { peersModalStore } from "./peers-modal-store";
import { peerCatalog } from "./peer-catalog";
import { __setTransportForTests } from "../../lib/peer-bridge";

const mockInvoke = vi.mocked(invoke);

// mount 包 act: flush useEffect 订阅 (Preact effects 在 act 外 render 时
// 排队, 不 flush 则后续 store notify 无监听者 — 跟 shortcuts-modal.test
// 同坑), 之后交互型 act 才能驱动重渲染
async function mountModal() {
  const host = document.createElement("div");
  host.id = "peers-modal";
  document.body.appendChild(host);
  await act(async () => {
    render(<PeersModal />, host);
  });
  return host;
}

async function typeInput(host: HTMLElement, selector: string, value: string) {
  const input = host.querySelector(selector) as HTMLInputElement;
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(null);
  peersModalStore.__resetForTests();
  peerCatalog.__resetForTests();
  __setTransportForTests(null);
  document.body.innerHTML = "";
});

describe("<PeersModal />", () => {
  it("closed → render null (shell 由 mount 层 hidden 同步)", async () => {
    const host = await mountModal();
    expect(host.querySelector(".modal-peers")).toBeNull();
  });

  it("open → 列表 + 表单渲染; add 成功后回列表模式 + catalog 落记录", async () => {
    const host = await mountModal();
    await act(async () => {
      peersModalStore.open();
    });
    expect(host.querySelector(".modal-peers")).not.toBeNull();
    expect(host.querySelector('[data-testid="peers-form"]')).not.toBeNull();

    await typeInput(host, 'input[placeholder="e.g. Coder"]', "Coder");
    await typeInput(host, 'input[placeholder="http://100.64.0.1:9999"]', "http://10.0.0.2:9999");
    await act(async () => {
      (
        host.querySelector('.peers-form button[type="submit"]') as HTMLButtonElement
      ).click();
    });

    expect(peerCatalog.get().records).toHaveLength(1);
    // 成功 → cancelEdit 回新增模式
    expect(peersModalStore.get().editingId).toBeNull();
    expect(host.querySelector('[data-testid="peers-row"]')).not.toBeNull();
  });

  it("add 重名 / URL 非法 → formError 展示, 0 落 catalog (0 静默)", async () => {
    peerCatalog.add("Coder", "http://ok");
    const host = await mountModal();
    await act(async () => {
      peersModalStore.open();
    });
    await typeInput(host, 'input[placeholder="e.g. Coder"]', "Coder");
    await typeInput(host, 'input[placeholder="http://100.64.0.1:9999"]', "http://x");
    await act(async () => {
      (host.querySelector('.peers-form button[type="submit"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-testid="peers-form-error"]')?.textContent).toContain(
      "同名",
    );
    expect(peerCatalog.get().records).toHaveLength(1);
  });

  it("验证连接: discoverAgent 成功 → 卡片摘要; 失败 → 独立 error 区", async () => {
    peerCatalog.add("Coder", "http://ok");
    const host = await mountModal();
    await act(async () => {
      peersModalStore.open();
    });
    await typeInput(host, 'input[placeholder="http://100.64.0.1:9999"]', "http://10.0.0.2:9999");

    __setTransportForTests({
      get: vi.fn(async (url: string) =>
        url.endsWith("agent-card.json")
          ? { ok: true, status: 200, body: JSON.stringify({ name: "Coder Bot", description: "x" }) }
          : { ok: false, status: 404, body: "" },
      ),
      post: vi.fn(async () => ({ ok: true, status: 200, body: "{}" })),
    });
    await act(async () => {
      (
        Array.from(host.querySelectorAll("button")).find(
          (b) => b.textContent === "验证连接",
        ) as HTMLButtonElement
      ).click();
      // verify() 是 fire-and-forget async 链, act 内 flush 微任务让结果落定
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('[data-testid="peers-verify-ok"]')?.textContent).toContain(
      "Coder Bot",
    );

    __setTransportForTests({
      get: vi.fn(async () => {
        throw new Error("conn refused");
      }),
      post: vi.fn(async () => ({ ok: true, status: 200, body: "{}" })),
    });
    await act(async () => {
      (
        Array.from(host.querySelectorAll("button")).find(
          (b) => b.textContent === "验证连接",
        ) as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('[data-testid="peers-verify-error"]')?.textContent).toContain(
      "conn refused",
    );
  });

  it("编辑 + 删除: startEdit 回填表单, remove 落 catalog", async () => {
    peerCatalog.add("Coder", "http://c", "tk");
    const host = await mountModal();
    await act(async () => {
      peersModalStore.open();
    });
    await act(async () => {
      (
        Array.from(host.querySelectorAll("button")).find(
          (b) => b.textContent === "编辑",
        ) as HTMLButtonElement
      ).click();
    });
    expect(peersModalStore.get().editingId).not.toBeNull();
    expect((host.querySelector('input[placeholder="e.g. Coder"]') as HTMLInputElement).value).toBe(
      "Coder",
    );

    await act(async () => {
      (
        Array.from(host.querySelectorAll("button")).find(
          (b) => b.textContent === "删除",
        ) as HTMLButtonElement
      ).click();
    });
    expect(peerCatalog.get().records).toHaveLength(0);
    expect(peersModalStore.get().editingId).toBeNull();
  });
});
