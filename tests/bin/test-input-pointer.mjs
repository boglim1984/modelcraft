#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * test-input-pointer.mjs — the Pointer Events helpers (assets/apps/modelcraft/dev/input-pointer.js) without a browser:
 * pointerPos (pressure / tilt only for a pen), markPen / unmarkPen / palmReject (a finger is refused only while a pen is
 * down), onRelease on a stand-in EventTarget (pointercancel fires, a capture lost right after its pointerup does not,
 * a capture lost without an up does, a window blur does; unwiring removes every listener).
 *
 *   node bin/test-input-pointer.mjs [--verbose]
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANON = path.join(ROOT, 'public_html/assets/apps/modelcraft/dev');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; if (VERBOSE) console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (extra ? ' — ' + extra : '')); } };
const section = (s) => console.log('\n== ' + s);

/** A stand-in EventTarget: records listeners (with their capture flag) and dispatches plain objects. */
class FakeTarget {
  constructor() { this.listeners = new Map(); }
  key(type, capture) { return type + (capture ? '!c' : ''); }
  addEventListener(type, fn, capture = false) {
    const k = this.key(type, !!capture);
    if (!this.listeners.has(k)) this.listeners.set(k, new Set());
    this.listeners.get(k).add(fn);
  }
  removeEventListener(type, fn, capture = false) { this.listeners.get(this.key(type, !!capture))?.delete(fn); }
  dispatch(type, e = {}) {
    const ev = { type, ...e };
    for (const k of [this.key(type, true), this.key(type, false)]) for (const fn of [...(this.listeners.get(k) || [])]) fn(ev);
    return ev;
  }
  count() { let n = 0; for (const s of this.listeners.values()) n += s.size; return n; }
}

// The module wires window blur on the global window: give it one for the run, then put things back.
const hadWindow = 'window' in globalThis;
const savedWindow = globalThis.window;
const fakeWindow = new FakeTarget();
globalThis.window = fakeWindow;

const IP = await import(pathToFileURL(path.join(CANON, 'input-pointer.js')).href);
const { penDown, markPen, unmarkPen, palmReject, pointerPos, onRelease, drag } = IP;

const el = () => ({ getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }), style: {} });
const ev = (pointerType, pointerId, extra = {}) => ({ pointerType, pointerId, clientX: 160, clientY: 80, ...extra });

// ---------------------------------------------------------------------------
section('pointerPos');
{
  const e = el();
  const m = pointerPos(e, ev('mouse', 1));
  ok(m.x === 60 && m.y === 30, 'mouse: position in the element\'s pixels', JSON.stringify(m));
  ok(m.pen === false && !('pressure' in m) && !('tiltX' in m) && !('tiltY' in m), 'mouse: no pressure or tilt field at all', JSON.stringify(m));
  const t = pointerPos(e, ev('touch', 2, { pressure: 0.7, tiltX: 10, tiltY: 20 }));
  ok(t.pen === false && !('pressure' in t) && !('tiltX' in t), 'finger: no pressure / tilt even when the event carries them', JSON.stringify(t));
  const p = pointerPos(e, ev('pen', 3, { pressure: 0.25, tiltX: -12, tiltY: 33 }));
  ok(p.pen === true && p.x === 60 && p.y === 30, 'pen: position and pen flag', JSON.stringify(p));
  ok(p.pressure === 0.25 && p.tiltX === -12 && p.tiltY === 33, 'pen: pressure and tilt pass through', JSON.stringify(p));
  const p0 = pointerPos(e, ev('pen', 4));
  ok(p0.pressure === 0.5 && p0.tiltX === 0 && p0.tiltY === 0, 'pen without pressure / tilt: 0.5 and 0, 0', JSON.stringify(p0));
  const pz = pointerPos(e, ev('pen', 5, { pressure: 0 }));
  ok(pz.pressure === 0, 'pen pressure 0 stays 0 (hovering, not "unknown")', String(pz.pressure));
}

// ---------------------------------------------------------------------------
section('markPen / unmarkPen / palmReject');
{
  penDown.clear();
  ok(palmReject(ev('touch', 10)) === false, 'a finger alone is accepted');
  ok(markPen(ev('mouse', 1)) === false && penDown.size === 0, 'markPen ignores a mouse');
  ok(markPen(ev('touch', 10)) === false && penDown.size === 0, 'markPen ignores a finger');
  ok(markPen(ev('pen', 7)) === true && penDown.has(7), 'markPen remembers a pen');
  ok(palmReject(ev('touch', 10)) === true, 'a finger while the pen is down is rejected (the palm)');
  ok(palmReject(ev('mouse', 1)) === false && palmReject(ev('pen', 8)) === false, 'a mouse or a second pen is never palm-rejected');
  unmarkPen(ev('touch', 10));
  ok(penDown.has(7), 'unmarkPen of a finger does not forget the pen');
  unmarkPen(ev('pen', 7));
  ok(penDown.size === 0, 'unmarkPen forgets the pen');
  ok(palmReject(ev('touch', 10)) === false, 'after the pen lifts a finger is accepted again');
  markPen(ev('pen', 7)); markPen(ev('pen', 8));
  ok(penDown.size === 2, 'two pens down');
  unmarkPen(ev('pen', 7));
  ok(penDown.size === 1 && palmReject(ev('touch', 10)) === true, 'one pen still down: still rejecting');
  unmarkPen({ pointerId: 8 });   // a pointercancel may arrive with the pen's id but no useful type
  ok(penDown.size === 0, 'unmarkPen by id alone works for a pen that was marked');
  markPen(ev('pen', 7)); markPen(ev('pen', 8));
  unmarkPen();
  ok(penDown.size === 0 && palmReject(ev('touch', 10)) === false, 'unmarkPen() forgets every pen (lost window)');
}

// ---------------------------------------------------------------------------
section('onRelease');
{
  const tgt = new FakeTarget();
  const base = fakeWindow.count();
  const calls = [];
  const off = onRelease(tgt, (e) => calls.push(e.type + ':' + (e.pointerId ?? '-')));
  ok(tgt.count() === 4, 'four capture listeners on the element', String(tgt.count()));
  ok(fakeWindow.count() === base + 1, 'one blur listener on the window', String(fakeWindow.count() - base));

  tgt.dispatch('pointerdown', { pointerId: 1 });
  tgt.dispatch('pointercancel', { pointerId: 1 });
  ok(calls.length === 1 && calls[0] === 'pointercancel:1', 'pointercancel calls fn', calls.join(','));

  calls.length = 0;
  tgt.dispatch('pointerdown', { pointerId: 2 });
  tgt.dispatch('pointerup', { pointerId: 2 });
  tgt.dispatch('lostpointercapture', { pointerId: 2 });
  ok(calls.length === 0, 'lostpointercapture right after a pointerup for the same pointer does NOT call fn', calls.join(','));

  calls.length = 0;
  tgt.dispatch('pointerdown', { pointerId: 3 });
  tgt.dispatch('lostpointercapture', { pointerId: 3 });
  ok(calls.length === 1 && calls[0] === 'lostpointercapture:3', 'lostpointercapture without a pointerup DOES call fn', calls.join(','));
  tgt.dispatch('lostpointercapture', { pointerId: 3 });
  ok(calls.length === 1, 'a second lostpointercapture for the same pointer is ignored', calls.join(','));

  calls.length = 0;
  tgt.dispatch('lostpointercapture', { pointerId: 99 });
  ok(calls.length === 0, 'lostpointercapture for a pointer el never saw go down is ignored', calls.join(','));

  calls.length = 0;
  tgt.dispatch('pointerdown', { pointerId: 4 });
  tgt.dispatch('pointerdown', { pointerId: 5 });
  tgt.dispatch('pointerup', { pointerId: 4 });
  tgt.dispatch('lostpointercapture', { pointerId: 5 });
  tgt.dispatch('lostpointercapture', { pointerId: 4 });
  ok(calls.length === 1 && calls[0] === 'lostpointercapture:5', 'two pointers: only the one lost without an up calls fn', calls.join(','));

  calls.length = 0;
  tgt.dispatch('pointerdown', { pointerId: 6 });
  fakeWindow.dispatch('blur');
  ok(calls.length === 1 && calls[0] === 'blur:-', 'a window blur calls fn', calls.join(','));
  tgt.dispatch('lostpointercapture', { pointerId: 6 });
  ok(calls.length === 1, 'blur forgets the active pointers: the capture lost afterwards is quiet', calls.join(','));

  calls.length = 0;
  off();
  ok(tgt.count() === 0, 'unwiring removes every element listener', String(tgt.count()));
  ok(fakeWindow.count() === base, 'unwiring removes the window blur listener', String(fakeWindow.count() - base));
  tgt.dispatch('pointerdown', { pointerId: 7 });
  tgt.dispatch('pointercancel', { pointerId: 7 });
  fakeWindow.dispatch('blur');
  ok(calls.length === 0, 'after unwiring nothing calls fn', calls.join(','));
}

// ---------------------------------------------------------------------------
section('drag (the helpers put together)');
{
  penDown.clear();
  const tgt = new FakeTarget();
  tgt.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  tgt.style = {};
  const captured = [], released = [];
  tgt.setPointerCapture = (id) => captured.push(id);
  tgt.releasePointerCapture = (id) => released.push(id);
  const log = [];
  const h = { down: (e, p) => log.push('down ' + p.x), move: (e, p) => log.push('move ' + p.x), up: (e, p) => log.push('up ' + p.x), cancel: (e, p) => log.push('cancel ' + (p ? p.x : '-')) };
  const off = drag(tgt, h);
  ok(tgt.style.touchAction === 'none', 'drag marks touch-action: none');
  let prevented = 0;
  const pe = (type, id, pt, x, extra = {}) => tgt.dispatch(type, { pointerId: id, pointerType: pt, clientX: x, clientY: 0, button: 0, preventDefault: () => prevented++, ...extra });
  pe('pointerdown', 1, 'pen', 10); pe('pointermove', 1, 'pen', 20); pe('pointermove', 2, 'touch', 99); pe('pointerup', 1, 'pen', 30);
  ok(log.join('|') === 'down 10|move 20|up 30', 'pen press-drag-release: down, move, up (another pointer\'s move ignored)', log.join('|'));
  ok(captured.join() === '1' && released.join() === '1' && prevented === 1, 'capture set and released, default prevented');
  ok(penDown.size === 0, 'the pen is forgotten after its up');
  log.length = 0;
  pe('pointerdown', 3, 'pen', 10); pe('pointerdown', 4, 'touch', 50);
  ok(log.join('|') === 'down 10', 'a finger while the pen drags is palm-rejected', log.join('|'));
  pe('pointercancel', 3, 'pen', 10);
  ok(log.join('|') === 'down 10|cancel 10' && penDown.size === 0, 'pointercancel: h.cancel with the last position, pen forgotten', log.join('|'));
  log.length = 0;
  pe('pointerdown', 5, 'touch', 40);
  ok(log.join('|') === 'down 40', 'after the pen lifts a finger drags again', log.join('|'));
  fakeWindow.dispatch('blur');
  ok(log.join('|') === 'down 40|cancel 40', 'a window blur cancels the drag with the last position', log.join('|'));
  log.length = 0;
  pe('pointerdown', 6, 'mouse', 10, { button: 2 });
  ok(log.length === 0, 'a right mouse button does not start a drag');
  off();
  pe('pointerdown', 7, 'mouse', 10);
  ok(log.length === 0 && tgt.count() === 0, 'unwired: nothing listens');
}

if (hadWindow) globalThis.window = savedWindow; else delete globalThis.window;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
