import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { safeNotificationPath } from "@/lib/push-client";

/**
 * public/sw.js has no build step, so it is loaded into a fake worker global
 * with node:vm and its handlers are driven directly.
 */

const ORIGIN = "https://awaazos.vercel.app";
const SOURCE = readFileSync(path.join(__dirname, "..", "..", "public", "sw.js"), "utf8");

type Handler = (event: unknown) => void;
type FakeClient = { url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> };

function loadWorker(windows: FakeClient[] = []) {
  const handlers: Record<string, Handler> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(null);
  const self = {
    location: { origin: ORIGIN },
    registration: { showNotification },
    clients: { matchAll: vi.fn().mockResolvedValue(windows), openWindow, claim: vi.fn().mockResolvedValue(undefined) },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
  };
  const context = vm.createContext({ self, URL });
  vm.runInContext(SOURCE, context);
  return { handlers, self, showNotification, openWindow, context };
}

async function dispatch(handler: Handler, event: Record<string, unknown>): Promise<void> {
  let pending: Promise<unknown> = Promise.resolve();
  handler({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
  await pending;
}

function client(url: string, opts?: { navigable?: boolean }): FakeClient {
  const c: FakeClient = { url, focus: vi.fn().mockResolvedValue(undefined) };
  if (opts?.navigable) c.navigate = vi.fn().mockResolvedValue(c);
  return c;
}

describe("sw.js safeNotificationPath mirrors lib/push-client", () => {
  const inputs: unknown[] = [
    "/orders",
    "/drops/x?y=1#z",
    " /orders ",
    "/../a",
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "",
    null,
    undefined,
    7,
  ];
  it.each(inputs.map((i) => [i]))("%j", (raw) => {
    const { context } = loadWorker();
    const swFn = (context as unknown as { safeNotificationPath: (r: unknown, o: string) => string })
      .safeNotificationPath;
    expect(swFn(raw, ORIGIN)).toBe(safeNotificationPath(raw, ORIGIN));
  });
});

describe("sw.js push", () => {
  it("shows the payload with icon, badge, renotify and a sanitised url", async () => {
    const { handlers, showNotification } = loadWorker();
    const payload = { title: "New order ₹240", body: "AWZ-1 · 3 items", url: "/drops/d1", tag: "order-1" };
    await dispatch(handlers.push!, { data: { json: () => payload } });
    expect(showNotification).toHaveBeenCalledWith("New order ₹240", {
      body: "AWZ-1 · 3 items",
      tag: "order-1",
      renotify: true,
      icon: "/icon-192.png",
      badge: "/badge-72.png",
      data: { url: "/drops/d1" },
    });
  });

  it("falls back to a generic notification when the payload is not JSON", async () => {
    const { handlers, showNotification } = loadWorker();
    await dispatch(handlers.push!, {
      data: {
        json: () => {
          throw new SyntaxError("bad");
        },
      },
    });
    const [title, opts] = showNotification.mock.calls[0]!;
    expect(title).toBe("AwaazOS");
    expect(opts.body).toBe("New activity");
    expect(opts.data).toEqual({ url: "/orders" });
  });

  it("never stores an off-site url in notification data", async () => {
    const { handlers, showNotification } = loadWorker();
    await dispatch(handlers.push!, {
      data: { json: () => ({ title: "x", body: "y", url: "https://evil.example", tag: "t" }) },
    });
    expect(showNotification.mock.calls[0]![1].data).toEqual({ url: "/orders" });
  });
});

describe("sw.js notificationclick", () => {
  const notification = (url: unknown) => ({ close: vi.fn(), data: { url } });

  it("focuses an open tab already on that board", async () => {
    const board = client(`${ORIGIN}/orders`);
    const { handlers, openWindow } = loadWorker([client(`${ORIGIN}/pos`, { navigable: true }), board]);
    const n = notification("/orders");
    await dispatch(handlers.notificationclick!, { notification: n });
    expect(n.close).toHaveBeenCalled();
    expect(board.focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("navigates another same-origin tab when none is on the board", async () => {
    const pos = client(`${ORIGIN}/pos`, { navigable: true });
    const { handlers, openWindow } = loadWorker([pos]);
    await dispatch(handlers.notificationclick!, { notification: notification("/drops/d1") });
    expect(pos.navigate).toHaveBeenCalledWith(`${ORIGIN}/drops/d1`);
    expect(pos.focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens a window when there is no tab, and refuses off-site urls", async () => {
    const other = client("https://other.example/orders");
    const { handlers, openWindow } = loadWorker([other]);
    await dispatch(handlers.notificationclick!, { notification: notification("https://evil.example/x") });
    expect(other.focus).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/orders`);
  });

  it("falls back to openWindow when navigate rejects (uncontrolled tab)", async () => {
    const pos = client(`${ORIGIN}/pos`, { navigable: true });
    pos.navigate!.mockRejectedValue(new TypeError("not controlled"));
    const { handlers, openWindow } = loadWorker([pos]);
    await dispatch(handlers.notificationclick!, { notification: notification("/orders") });
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/orders`);
  });
});

describe("sw.js lifecycle", () => {
  it("skips waiting on install, claims clients on activate, and has no fetch handler", async () => {
    const { handlers, self } = loadWorker();
    handlers.install!({});
    expect(self.skipWaiting).toHaveBeenCalled();
    await dispatch(handlers.activate!, {});
    expect(self.clients.claim).toHaveBeenCalled();
    expect(handlers.fetch).toBeUndefined();
  });
});
