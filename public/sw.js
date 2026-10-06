/* AwaazOS service worker — Web Push new-order alerts only.
 *
 * Plain JS, no build step. Served from /sw.js with no-cache headers
 * (next.config.mjs) so a new version is picked up on the next page load.
 *
 * Deliberately has NO fetch handler: no offline caching, no request
 * interception. It only shows notifications and opens the right board.
 *
 * Payloads come from lib/push.ts: { title, body, url, tag }. They carry no
 * buyer PII (lock screens are public).
 */

/* eslint-disable no-restricted-globals */

var FALLBACK_PATH = "/orders";

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

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
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
