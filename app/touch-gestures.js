/* SPDX-License-Identifier: Apache-2.0 */
/**
 * touch-gestures.js — the viewport's finger gestures, as pure logic (no DOM: tests/bin/test-touch-gestures.mjs runs it in Node).
 *
 * Feed it the pointer events of `pointerType === 'touch'` fingers (down / move / up / cancel, with the pointerId, the
 * position in view pixels and the event's timeStamp) and it reports, through the handlers you give it:
 *
 *   orbit(dx, dy, s)        one finger drags (mode 'orbit'), or three fingers drag (two when twoFingers === 'orbit')
 *   pan(dx, dy, s)          two fingers drag (three when twoFingers === 'orbit')
 *   zoom(factor, cx, cy, s) two fingers pinch: factor > 1 = the fingers spread (zoom in), about their middle (cx, cy)
 *   tap(n, x, y)            n fingers went down and all lifted within tapMs, none moving tapPx (one = a click,
 *                           two = undo, three = redo in ModelCraft)
 *   longPress(x, y)         one finger held still for longMs; return 'orbit' to turn that finger into an orbit until it lifts
 *   hover(p)                mode 'draw': one finger is down and has not moved yet (the tool's hover and the loupe)
 *   down(p) move(p) up(p)   mode 'draw': the single finger as the tool's press–drag (down comes with the first real move,
 *                           from where the finger went down)
 *   cancel()                the tool's press–drag is abandoned (a second finger came down, or the finger was cancelled)
 *
 * `s` is the gesture: { n, x, y, x0, y0, pivot } — n fingers, the current and the starting middle; `pivot` is yours to
 * memoise what the camera turns about (undefined at the start of every gesture). The handlers are plain functions on
 * one object; a missing handler is skipped.
 *
 * Options: mode 'orbit' | 'draw' (or a function returning one, read at each finger down), twoFingers 'pan' | 'orbit' (or a
 * function), tapMs (250), tapPx (10), longMs (500), movePx (8, the press–drag's dead zone in mode 'draw'), schedule(fn)
 * (how multi-finger moves are coalesced — requestAnimationFrame in the app, at once by default), setTimeout / clearTimeout.
 *
 * A multi-finger drag does nothing until it has lasted tapMs or moved tapPx, so a two-finger tap does not nudge the camera.
 * blockPageZoom(doc, el) keeps the page itself from zooming (Safari's gesture events, a two-finger touchmove on the stage).
 */

const num = (v, d) => (Number.isFinite(v) ? v : d);
const pick = (v, d) => (typeof v === 'function' ? v() : v) || d;
const centre = (pts) => ({ x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length });
const spread = (pts) => (pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0);

export class TouchGestures {
  constructor(opts = {}, on = {}) {
    this.on = on;
    this.opts = opts;
    this.tapMs = num(opts.tapMs, 250);
    this.tapPx = num(opts.tapPx, 10);
    this.longMs = num(opts.longMs, 500);
    this.movePx = num(opts.movePx, 8);
    this.schedule = opts.schedule || ((fn) => fn());
    this.setTimeout = opts.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.clearTimeout = opts.clearTimeout || ((id) => globalThis.clearTimeout(id));
    this.fingers = new Map();   // pointerId → { x, y, x0, y0, moved }
    this.single = null;         // the first finger while it is alone: { id, x0, y0, t0, mode, state, timer }
    this.multi = null;          // two or more fingers: the gesture s plus { d, armed, t0, maxN, pending }
    this.gesture = null;        // what fingers are down right now: 'single' | 'multi' | null
  }

  /** How many fingers are down. */
  get count() { return this.fingers.size; }
  /** True while a finger is the tool's press–drag (mode 'draw', after its first real move). */
  get dragging() { return this.single?.state === 'drag'; }

  emit(name, ...args) { const f = this.on[name]; return typeof f === 'function' ? f(...args) : undefined; }

  down(id, x, y, t = 0) {
    if (this.fingers.has(id)) this.fingers.delete(id);
    this.fingers.set(id, { x, y, x0: x, y0: y, moved: 0 });
    if (this.fingers.size === 1) {
      const mode = pick(this.opts.mode, 'orbit') === 'draw' ? 'draw' : 'orbit';
      this.single = { id, x0: x, y0: y, x, y, t0: t, mode, state: 'pending', timer: this.setTimeout(() => this.hold(), this.longMs) };
      this.gesture = 'single';
      if (mode === 'draw') this.emit('hover', { x, y });
      return;
    }
    // more fingers: the first finger's tap and anything it began are forgotten
    if (this.single) {
      this.clearTimeout(this.single.timer);
      if (this.single.state === 'drag') this.emit('cancel');
      this.single = null;
    }
    const pts = [...this.fingers.values()];
    const c = centre(pts);
    if (this.multi) {
      // another finger joined a running gesture: start afresh from the new middle, keep the gesture's clock
      Object.assign(this.multi, { n: pts.length, x: c.x, y: c.y, d: spread(pts), maxN: Math.max(this.multi.maxN, pts.length) });
    } else {
      const t0 = t;
      this.multi = { n: pts.length, x: c.x, y: c.y, x0: c.x, y0: c.y, pivot: undefined, d: spread(pts), armed: false, t0, maxN: pts.length, pending: false, t };
    }
    this.gesture = 'multi';
  }

  move(id, x, y, t = 0) {
    const f = this.fingers.get(id);
    if (!f) return;
    f.x = x; f.y = y;
    f.moved = Math.max(f.moved, Math.hypot(x - f.x0, y - f.y0));
    if (this.multi && this.fingers.size >= 2) {
      this.multi.t = t;
      if (!this.multi.pending) { this.multi.pending = true; this.schedule(() => this.flush()); }
      return;
    }
    const s = this.single;
    if (!s || s.id !== id) return;
    s.x = x; s.y = y;
    if (s.state === 'done') return;
    if (s.state === 'orbit') { this.turn(s, x, y); return; }
    const far = f.moved >= this.tapPx;
    if (s.mode === 'orbit') {
      if (s.state === 'pending' && (far || t - s.t0 > this.tapMs)) { this.clearTimeout(s.timer); s.state = 'orbit'; s.px = x; s.py = y; s.g = { n: 1, x, y, x0: s.x0, y0: s.y0, pivot: undefined }; }
      if (s.state === 'orbit') this.turn(s, x, y);
      return;
    }
    // mode 'draw': the finger is the tool
    if (s.state === 'pending') {
      if (f.moved < this.movePx) { this.emit('hover', { x, y }); return; }
      this.clearTimeout(s.timer);
      s.state = 'drag';
      this.emit('down', { x: s.x0, y: s.y0 });
    }
    this.emit('move', { x, y });
  }

  up(id, x, y, t = 0) {
    const f = this.fingers.get(id);
    if (!f) return;
    f.x = x; f.y = y;
    f.moved = Math.max(f.moved, Math.hypot(x - f.x0, y - f.y0));
    this.fingers.delete(id);
    if (this.multi) {
      const m = this.multi;
      m.lifted = (m.lifted || 0) + 1;
      m.anyMoved = m.anyMoved || f.moved >= this.tapPx;
      if (this.fingers.size) return;   // the gesture ends when the last finger lifts (no fall-back to one finger)
      this.multi = null; this.gesture = null;
      if (!m.armed && !m.anyMoved && t - m.t0 <= this.tapMs) this.emit('tap', m.maxN, m.x0, m.y0);
      return;
    }
    const s = this.single;
    if (!s || s.id !== id) return;
    this.clearTimeout(s.timer);
    this.single = null; this.gesture = null;
    if (s.state === 'done' || s.state === 'orbit') return;
    if (s.state === 'drag') { this.emit('up', { x, y }); return; }
    // pending: a touch that did not move is a tap (a long one became longPress before it lifted)
    if (f.moved < this.tapPx) this.emit('tap', 1, s.x0, s.y0);
  }

  cancel(id) {
    const f = this.fingers.get(id);
    if (!f) return;
    this.fingers.delete(id);
    if (this.single?.id === id) {
      this.clearTimeout(this.single.timer);
      if (this.single.state === 'drag') this.emit('cancel');
      this.single = null;
    }
    if (this.multi && !this.fingers.size) this.multi = null;
    if (!this.fingers.size) this.gesture = null;
  }

  /** Every finger is forgotten (the window lost focus, the pointer capture went). */
  reset() {
    for (const id of [...this.fingers.keys()]) this.cancel(id);
  }

  /** The long-press timer fired: the single finger is still down and has not moved. */
  hold() {
    const s = this.single;
    if (!s || s.state !== 'pending') return;
    const f = this.fingers.get(s.id);
    if (f && f.moved >= this.tapPx) return;
    const r = this.emit('longPress', s.x0, s.y0);
    if (r === 'orbit') { s.state = 'orbit'; s.px = s.x; s.py = s.y; s.g = { n: 1, x: s.x, y: s.y, x0: s.x0, y0: s.y0, pivot: undefined }; }
    else s.state = 'done';
  }

  turn(s, x, y) {
    const dx = x - s.px, dy = y - s.py;
    s.px = x; s.py = y;
    s.g.x = x; s.g.y = y;
    if (dx || dy) this.emit('orbit', dx, dy, s.g);
  }

  /** The coalesced multi-finger move (once per schedule()). */
  flush() {
    const m = this.multi;
    if (!m) return;
    m.pending = false;
    const pts = [...this.fingers.values()];
    if (pts.length < 2) return;
    const c = centre(pts), d = spread(pts);
    if (pts.length !== m.n) { m.n = pts.length; m.x = c.x; m.y = c.y; m.d = d; return; }
    if (!m.armed) {
      const far = pts.some((q) => q.moved >= this.tapPx);
      if (far || m.t - m.t0 > this.tapMs) m.armed = true;   // else a tap in the making: hold the camera
      m.x = c.x; m.y = c.y; m.d = d;   // the drag starts from here, without a jump
      return;
    }
    const dx = c.x - m.x, dy = c.y - m.y;
    m.x = c.x; m.y = c.y;
    // two fingers pan (or orbit, twoFingers === 'orbit') and pinch; three do the other
    const kind = (pts.length >= 3) === (pick(this.opts.twoFingers, 'pan') === 'orbit') ? 'pan' : 'orbit';
    if (dx || dy) this.emit(kind, dx, dy, m);
    if (pts.length === 2 && d > 10 && m.d > 10 && Math.abs(d - m.d) > 0.5) this.emit('zoom', d / m.d, c.x, c.y, m);
    m.d = d;
  }
}

/**
 * The page never zooms under the fingers: Safari's gesture events (a pinch anywhere) and a two-finger touchmove on the
 * stage are stopped before the browser acts on them. Returns a function that takes the listeners off again.
 */
export function blockPageZoom(doc, el = doc) {
  if (!doc?.addEventListener) return () => {};
  const stop = (e) => e.preventDefault();
  const two = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
  for (const n of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(n, stop, { passive: false });
  el?.addEventListener?.('touchmove', two, { passive: false });
  return () => {
    for (const n of ['gesturestart', 'gesturechange', 'gestureend']) doc.removeEventListener(n, stop);
    el?.removeEventListener?.('touchmove', two);
  };
}
