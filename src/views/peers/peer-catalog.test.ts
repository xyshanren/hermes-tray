// v0.4.1 — peer catalog tests (数据层 + 持久化 + 双 surface 映射)。
// db_config 走 vi.mock invoke (跟 api.test.ts 隔离 pattern 1:1 配对)。

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { peerCatalog, mentionFor, roleFor, PEER_ENDPOINTS_CONFIG_KEY } from "./peer-catalog";

const mockInvoke = vi.mocked(invoke);

/** 模拟 db_config KV (peer-catalog load 读 / persist 写) */
let kv: Record<string, string>;

beforeEach(() => {
  kv = {};
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: unknown, args?: unknown) => {
    const key = (args as { key?: string } | undefined)?.key ?? "";
    const value = (args as { value?: string } | undefined)?.value;
    if (cmd === "db_config_get") {
      // db_config_get 返回 ConfigEntry {key, value} (跟 db-config.ts
      // `entry?.value ?? null` 解包 1:1 配对), 未设置 → null
      return key in kv ? { key, value: kv[key] } : null;
    }
    if (cmd === "db_config_set") {
      kv[key] = value ?? "";
      return null;
    }
    return null;
  });
  peerCatalog.__resetForTests();
});

describe("peerCatalog", () => {
  it("load: empty / unset key → 空表 loaded", async () => {
    await peerCatalog.load();
    expect(peerCatalog.get()).toEqual({ records: [], loaded: true });
  });

  it("load: 合法 JSON → records; 非法 JSON → 归空 + 不抛 (独立 failure case)", async () => {
    kv[PEER_ENDPOINTS_CONFIG_KEY] = JSON.stringify([
      { id: "p1", name: "Coder", url: "http://10.0.0.2:9999" },
    ]);
    await peerCatalog.load();
    expect(peerCatalog.get().records).toHaveLength(1);

    kv[PEER_ENDPOINTS_CONFIG_KEY] = "{not-json";
    await peerCatalog.load();
    expect(peerCatalog.get().records).toEqual([]);
    expect(peerCatalog.get().loaded).toBe(true);
  });

  it("add: 校验 name 空 / 重名 / URL 非法 → 独立 error, 0 落表", () => {
    expect(peerCatalog.add("", "http://p")).toMatchObject({ ok: false });
    peerCatalog.add("Coder", "http://p1");
    expect(peerCatalog.add("Coder", "http://p2")).toMatchObject({
      ok: false,
      error: expect.stringContaining("同名"),
    });
    expect(peerCatalog.add("X", "ftp://p")).toMatchObject({
      ok: false,
      error: expect.stringContaining("http"),
    });
    expect(peerCatalog.get().records).toHaveLength(1);
  });

  it("add: token 可选 — 空白不落字段, 非空 trim 落字段; 持久化触发 db_config_set", () => {
    peerCatalog.add("NoToken", "http://p1", "   ");
    peerCatalog.add("WithToken", "http://p2/", " sk-peer ");
    const records = peerCatalog.get().records;
    expect(records[0].token).toBeUndefined();
    expect(records[1].token).toBe("sk-peer");
    expect(records[1].url).toBe("http://p2"); // 尾 slash 规范化
    expect(kv[PEER_ENDPOINTS_CONFIG_KEY]).toContain("sk-peer");
  });

  it("update: 改 name/url/token; 空 token 串清除; 重名校验绕过自己", () => {
    peerCatalog.add("A", "http://a", "t1");
    peerCatalog.add("B", "http://b");
    const a = peerCatalog.get().records[0];

    expect(peerCatalog.update(a.id, { name: "B" })).toMatchObject({ ok: false });
    expect(peerCatalog.update(a.id, { name: "A2", url: "http://a2", token: "" })).toMatchObject({
      ok: true,
    });
    expect(peerCatalog.get().records[0]).toMatchObject({
      name: "A2",
      url: "http://a2",
      token: undefined,
    });
    expect(peerCatalog.update("nope", { name: "X" })).toMatchObject({ ok: false });
  });

  it("remove: 删除 + 持久化", () => {
    peerCatalog.add("A", "http://a");
    const a = peerCatalog.get().records[0];
    peerCatalog.remove(a.id);
    expect(peerCatalog.get().records).toEqual([]);
    expect(kv[PEER_ENDPOINTS_CONFIG_KEY]).toBe("[]");
  });

  it("toBotPeers / toPeerDMPeer: mention 归一 + role 推断 + gateway=url", () => {
    peerCatalog.add("Research Lead", "http://r");
    peerCatalog.add("My Coder", "http://c", "tk");
    peerCatalog.add("QA Tester", "http://t");
    const bots = peerCatalog.toBotPeers();
    expect(bots.map((b) => [b.mention, b.role, b.url])).toEqual([
      ["research_lead", "researcher", "http://r"],
      ["my_coder", "coder", "http://c"],
      ["qa_tester", "tester", "http://t"],
    ]);
    expect(bots[1].token).toBe("tk");

    const c = peerCatalog.get().records[1];
    expect(peerCatalog.toPeerDMPeer(c.id)).toEqual({
      id: c.id,
      name: "My Coder",
      gateway: "http://c",
      token: "tk",
    });
    expect(peerCatalog.toPeerDMPeer("nope")).toBeNull();
  });
});

describe("mentionFor / roleFor", () => {
  it("mention: 非 \\w 字符归一, 纯 CJK 归空 → peer (喂得进 /@(\\w+)/ 路由)", () => {
    expect(mentionFor("My Coder")).toBe("my_coder");
    expect(mentionFor("  AI-Bot#2 ")).toBe("ai_bot_2");
    expect(mentionFor("Research 站")).toBe("research");
    expect(mentionFor("!!!")).toBe("peer");
    expect(mentionFor("研究员")).toBe("peer");
  });

  it("role: 关键词推断 (含中文), 其余 general", () => {
    expect(roleFor("研究员 Research")).toBe("researcher");
    expect(roleFor("coder-bot")).toBe("coder");
    expect(roleFor("测试员")).toBe("tester");
    expect(roleFor("assistant")).toBe("general");
  });
});
