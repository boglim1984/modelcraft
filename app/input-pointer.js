/* SPDX-License-Identifier: Apache-2.0 */
/**
 * input-pointer.js — Pointer Events are the one input path (iPad track: the Apple Pencil is a precise primary input, a
 * finger is a coarse one, the mouse is as it was). Small DOM helpers the view and every dragged widget share; no state
 * but the set of pens that are down.
 *
 *   penDown              Set of the pointerIds of pens touching the screen right now
 *   markPen(e)           on pointerdown: remember a pen; returns true when e is a pen
 *   unmarkPen(e)         on pointerup / pointercancel: forget it (no e = forget every pen, for a lost window)
 *   palmReject(e)        true when e is a finger while a pen is down — the hand resting beside the Pencil: ignore it
 *   pointerPos(el, e)    {x, y, pen} in el's pixels; a pen adds pressure (0–1), tiltX, tiltY — a mouse or finger has
 *                        no pressure field at all, so a tool can tell "no pen" from "a pen pressing lightly"
 *   onRelease(el, fn)    fn(e) when el loses a pointer without a pointerup: pointercancel, a capture lost mid-press
 *                        (the browser took the gesture, the element went away) or the window losing focus (an app
 *                        switch, a system dialog). A capture that ends with a normal pointerup does not call fn (the
 *                        up handler did the work); returns the function that unwires it.
 *   drag(el, h, opts)    pointerdown → pointermove → pointerup on el with capture, the usual press–drag of a widget
 *                        (a slider, a splitter, a handle): h.down(e, p) (return false to decline), h.move(e, p), h.up(e, p),
 *                        h.cancel(e) on a lost pointer; p = pointerPos(el, e). Marks el touch-action: none unless
 *                        opts.touchAction says otherwise. Returns the function that unwires it.
 */

export const penDown = new Set();

export function markPen(e) {
  if (e.pointerType !== 'pen') return false;
  penDown.add(e.pointerId);
  return true;
}

export function unmarkPen(e) {
  if (!e) { penDown.clear(); return; }
  if (e.pointerType === 'pen' || penDown.has(e.pointerId)) penDown.delete(e.pointerId);
}

export function palmReject(e) {
  return e.pointerType === 'touch' && penDown.size > 0;
}

export function pointerPos(el, e) {
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (e.pointerType !== 'pen') return { x, y, pen: false };
  return { x, y, pen: true, pressure: typeof e.pressure === 'number' ? e.pressure : 0.5, tiltX: e.tiltX ?? 0, tiltY: e.tiltY ?? 0 };
}

export function onRelease(el, fn) {
  const active = new Set();   // pointers el has seen go down and not yet come up
  const down = (e) => active.add(e.pointerId);
  const up = (e) => active.delete(e.pointerId);
  const cancel = (e) => { active.delete(e.pointerId); fn(e); };
  const lost = (e) => { if (!active.has(e.pointerId)) return; active.delete(e.pointerId); fn(e); };   // lost without an up
  const blur = (e) => { active.clear(); fn(e); };
  el.addEventListener('pointerdown', down, true);
  el.addEventListener('pointerup', up, true);
  el.addEventListener('pointercancel', cancel, true);
  el.addEventListener('lostpointercapture', lost, true);
  window.addEventListener('blur', blur);
  return () => {
    el.removeEventListener('pointerdown', down, true);
    el.removeEventListener('pointerup', up, true);
    el.removeEventListener('pointercancel', cancel, true);
    el.removeEventListener('lostpointercapture', lost, true);
    window.removeEventListener('blur', blur);
  };
}

export function drag(el, h, opts = {}) {
  if (opts.touchAction !== false) el.style.touchAction = opts.touchAction || 'none';
  let id = null, last = null;
  const onDown = (e) => {
    if (id !== null) return;
    if (opts.button !== undefined ? e.button !== opts.button : e.button !== 0 && e.pointerType === 'mouse') return;
    if (palmReject(e)) return;
    markPen(e);
    const p = pointerPos(el, e);
    if (h.down && h.down(e, p) === false) return;
    id = e.pointerId; last = p;
    try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
    if (opts.preventDefault !== false) e.preventDefault();
  };
  const onMove = (e) => { if (e.pointerId !== id) return; last = pointerPos(el, e); h.move?.(e, last); };
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    unmarkPen(e);
    try { el.releasePointerCapture(e.pointerId); } catch { /* already */ }
    h.up?.(e, pointerPos(el, e));
  };
  const release = (e) => { if (id === null) return; id = null; unmarkPen(); (h.cancel || h.up)?.(e, last); };   // last: a blur has no position
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', end);
  const off = onRelease(el, release);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', end);
    off();
  };
}
