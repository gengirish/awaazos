/**
 * Wraps a promise with a hard deadline. Use for upstream calls whose SDK
 * doesn't natively expose a timeout option (Razorpay SDK, BullMQ commands).
 *
 * Usage:
 *   const sub = await withTimeout(rz.subscriptions.create(...), 8000, "razorpay.subscriptions.create");
 *
 * Note: Promise.race does NOT cancel the underlying work — the upstream call
 * keeps running in background until it eventually settles. Pair with
 * AbortController where the API supports it. This helper exists for the
 * 80% case where it doesn't.
 */
export class TimeoutError extends Error {
  constructor(public readonly opName: string, public readonly timeoutMs: number) {
    super(`${opName} exceeded ${timeoutMs}ms timeout`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(p: Promise<T>, timeoutMs: number, opName = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(opName, timeoutMs)), timeoutMs);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
