/* SPDX-License-Identifier: Apache-2.0 */
/**
 * gl-settings.js — how the WebGL canvas is set up on each kind of device.
 *
 * iPad Safari renders at a device pixel ratio of 2 (3 on some iPhones) and its GPU is shared with the
 * rest of the system, so a full-screen MSAA canvas at dpr 2 is the single biggest cost in the viewport.
 * Desktop rendering stays exactly as it was: the same options, the same dpr cap of 2.
 *
 *   glOptions()              → the WebGLRenderer options for this device
 *   pixelRatioCap(w, h)      → the dpr the canvas should render at (css px w × h of the canvas)
 *   isIPadLike()             → iPadOS / iOS Safari (iPadOS 13+ reports itself as "Macintosh")
 *   guardContext(canvas, {onLost, onRestored}) → handles webglcontextlost / webglcontextrestored; returns a detach()
 */

const BIG_CANVAS_PX = 2_000_000;   // css px: above this an iPad renders at dpr 1.5 instead of 2 (MSAA at dpr 2 stutters)

/** iPadOS / iOS Safari: a Macintosh / iPad / iPhone user agent that also has a multi-touch screen. */
export function isIPadLike(nav = typeof navigator !== 'undefined' ? navigator : null, doc = typeof document !== 'undefined' ? document : null) {
  if (!nav) return false;
  const ua = nav.userAgent || '';
  const touch = (nav.maxTouchPoints || 0) > 1 && /Macintosh|iPad|iPhone/.test(ua);
  return touch && !!doc && 'ontouchend' in doc;
}

/** The device pixel ratio to render at: 2 on desktop (as before); on an iPad 1.5 once the canvas is bigger than ~2M css px. */
export function pixelRatioCap(w = 0, h = 0, dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1) {
  const ipad = isIPadLike();
  const cap = ipad && (w * h > BIG_CANVAS_PX) ? 1.5 : 2;
  return Math.min(dpr, cap);
}

/**
 * Options for THREE.WebGLRenderer. preserveDrawingBuffer stays on everywhere: the loupe and screenshots read the canvas.
 * antialias stays on while the capped dpr is ≤ 2 (it always is: pixelRatioCap never exceeds 2).
 * failIfMajorPerformanceCaveat: false so a software renderer (a VM, a headless test) still gets a context.
 */
export function glOptions(canvas = null) {
  const w = canvas?.clientWidth || 0, h = canvas?.clientHeight || 0;
  const dpr = pixelRatioCap(w, h);
  const o = { antialias: dpr <= 2, preserveDrawingBuffer: true, stencil: true, failIfMajorPerformanceCaveat: false };
  if (isIPadLike()) o.powerPreference = 'high-performance';
  return o;
}

/**
 * Keep a lost WebGL context from taking the page with it: preventDefault on webglcontextlost tells the browser we want
 * it back, and onRestored gets to rebuild the scene. Returns a function that removes both listeners.
 */
export function guardContext(canvas, { onLost, onRestored } = {}) {
  if (!canvas?.addEventListener) return () => {};
  const lost = (e) => { e.preventDefault(); onLost?.(e); };
  const restored = (e) => { onRestored?.(e); };
  canvas.addEventListener('webglcontextlost', lost, false);
  canvas.addEventListener('webglcontextrestored', restored, false);
  return () => { canvas.removeEventListener('webglcontextlost', lost, false); canvas.removeEventListener('webglcontextrestored', restored, false); };
}
