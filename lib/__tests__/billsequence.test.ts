import { describe, expect, it, vi } from "vitest";

describe("BillSequence upsert inside $transaction (mocked)", () => {
  it("concurrent logical posts observe distinct lastSeq values from upsert", async () => {
    let lastSeq = 0;
    const upsert = vi.fn(async (_args: unknown) => {
      lastSeq += 1;
      return { lastSeq };
    });

    const mockTx = {
      billSequence: { upsert },
    };

    async function mockPrismaTransaction<T>(fn: (tx: typeof mockTx) => Promise<T>): Promise<T> {
      return fn(mockTx);
    }

    const ymd = "20260101";
    const bill = (seq: number) => `AWZ-${ymd}-${String(seq).padStart(4, "0")}`;

    const runOne = async () =>
      mockPrismaTransaction(async (tx) => {
        const seq = await tx.billSequence.upsert({} as never);
        return bill(seq.lastSeq);
      });

    const [a, b] = await Promise.all([runOne(), runOne()]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(new Set([a, b]).size).toBe(2);
  });
});
