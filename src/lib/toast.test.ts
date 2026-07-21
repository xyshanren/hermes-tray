// v0.2-alpha-6 — tests for src/lib/toast.ts (sonner wrapper).
//
// Mock sonner to capture which toast.* function gets called with which
// arguments, and assert our thin wrapper preserves the title/message/type
// mapping exactly.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("sonner", () => {
  return {
    toast: {
      success: vi.fn(() => "id-success"),
      error: vi.fn(() => "id-error"),
      info: vi.fn(() => "id-info"),
      warning: vi.fn(() => "id-warning"),
      dismiss: vi.fn(),
    },
  };
});

import { toast } from "sonner";
import { showToast, dismissAllToasts } from "./toast";

// Sonner's types don't carry the vitest mock metadata, so we cast through
// unknown to access .mock.calls / .mockClear without a ts(2339) error.
type MockSpy = ReturnType<typeof vi.fn>;
const successSpy = toast.success as unknown as MockSpy;
const errorSpy = toast.error as unknown as MockSpy;
const infoSpy = toast.info as unknown as MockSpy;
const warningSpy = toast.warning as unknown as MockSpy;
const dismissSpy = toast.dismiss as unknown as MockSpy;

describe("showToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("type routing", () => {
    it("routes 'success' to toast.success", () => {
      const id = showToast("已保存", "3 项", "success");
      expect(successSpy).toHaveBeenCalledWith("已保存", { description: "3 项" });
      expect(id).toBe("id-success");
    });

    it("routes 'error' to toast.error", () => {
      const id = showToast("失败", "网络异常", "error");
      expect(errorSpy).toHaveBeenCalledWith("失败", { description: "网络异常", duration: Infinity });
      expect(id).toBe("id-error");
    });

    it("routes 'info' to toast.info", () => {
      const id = showToast("提示", "需要关注", "info");
      expect(infoSpy).toHaveBeenCalledWith("提示", { description: "需要关注" });
      expect(id).toBe("id-info");
    });

    it("routes 'warning' to toast.warning", () => {
      const id = showToast("注意", "可能丢失数据", "warning");
      expect(warningSpy).toHaveBeenCalledWith("注意", { description: "可能丢失数据" });
      expect(id).toBe("id-warning");
    });

    it("defaults to 'info' when type is omitted", () => {
      showToast("hello", "world");
      expect(infoSpy).toHaveBeenCalledWith("hello", { description: "world" });
      expect(successSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warningSpy).not.toHaveBeenCalled();
    });
  });

  describe("message handling", () => {
    it("omits description when message is empty string", () => {
      showToast("仅标题", "", "error");
      expect(errorSpy).toHaveBeenCalledWith("仅标题", { duration: Infinity });
    });

    it("omits description when message is undefined", () => {
      // showToast(message: string = "") — explicit undefined triggers default
      showToast("仅标题", undefined, "info");
      expect(infoSpy).toHaveBeenCalledWith("仅标题", {});
    });

    it("passes message as description when present", () => {
      showToast("标题", "副标题", "success");
      expect(successSpy).toHaveBeenCalledWith("标题", { description: "副标题" });
    });
  });
});

describe("dismissAllToasts", () => {
  it("passes through to sonner toast.dismiss", () => {
    dismissAllToasts();
    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });
});