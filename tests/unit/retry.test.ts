import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../src/utils/retry";

describe("withRetry", () => {
  it("succeeds on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 1);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once and succeeds on second attempt", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error("temporary error");
      return "success";
    });
    const result = await withRetry(fn, 1);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after all retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent error"));
    await expect(withRetry(fn, 1)).rejects.toThrow("permanent error");
    expect(fn).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("throws immediately with 0 retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(withRetry(fn, 0)).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
