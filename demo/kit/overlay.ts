/**
 * In-page helpers for the camera, installed with `addInitScript`.
 *
 * A recording shows no pointer, so a tap would look like the page changing by
 * itself. `__demo.press(x, y)` draws a fingertip and a ripple where the kit is
 * about to tap. `__demo.pan(px, ms)` scrolls the page at a steady, readable speed
 * (smooth scrolling is too quick to follow on video).
 *
 * Nothing is added to the document until the first call, so React's hydration
 * never sees a foreign node. pointer-events: none keeps the overlay out of the
 * way of the real tap that follows.
 */
export function installDemoOverlay(): void {
  type DemoApi = {
    press: (x: number, y: number) => void;
    pan: (px: number, ms: number) => Promise<void>;
  };
  const w = window as unknown as { __demo?: DemoApi };
  if (w.__demo) return;

  const layer = (): HTMLElement => {
    let el = document.getElementById("__demo-layer");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo-layer";
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden";
      document.documentElement.appendChild(el);
    }
    return el;
  };

  const dot = (x: number, y: number, size: number, css: string): HTMLElement => {
    const el = document.createElement("div");
    el.style.cssText =
      `position:absolute;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;` +
      `border-radius:50%;${css}`;
    layer().appendChild(el);
    return el;
  };

  w.__demo = {
    press(x, y) {
      const finger = dot(x, y, 44, "background:rgba(255,255,255,.55);border:3px solid rgba(17,24,39,.45);box-shadow:0 2px 10px rgba(0,0,0,.25)");
      finger.animate(
        [
          { transform: "scale(1.5)", opacity: 0 },
          { transform: "scale(1)", opacity: 1, offset: 0.35 },
          { transform: "scale(.85)", opacity: 1, offset: 0.6 },
          { transform: "scale(1)", opacity: 0 },
        ],
        { duration: 900, easing: "ease-out", fill: "forwards" },
      );
      const ring = dot(x, y, 44, "border:3px solid rgba(255,255,255,.9);box-shadow:0 0 0 2px rgba(17,24,39,.25)");
      ring.animate(
        [
          { transform: "scale(.6)", opacity: 0 },
          { transform: "scale(.6)", opacity: 0.9, offset: 0.4 },
          { transform: "scale(2.2)", opacity: 0 },
        ],
        { duration: 900, easing: "ease-out", fill: "forwards" },
      );
      setTimeout(() => {
        finger.remove();
        ring.remove();
      }, 1000);
    },

    pan(px, ms) {
      return new Promise((resolve) => {
        const from = window.scrollY;
        const start = performance.now();
        const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / ms);
          window.scrollTo(0, from + px * ease(t));
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    },
  };
}
