/* AwaazOS service worker: Web Push alerts + offline POS shell.
 *
 * Plain JS, no build step. Served from /sw.js with no-cache headers
 * (next.config.mjs) so a new version is picked up on the next page load.
 *
 * Offline (docs/PWA_OFFLINE_PLAN.md, Phase 1). The fetch handler is
 * deliberately narrow:
 *   - /_next/static/** and the icons: network-first, cache as fallback. In
 *     production the chunks are `immutable`, so "network" is the browser's
 *     HTTP cache and costs nothing; under `next dev` (unhashed chunk URLs)
 *     this never serves stale code while online.
 *   - navigation to /pos: network-first, falling back to the last /pos page
 *     this device rendered. Sales made offline go to the IndexedDB outbox
 *     (lib/pos-outbox.ts), never through this worker.
 *   - other vendor navigations: network, falling back to /offline.html.
 *   - never touched: /api/**, /s/** (buyers), non-GET, other origins.
 * The cached /pos page is tenant data (menu, UPI ID, revenue). It is dropped
 * whenever the device goes to /sign-in or /sign-up, or /pos answers with a
 * redirect, so a shared phone never shows the previous vendor's page.
 *
 * Kill switch: bump CACHE_VERSION and return early from the fetch handler;
 * activate deletes every old cache.
 *
 * Push payloads come from lib/push.ts: { title, body, url, tag }. They carry
 * no buyer PII (lock screens are public).
 */

/* eslint-disable no-restricted-globals */

var FALLBACK_PATH = "/orders";

var CACHE_VERSION = "v1";
var STATIC_CACHE = "awz-static-" + CACHE_VERSION;
var POS_CACHE = "awz-pos-" + CACHE_VERSION;
var POS_PATH = "/pos";
var OFFLINE_URL = "/offline.html";
var PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];
/** Old deploys' chunks pile up in the static cache; keep the newest this many. */
var STATIC_MAX_ENTRIES = 400;

/**
 * Same-origin relative path or "/orders". Mirrors safeNotificationPath() in
 * lib/push-client.ts — keep the two in step (lib/__tests__/push-sw.test.ts
 * runs both against the same table).
 */
function safeNotificationPath(raw, origin) {
  if (typeof raw !== "string") return FALLBACK_PATH;
  var s = raw.trim();
  // Must be a root-relative path. "//host" and "/\host" are protocol-relative
  // in browsers, i.e. another origin.
  if (s.charAt(0) !== "/" || s.charAt(1) === "/" || s.charAt(1) === "\\") return FALLBACK_PATH;
  try {
    var u = new URL(s, origin);
    if (u.origin !== origin) return FALLBACK_PATH;
    return u.pathname + u.search + u.hash;
  } catch (e) {
    return FALLBACK_PATH;
  }
}

function parsePayload(event) {
  var fallback = { title: "AwaazOS", body: "New activity", url: FALLBACK_PATH, tag: "awaazos" };
  if (!event.data) return fallback;
  try {
    var p = event.data.json();
    if (!p || typeof p !== "object") return fallback;
    return {
      title: typeof p.title === "string" && p.title ? p.title : fallback.title,
      body: typeof p.body === "string" ? p.body : fallback.body,
      url: typeof p.url === "string" ? p.url : fallback.url,
      tag: typeof p.tag === "string" && p.tag ? p.tag : fallback.tag,
    };
  } catch (e) {
    return fallback;
  }
}

// ── Offline ───────────────────────────────────────────────────────────────

function isAuthPage(pathname) {
  return (
    pathname === "/sign-in" ||
    pathname.indexOf("/sign-in/") === 0 ||
    pathname === "/sign-up" ||
    pathname.indexOf("/sign-up/") === 0
  );
}

/** Same-origin /_next/static URLs referenced by a page's HTML. */
function staticAssetUrls(html) {
  var out = [];
  var seen = {};
  var re = /\/_next\/static\/[^"'\s<>()\\]+/g;
  var m;
  while ((m = re.exec(html))) {
    if (!seen[m[0]]) {
      seen[m[0]] = true;
      out.push(m[0]);
    }
  }
  return out;
}

function trimStaticCache(cache) {
  return cache.keys().then(function (keys) {
    var excess = keys.length - STATIC_MAX_ENTRIES;
    var deletions = [];
    // Cache keys come back in insertion order: oldest first.
    for (var i = 0; i < keys.length && excess > 0; i++) {
      var p = new URL(keys[i].url).pathname;
      if (PRECACHE.indexOf(p) !== -1) continue;
      deletions.push(cache.delete(keys[i]));
      excess--;
    }
    return Promise.all(deletions);
  });
}

/**
 * Store a fresh /pos page, plus every chunk it references. The first visit
 * loads its chunks before this worker controls the page, so without this the
 * cached HTML would open offline with no JS or CSS.
 */
function storePosPage(res) {
  return res.text().then(function (html) {
    var page = new Response(html, { status: 200, headers: new Headers(res.headers) });
    return Promise.all([
      caches.open(POS_CACHE).then(function (c) {
        return c.put(POS_PATH, page);
      }),
      caches.open(STATIC_CACHE).then(function (c) {
        return Promise.all(
          staticAssetUrls(html).map(function (u) {
            return c.match(u).then(function (hit) {
              if (hit) return null;
              return fetch(u)
                .then(function (r) {
                  return r.ok ? c.put(u, r) : null;
                })
                .catch(function () {
                  return null;
                });
            });
          }),
        ).then(function () {
          return trimStaticCache(c);
        });
      }),
    ]);
  });
}

function posNavigation(event) {
  return fetch(event.request)
    .then(function (res) {
      if (res.ok && res.type === "basic" && !res.redirected) {
        event.waitUntil(storePosPage(res.clone()).catch(function () {}));
      } else if (res.redirected || res.type === "opaqueredirect" || res.status === 401 || res.status === 403) {
        // Signed out or lost access: forget the previous vendor's page.
        event.waitUntil(caches.delete(POS_CACHE));
      }
      return res;
    })
    .catch(function () {
      return caches
        .open(POS_CACHE)
        .then(function (c) {
          return c.match(POS_PATH, { ignoreSearch: true, ignoreVary: true });
        })
        .then(function (hit) {
          return hit || caches.match(OFFLINE_URL);
        });
    });
}

function staticNetworkFirst(event) {
  var req = event.request;
  return fetch(req)
    .then(function (res) {
      if (res.ok && res.type === "basic") {
        var copy = res.clone();
        event.waitUntil(
          caches
            .open(STATIC_CACHE)
            .then(function (cache) {
              return cache.put(req, copy).then(function () {
                return trimStaticCache(cache);
              });
            })
            .catch(function () {}),
        );
      }
      return res;
    })
    .catch(function (err) {
      return caches
        .open(STATIC_CACHE)
        .then(function (cache) {
          return cache.match(req);
        })
        .then(function (hit) {
          if (hit) return hit;
          throw err;
        });
    });
}

self.addEventListener("install", function (event) {
  self.skipWaiting();
  if (event && typeof event.waitUntil === "function") {
    event.waitUntil(
      caches
        .open(STATIC_CACHE)
        .then(function (c) {
          return c.addAll(PRECACHE);
        })
        .catch(function () {}),
    );
  }
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n.indexOf("awz-") === 0 && n !== STATIC_CACHE && n !== POS_CACHE;
            })
            .map(function (n) {
              return caches.delete(n);
            }),
        );
      })
      .catch(function () {})
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  var path = url.pathname;
  if (path.indexOf("/api/") === 0 || path === "/s" || path.indexOf("/s/") === 0) return;

  if (req.mode === "navigate") {
    if (isAuthPage(path)) {
      event.waitUntil(caches.delete(POS_CACHE));
      return;
    }
    if (path === POS_PATH) {
      event.respondWith(posNavigation(event));
      return;
    }
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match(OFFLINE_URL);
      }),
    );
    return;
  }

  if (path.indexOf("/_next/static/") === 0 || PRECACHE.indexOf(path) !== -1) {
    event.respondWith(staticNetworkFirst(event));
  }
});

self.addEventListener("push", function (event) {
  var p = parsePayload(event);
  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      renotify: true,
      icon: "/icon-192.png",
      badge: "/badge-72.png",
      data: { url: safeNotificationPath(p.url, self.location.origin) },
    }),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var origin = self.location.origin;
  var data = event.notification.data || {};
  var path = safeNotificationPath(data.url, origin);
  var target = new URL(path, origin);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      var sameOrigin = [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var u;
        try {
          u = new URL(c.url);
        } catch (e) {
          continue;
        }
        if (u.origin !== origin) continue;
        // Already on that board: just bring it forward. The board refetches
        // when it becomes visible, so the vendor lands on fresh orders.
        if (u.pathname === target.pathname && "focus" in c) return c.focus();
        sameOrigin.push(c);
      }
      var existing = sameOrigin[0];
      if (existing && "navigate" in existing) {
        return existing
          .navigate(target.href)
          .then(function (c) {
            return (c || existing).focus();
          })
          .catch(function () {
            return self.clients.openWindow(target.href);
          });
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
