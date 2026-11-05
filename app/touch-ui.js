/* SPDX-License-Identifier: Apache-2.0 */
/**
 * touch-ui.js — the UI under a finger (iPad): how far a pick reaches per pointer type, panel sections that fold,
 * a long press on a tool button that says its title in the status line. Nothing here draws; modelcraft.css grows the
 * hit areas under `@media (pointer: coarse)`.
 *
 *   hitScale()                 1.6 for a finger, 1.25 for a pen, 1 for a mouse — infer.js / tools.js multiply their
 *                              pixel tolerances by it. Until a pointer was seen, the primary pointer decides
 *                              (`(pointer: coarse)`); in Node it is 1.
 *   setLastPointerType(type)   the viewport's pointerdown reports e.pointerType
 *   mountTouchUi(root, {print}) folding sections (state in localStorage `mc-panel-<id>`), long-press titles
 */

const SCALE = { touch: 1.6, pen: 1.25, mouse: 1 };
let lastType = '';

/** The viewport tells which pointer is drawing (pointerdown). */
export function setLastPointerType(type) { if (type in SCALE) lastType = type; }

/** How much further a pick reaches than with a mouse (1 = the mouse value). */
export function hitScale() {
  if (lastType) return SCALE[lastType];
  try { if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return SCALE.touch; } catch { /* no DOM */ }
  return 1;
}

const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** Folding panel sections and long-press titles. `print(text)` is the app's status line. */
export function mountTouchUi(root, { print } = {}) {
  if (!root) return;
  mountSections(root);
  mountLongPress(root, print);
}

/* ---- sections: every .mc-panel .mc-sec folds from its heading; on a touch screen all but the first of each panel start folded ---- */
function mountSections(root) {
  const secs = [...root.querySelectorAll('.mc-panel .mc-sec')];
  if (!secs.length) return;
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const states = [];
  secs.forEach((sec, i) => {
    const h = sec.querySelector('.mc-h');
    if (!h) return;
    const id = sec.dataset.sec || h.id?.replace(/^mc-|-h$/g, '') || slug(h.textContent) || String(i);
    const key = 'mc-panel-' + id;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'mc-sec-toggle'; btn.setAttribute('aria-expanded', 'true');
    btn.append(...h.childNodes);
    h.append(btn);
    const set = (open, remember) => {
      sec.dataset.collapse = open ? 'open' : 'closed';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (remember) store.set(key, open ? '1' : '0');
    };
    btn.addEventListener('click', () => set(sec.dataset.collapse === 'closed', true));
    const saved = store.get(key);
    const touchDefault = sec.hasAttribute('data-sec-open') || sec.parentElement?.querySelector('.mc-sec') === sec;   // Outliner, Entity info stay open
    states.push({ sec, set, saved, touchDefault });
    set(saved === null ? true : saved === '1', false);
  });
  // the touch defaults: once, when the screen turns out to be a touch screen (modelcraft.js adds .is-touch on the first finger)
  let applied = false;
  const applyTouch = () => {
    if (applied) return;
    applied = true;
    for (const s of states) if (s.saved === null) s.set(s.touchDefault, false);
  };
  if (coarse() || root.classList.contains('is-touch')) applyTouch();
  else if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(() => { if (root.classList.contains('is-touch')) { applyTouch(); mo.disconnect(); } });
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
  }
}

/* ---- long press (500 ms) on a control with a title: the title in the status line; the click that follows is swallowed ---- */
const HOLD = 500, SLIP = 8;
function mountLongPress(root, print) {
  if (typeof print !== 'function') return;
  let timer = 0, el = null, x0 = 0, y0 = 0, fired = null;
  const stop = () => { if (timer) clearTimeout(timer); timer = 0; el = null; };
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const b = e.target.closest?.('[title]');
    if (!b || !root.contains(b) || b.matches('canvas, input, textarea, select')) return;
    stop();
    el = b; x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => {
      timer = 0;
      const title = el?.getAttribute('title');
      if (title) { print(title); fired = el; }
      el = null;
    }, HOLD);
  }, true);
  root.addEventListener('pointermove', (e) => { if (el && Math.hypot(e.clientX - x0, e.clientY - y0) > SLIP) stop(); }, true);
  for (const ev of ['pointerup', 'pointercancel']) root.addEventListener(ev, stop, true);
  root.addEventListener('click', (e) => {
    if (fired && (e.target === fired || fired.contains(e.target))) { e.preventDefault(); e.stopImmediatePropagation(); }
    fired = null;
  }, true);
}
