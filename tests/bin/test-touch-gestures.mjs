#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * test-touch-gestures.mjs — the viewport's finger gestures (assets/apps/modelcraft/dev/touch-gestures.js) without a
 * browser: one finger orbits or draws, two pan and pinch, three orbit (and swap), n-finger taps, long press, the
 * dead zone that keeps a two-finger tap from nudging the camera, cancel, and blockPageZoom on a stand-in document.
 *
 *   node bin/test-touch-gestures.mjs [--verbose]
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANON = path.join(ROOT, 'public_html/assets/apps/modelcraft/dev');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; if (VERBOSE) console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (extra ? ' — ' + extra : '')); } };
const section = (s) => console.log('\n== ' + s);

const { TouchGestures, blockPageZoom } = await import(pathToFileURL(path.join(CANON, 'touch-gestures.js')).href);

/** A recognizer with a hand-cranked clock: timers fire through tick(ms); every report is logged. */
function rig(opts = {}) {
  const log = [];
  let frame = null;
  if (opts.frames) opts = { ...opts, schedule: (fn) => { frame = fn; } };   // moves wait for tick(): one flush per frame, as in a browser
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const g = new TouchGestures({
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    ...opts,
  }, {
    orbit: (dx, dy, s) => log.push(['orbit', dx, dy, s.n]),
    pan: (dx, dy, s) => log.push(['pan', dx, dy, s.n]),
    zoom: (f, cx, cy) => log.push(['zoom', +f.toFixed(3), cx, cy]),
    tap: (n, x, y) => log.push(['tap', n, x, y]),
    longPress: (x, y) => { log.push(['longPress', x, y]); return opts.holdOrbits ? 'orbit' : undefined; },
    hover: (p) => log.push(['hover', p.x, p.y]),
    down: (p) => log.push(['down', p.x, p.y]),
    move: (p) => log.push(['move', p.x, p.y]),
    up: (p) => log.push(['up', p.x, p.y]),
    cancel: () => log.push(['cancel']),
  });
  const tick = (ms) => {
    now += ms;
    if (frame) { const f = frame; frame = null; f(); }
    for (const [id, tm] of [...timers]) if (tm.at <= now) { timers.delete(id); tm.fn(); }
  };
  return { g, log, tick, t: () => now, kinds: () => log.map((e) => e[0]) };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
section('one finger, mode orbit');
{
  const r = rig({ mode: 'orbit' });
  r.g.down(1, 100, 100, r.t());
  r.tick(50); r.g.move(1, 103, 101, r.t());             // inside the dead zone: nothing
  ok(r.log.length === 0, 'a small move does nothing yet', JSON.stringify(r.log));
  r.g.move(1, 120, 110, r.t());                          // past tapPx: the orbit starts from here (no jump)
  ok(r.log.length === 0, 'the first far move starts the orbit without a jump', JSON.stringify(r.log));
  r.g.move(1, 130, 112, r.t());
  ok(same(r.log, [['orbit', 10, 2, 1]]), 'then every move orbits by its delta', JSON.stringify(r.log));
  r.g.up(1, 130, 112, r.t());
  ok(r.log.length === 1 && r.g.count === 0, 'lifting ends it quietly (no tap after a drag)');
}
{
  const r = rig({ mode: 'orbit' });
  r.g.down(1, 40, 50, 0); r.tick(80); r.g.up(1, 42, 51, r.t());
  ok(same(r.log, [['tap', 1, 40, 50]]), 'a quick still touch is a one-finger tap at where it went down', JSON.stringify(r.log));
}
{
  const r = rig({ mode: 'orbit' });
  r.g.down(1, 40, 50, 0); r.tick(400); r.g.up(1, 40, 50, r.t());
  ok(same(r.log, [['tap', 1, 40, 50]]), 'a slower still touch (lifted before the long press) is a tap too', JSON.stringify(r.log));
}
{
  const r = rig({ mode: 'orbit' });
  r.g.down(1, 40, 50, 0); r.tick(300); r.g.move(1, 45, 50, r.t()); r.g.move(1, 55, 50, r.t());
  ok(same(r.log, [['orbit', 10, 0, 1]]), 'held a while then moved: an orbit (time arms it, the first move sets the origin)', JSON.stringify(r.log));
}
{
  const r = rig({ mode: 'orbit' });
  r.g.down(1, 40, 50, 0); r.tick(500);
  ok(same(r.log, [['longPress', 40, 50]]), 'held still 500 ms: longPress', JSON.stringify(r.log));
  r.g.move(1, 80, 50, r.t()); r.g.up(1, 80, 50, r.t());
  ok(r.log.length === 1, 'after a long press the finger is spent: no orbit, no tap', JSON.stringify(r.log));
}
{
  const r = rig({ mode: 'orbit', holdOrbits: true });
  r.g.down(1, 40, 50, 0); r.tick(500); r.g.move(1, 48, 54, r.t());
  ok(same(r.log, [['longPress', 40, 50], ['orbit', 8, 4, 1]]), 'longPress may answer "orbit": the finger orbits from where it is', JSON.stringify(r.log));
}

// ---------------------------------------------------------------------------
section('one finger, mode draw (the tool)');
{
  const r = rig({ mode: 'draw' });
  r.g.down(1, 10, 10, 0);
  ok(same(r.log, [['hover', 10, 10]]), 'down = the tool hovers there', JSON.stringify(r.log));
  r.g.move(1, 13, 12, 10);
  ok(same(r.log.at(-1), ['hover', 13, 12]), 'a small move still hovers');
  r.g.move(1, 30, 20, 20);
  ok(same(r.log.slice(2), [['down', 10, 10], ['move', 30, 20]]), 'past movePx: down from where the finger landed, then move', JSON.stringify(r.log));
  ok(r.g.dragging, 'dragging');
  r.g.up(1, 35, 22, 30);
  ok(same(r.log.at(-1), ['up', 35, 22]) && !r.g.dragging, 'up ends the press–drag');
}
{
  const r = rig({ mode: 'draw' });
  r.g.down(1, 10, 10, 0); r.g.up(1, 11, 10, 90);
  ok(same(r.log, [['hover', 10, 10], ['tap', 1, 10, 10]]), 'a tap = a click for the tool', JSON.stringify(r.log));
}
{
  const r = rig({ mode: 'draw', holdOrbits: true });
  r.g.down(1, 10, 10, 0); r.tick(500); r.g.move(1, 20, 10, r.t());
  ok(same(r.log, [['hover', 10, 10], ['longPress', 10, 10], ['orbit', 10, 0, 1]]), 'hold still then drag: orbit when the app says so', JSON.stringify(r.log));
}
{
  const r = rig({ mode: () => 'draw' });
  r.g.down(1, 10, 10, 0); r.g.move(1, 40, 10, 10); r.g.down(2, 100, 100, 20);
  ok(same(r.log.at(-1), ['cancel']) && r.g.gesture === 'multi', 'a second finger cancels the press–drag', JSON.stringify(r.log));
}

// ---------------------------------------------------------------------------
section('two fingers: pan and pinch, with a dead zone for taps');
{
  const r = rig({ mode: 'orbit', frames: true });
  r.g.down(1, 100, 100, 0); r.g.down(2, 200, 100, 5);
  r.g.move(1, 103, 102, 40); r.g.move(2, 203, 102, 40); r.tick(1);
  ok(r.log.length === 0, 'small early moves do not move the camera', JSON.stringify(r.log));
  r.g.move(1, 120, 110, 60); r.g.move(2, 220, 110, 60); r.tick(1);
  ok(r.log.length === 0, 'the first far move arms the gesture without a jump', JSON.stringify(r.log));
  r.g.move(1, 130, 110, 70); r.g.move(2, 230, 110, 70); r.tick(1);
  ok(same(r.log, [['pan', 10, 0, 2]]), 'then the middle\'s delta pans', JSON.stringify(r.log));
  r.g.move(1, 110, 110, 80); r.g.move(2, 250, 110, 80); r.tick(1);
  const z = r.log.find((e) => e[0] === 'zoom');
  ok(z && z[1] === 1.4 && z[2] === 180 && z[3] === 110, 'spreading pinches: factor new/old about the middle', JSON.stringify(r.log));
  r.g.up(1, 110, 110, 90); r.g.up(2, 250, 110, 95);
  ok(!r.kinds().includes('tap') && r.g.count === 0, 'no tap after a drag');
}
{
  const r = rig({ mode: 'orbit' });
  r.g.down(1, 100, 100, 0); r.g.down(2, 200, 100, 10);
  r.g.move(1, 102, 101, 50);
  r.g.up(1, 102, 101, 120); r.g.up(2, 200, 100, 130);
  ok(same(r.log, [['tap', 2, 150, 100]]), 'two fingers down and up quickly = a two-finger tap at their middle, no pan', JSON.stringify(r.log));
}
{
  const r = rig({ mode: 'orbit' });
  r.g.down(1, 100, 100, 0); r.g.down(2, 200, 100, 10);
  r.g.up(1, 100, 100, 300); r.g.up(2, 200, 100, 310);
  ok(r.log.length === 0, 'two fingers held past tapMs then lifted: not a tap', JSON.stringify(r.log));
}
{
  const r = rig({ mode: 'orbit', schedule: (fn) => { r.pending = fn; } });
  r.g.down(1, 100, 100, 0); r.g.down(2, 200, 100, 0);
  r.g.move(1, 150, 100, 400); r.g.move(2, 250, 100, 400);
  ok(r.log.length === 0 && typeof r.pending === 'function', 'moves are coalesced through schedule()');
  r.pending(); r.pending = null;   // the first frame arms the drag
  r.g.move(1, 200, 100, 420); r.g.move(2, 300, 100, 420);
  ok(r.log.length === 0 && typeof r.pending === 'function', 'the arming frame moves nothing');
  r.pending();
  ok(same(r.log, [['pan', 50, 0, 2]]), 'one report per frame for both fingers', JSON.stringify(r.log));
}

// ---------------------------------------------------------------------------
section('three fingers');
{
  const r = rig({ mode: 'orbit' });
  r.g.down(1, 100, 100, 0); r.g.down(2, 200, 100, 5); r.g.down(3, 150, 200, 10);
  r.g.up(1, 100, 100, 100); r.g.up(2, 200, 100, 105); r.g.up(3, 150, 200, 110);
  ok(same(r.log, [['tap', 3, 150, 100]]), 'three-finger tap (the middle of the first two)', JSON.stringify(r.log));
}
{
  const r = rig({ mode: 'orbit' });
  r.g.down(1, 100, 100, 0); r.g.down(2, 200, 100, 0); r.g.down(3, 150, 200, 0);
  for (const id of [1, 2, 3]) r.g.move(id, [100, 200, 150][id - 1] + 30, [100, 100, 200][id - 1], 400);
  for (const id of [1, 2, 3]) r.g.move(id, [100, 200, 150][id - 1] + 40, [100, 100, 200][id - 1], 410);
  ok(r.log.every((e) => e[0] === 'orbit') && r.log.length && r.log.at(-1)[3] === 3, 'three fingers orbit by default', JSON.stringify(r.log));
  r.g.up(1, 0, 0, 500); r.g.up(2, 0, 0, 500);
  r.g.move(3, 300, 300, 600);
  ok(r.log.every((e) => e[0] === 'orbit') && r.g.gesture === 'multi', 'fingers lifting out of a gesture do not hand it to the tool', JSON.stringify(r.log.slice(-2)));
  r.g.up(3, 300, 300, 700);
  ok(r.g.count === 0 && r.g.gesture === null, 'all clear');
}
{
  const r = rig({ mode: 'orbit', twoFingers: () => 'orbit', frames: true });
  r.g.down(1, 100, 100, 0); r.g.down(2, 200, 100, 0);
  r.g.move(1, 130, 100, 400); r.g.move(2, 230, 100, 400); r.tick(1);
  r.g.move(1, 140, 100, 410); r.g.move(2, 240, 100, 410); r.tick(1);
  ok(same(r.log, [['orbit', 10, 0, 2]]), 'twoFingers = orbit swaps them', JSON.stringify(r.log));
}

// ---------------------------------------------------------------------------
section('cancel and reset');
{
  const r = rig({ mode: 'draw' });
  r.g.down(1, 10, 10, 0); r.g.move(1, 50, 10, 10); r.g.cancel(1);
  ok(same(r.log.at(-1), ['cancel']) && r.g.count === 0 && r.g.gesture === null, 'a cancelled press–drag is cancelled for the tool');
  r.g.down(1, 10, 10, 20); r.g.down(2, 20, 20, 20); r.g.reset();
  ok(r.g.count === 0 && r.g.gesture === null, 'reset forgets every finger');
  r.g.move(9, 1, 1, 30); r.g.up(9, 1, 1, 30);
  ok(true, 'unknown fingers are ignored');
}

// ---------------------------------------------------------------------------
section('blockPageZoom');
{
  const mk = () => { const l = new Map(); return { l, addEventListener: (n, f, o) => l.set(n, { f, o }), removeEventListener: (n) => l.delete(n) }; };
  const doc = mk(), el = mk();
  const off = blockPageZoom(doc, el);
  ok(['gesturestart', 'gesturechange', 'gestureend'].every((n) => doc.l.has(n) && doc.l.get(n).o.passive === false), 'Safari gesture events are blocked on the document');
  ok(el.l.has('touchmove') && el.l.get('touchmove').o.passive === false, 'touchmove on the stage, not passive');
  let stopped = 0;
  el.l.get('touchmove').f({ touches: [1], preventDefault: () => stopped++ });
  el.l.get('touchmove').f({ touches: [1, 2], preventDefault: () => stopped++ });
  ok(stopped === 1, 'only a two-finger touchmove is stopped (one finger stays the tool)');
  off();
  ok(doc.l.size === 0 && el.l.size === 0, 'the returned function takes them off');
  ok(typeof blockPageZoom(null) === 'function', 'no document: a no-op');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
