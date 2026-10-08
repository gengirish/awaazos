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

function loadWorker(windows: FakeClient[] = [], net: { caches?: FakeCacheStorage; fetch?: typeof fetch } = {}) {
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
  const caches = net.caches ?? new FakeCacheStorage();
  const context = vm.createContext({ self, URL, Response, Headers, caches, fetch: net.fetch ?? vi.fn() });
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

// ── Offline caching ──────────────────────────────────────────────────────

/** Minimal Cache Storage: keys are path+search, `ignoreSearch` matches on path. */
class FakeCache {
  entries = new Map<string, Response>();
  constructor(private readonly fetchFn: () => typeof fetch) {}
  private key(r: string | { url: string }): string {
    const u = new URL(typeof r === "string" ? r : r.url, ORIGIN);
    return u.pathname + u.search;
  }
  async match(r: string | { url: string }, opts?: { ignoreSearch?: boolean }) {
    const k = this.key(r);
    if (this.entries.has(k)) return this.entries.get(k)!.clone();
    if (opts?.ignoreSearch) {
      const path = k.split("?")[0];
      for (const [ek, v] of Array.from(this.entries)) if (ek.split("?")[0] === path) return v.clone();
    }
    return undefined;
  }
  async put(r: string | { url: string }, res: Response) {
    this.entries.set(this.key(r), res);
  }
  async addAll(urls: string[]) {
    for (const u of urls) this.entries.set(this.key(u), await this.fetchFn()(u));
  }
  async keys() {
    return Array.from(this.entries.keys()).map((k) => ({ url: ORIGIN + k }));
  }
  async delete(r: string | { url: string }) {
    return this.entries.delete(this.key(r));
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  fetchFn: typeof fetch = vi.fn();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(() => this.fetchFn));
    return this.stores.get(name)!;
  }
  async keys() {
    return Array.from(this.stores.keys());
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(r: string) {
    for (const c of Array.from(this.stores.values())) {
      const hit = await c.match(r);
      if (hit) return hit;
    }
    return undefined;
  }
}

/** A same-origin response, as the browser would type it. */
function basic(body: string, init?: ResponseInit, type = "basic"): Response {
  const res = new Response(body, init);
  Object.defineProperty(res, "type", { value: type });
  return res;
}

const POS_HTML =
  '<html><link rel="stylesheet" href="/_next/static/css/app.css"><script src="/_next/static/chunks/pos-abc.js"></script></html>';

function offlineWorker(fetchImpl: (url: string) => Promise<Response>) {
  const caches = new FakeCacheStorage();
  const fetchFn = vi.fn((input: string | { url: string }) =>
    fetchImpl(typeof input === "string" ? input : input.url),
  ) as unknown as typeof fetch;
  caches.fetchFn = fetchFn;
  const worker = loadWorker([], { caches, fetch: fetchFn });
  return { ...worker, caches, fetchFn };
}

type FetchOutcome = { responded: boolean; response?: Response };

async function fetchEvent(
  handler: Handler,
  url: string,
  opts: { mode?: string; method?: string } = {},
): Promise<FetchOutcome> {
  const waits: Promise<unknown>[] = [];
  let responded: Promise<Response> | null = null;
  handler({
    request: { url: ORIGIN + url, method: opts.method ?? "GET", mode: opts.mode ?? "no-cors" },
    respondWith: (p: Promise<Response>) => (responded = p),
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  });
  const response = responded ? await responded : undefined;
  // waitUntil may be called while the response promise settles.
  for (let i = 0; i < waits.length; i++) await waits[i];
  return { responded: responded !== null, response };
}

const offlineNet = () => Promise.reject(new TypeError("Failed to fetch"));

describe("sw.js lifecycle", () => {
  it("skips waiting and precaches the offline page on install", async () => {
    const { handlers, self, caches } = offlineWorker(async () => basic("ok"));
    await dispatch(handlers.install!, {});
    expect(self.skipWaiting).toHaveBeenCalled();
    const stat = await caches.open("awz-static-v1");
    expect(await stat.match("/offline.html")).toBeDefined();
  });

  it("claims clients and drops caches from older versions on activate", async () => {
    const { handlers, self, caches } = offlineWorker(async () => basic("ok"));
    await caches.open("awz-static-v0");
    await caches.open("awz-pos-v1");
    await caches.open("someone-else");
    await dispatch(handlers.activate!, {});
    expect(self.clients.claim).toHaveBeenCalled();
    expect(await caches.keys()).toEqual(["awz-pos-v1", "someone-else"]);
  });
});

describe("sw.js fetch handler", () => {
  it("never intercepts API calls, buyer storefront pages, writes or other origins", async () => {
    const { handlers } = offlineWorker(async () => basic("ok"));
    expect((await fetchEvent(handlers.fetch!, "/api/transactions")).responded).toBe(false);
    expect((await fetchEvent(handlers.fetch!, "/s/ravi", { mode: "navigate" })).responded).toBe(false);
    expect((await fetchEvent(handlers.fetch!, "/pos", { mode: "navigate", method: "POST" })).responded).toBe(false);
    const other = { responded: false };
    handlers.fetch!({
      request: { url: "https://cdn.example/x.js", method: "GET", mode: "no-cors" },
      respondWith: () => (other.responded = true),
      waitUntil: () => {},
    });
    expect(other.responded).toBe(false);
  });

  it("serves /pos from the network and caches the page with its chunks", async () => {
    const { handlers, caches } = offlineWorker(async (url) =>
      url.endsWith("/pos") ? basic(POS_HTML, { headers: { "content-type": "text/html" } }) : basic("asset"),
    );
    const out = await fetchEvent(handlers.fetch!, "/pos", { mode: "navigate" });
    expect(await out.response!.text()).toBe(POS_HTML);

    const pos = await caches.open("awz-pos-v1");
    expect(await (await pos.match("/pos"))!.text()).toBe(POS_HTML);
    const stat = await caches.open("awz-static-v1");
    expect(await stat.match("/_next/static/chunks/pos-abc.js")).toBeDefined();
    expect(await stat.match("/_next/static/css/app.css")).toBeDefined();
  });

  it("opens the cached /pos when offline, and the offline page when nothing is cached", async () => {
    const { handlers, caches } = offlineWorker(offlineNet);
    const stat = await caches.open("awz-static-v1");
    await stat.put("/offline.html", basic("OFFLINE PAGE"));

    const cold = await fetchEvent(handlers.fetch!, "/pos", { mode: "navigate" });
    expect(await cold.response!.text()).toBe("OFFLINE PAGE");

    const pos = await caches.open("awz-pos-v1");
    await pos.put("/pos", basic(POS_HTML));
    const warm = await fetchEvent(handlers.fetch!, "/pos?vendor=ravi", { mode: "navigate" });
    expect(await warm.response!.text()).toBe(POS_HTML);
  });

  it("forgets the cached /pos when it redirects (signed out)", async () => {
    const { handlers, caches } = offlineWorker(async () => basic("", { status: 200 }, "opaqueredirect"));
    const pos = await caches.open("awz-pos-v1");
    await pos.put("/pos", basic(POS_HTML));
    await fetchEvent(handlers.fetch!, "/pos", { mode: "navigate" });
    expect(await caches.keys()).not.toContain("awz-pos-v1");
  });

  it("forgets the cached /pos on the way to sign-in, without intercepting it", async () => {
    const { handlers, caches } = offlineWorker(async () => basic("ok"));
    const pos = await caches.open("awz-pos-v1");
    await pos.put("/pos", basic(POS_HTML));
    const out = await fetchEvent(handlers.fetch!, "/sign-in", { mode: "navigate" });
    expect(out.responded).toBe(false);
    expect(await caches.keys()).not.toContain("awz-pos-v1");
  });

  it("falls back to the offline page for other vendor pages", async () => {
    const { handlers, caches } = offlineWorker(offlineNet);
    const stat = await caches.open("awz-static-v1");
    await stat.put("/offline.html", basic("OFFLINE PAGE"));
    const out = await fetchEvent(handlers.fetch!, "/orders", { mode: "navigate" });
    expect(await out.response!.text()).toBe("OFFLINE PAGE");
  });

  it("serves static chunks from the network and caches them", async () => {
    const { handlers, caches } = offlineWorker(async () => basic("fresh-js"));
    const stat = await caches.open("awz-static-v1");
    await stat.put("/_next/static/chunks/a.js", basic("stale-js"));
    const out = await fetchEvent(handlers.fetch!, "/_next/static/chunks/a.js");
    // Online always wins, so `next dev` never runs stale code.
    expect(await out.response!.text()).toBe("fresh-js");
    expect(await (await stat.match("/_next/static/chunks/a.js"))!.text()).toBe("fresh-js");
  });

  it("falls back to cached static chunks offline", async () => {
    const { handlers, caches } = offlineWorker(offlineNet);
    const stat = await caches.open("awz-static-v1");
    await stat.put("/_next/static/chunks/a.js", basic("cached-js"));
    const out = await fetchEvent(handlers.fetch!, "/_next/static/chunks/a.js");
    expect(await out.response!.text()).toBe("cached-js");
  });
});
