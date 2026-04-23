import { describe, expect, it } from "vitest";

import { TimeoutError, withTimeout } from "@/lib/with-timeout";

describe("withTimeout", () => {
  it("resolves the underlying promise when it beats the deadline", async () => {
    const v = await withTimeout(Promise.resolve(42), 100, "fast");
    expect(v).toBe(42);
  });

  it("rejects with TimeoutError when the underlying promise is too slow", async () => {
    const slow = new Promise<number>((res) => setTimeout(() => res(1), 200));
    await expect(withTimeout(slow, 25, "slow")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("propagates the underlying rejection when it beats the deadline", async () => {
    const fail = Promise.reject(new Error("boom"));
    await expect(withTimeout(fail, 100, "fail")).rejects.toThrow("boom");
  });

  it("includes opName and timeoutMs in the TimeoutError message", async () => {
    const slow = new Promise((res) => setTimeout(res, 200));
    try {
      await withTimeout(slow, 25, "razorpay.subscriptions.create");
      throw new Error("should not reach here");
    } catch (e) {
      expect(e).toBeInstanceOf(TimeoutError);
      const te = e as TimeoutError;
      expect(te.opName).toBe("razorpay.subscriptions.create");
      expect(te.timeoutMs).toBe(25);
      expect(te.message).toContain("razorpay.subscriptions.create");
      expect(te.message).toContain("25ms");
    }
  });
});
