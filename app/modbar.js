/* SPDX-License-Identifier: Apache-2.0 */
/**
 * modbar.js — the modifier bar for a touch screen without a keyboard (an iPad with a Pencil or a finger): sticky
 * Shift / Ctrl / Alt, and the Snap and Ortho toggles, floating at the bottom-left of the stage (markup: ui.inc
 * [data-modbar]; styles: the modbar block at the end of modelcraft.css; the app only shows it on `.is-touch`).
 *
 *   createModBar(root, { onKey(name, down), onToggle(id, on) }) → bar
 *     bar.state()      → { shift, ctrl, alt } — what is held now; the app ORs it into every tool event (mods(e))
 *     bar.with(ev)     → ev with the held keys ORed in
 *     bar.set(id, on)  → show a toggle's state ('snap', 'ortho' — or a key, without calling onKey)
 *     bar.release()    → after a tool gesture (its up): single-tapped keys let go, locked ones stay
 *     bar.wrap(tools)  → tools.down/move/up carry the held keys (paths that pass no keyboard state too) and up releases
 *
 * A key behaves as iOS's Shift: one tap holds it for the next gesture (shown pressed), two taps within 300 ms lock it
 * (pressed + .is-locked) until it is tapped again; a tap on a held or locked key lets go of it. onKey fires with the
 * keyboard's name ('Shift', 'Control', 'Alt') and true/false, so the app can tell the tools as the keydown/keyup do.
 */

const KEYS = { shift: 'Shift', ctrl: 'Control', alt: 'Alt' };
const DOUBLE_MS = 300;

export function createModBar(root, { onKey, onToggle } = {}) {
  const bar = root?.querySelector?.('[data-modbar]') || null;
  const held = { shift: false, ctrl: false, alt: false };
  const locked = { shift: false, ctrl: false, alt: false };
  const lastTap = { shift: 0, ctrl: 0, alt: 0 };
  const toggles = { snap: false, ortho: false };
  const btn = (id) => bar?.querySelector(`[data-mod="${id}"]`) || null;
  const paint = (id) => {
    const b = btn(id);
    if (!b) return;
    if (id in KEYS) { b.setAttribute('aria-pressed', String(held[id])); b.classList.toggle('is-locked', locked[id]); }
    else b.setAttribute('aria-pressed', String(toggles[id]));
  };
  const setKey = (id, on, lock = false) => {
    const was = held[id];
    held[id] = !!on; locked[id] = !!on && lock;
    paint(id);
    if (was !== held[id]) onKey?.(KEYS[id], held[id]);
  };
  const tapKey = (id, now = performance.now()) => {
    const again = now - lastTap[id] < DOUBLE_MS;
    lastTap[id] = now;
    if (!held[id]) setKey(id, true);                   // one tap: held for the next gesture
    else if (again && !locked[id]) setKey(id, true, true);   // a second tap right after: locked
    else setKey(id, false);                            // a tap on a held or locked key: off
  };
  bar?.addEventListener('pointerdown', (e) => { if (e.target.closest('button[data-mod]')) e.preventDefault(); });   // keep the view's focus
  bar?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mod]');
    if (!b) return;
    const id = b.dataset.mod;
    if (id in KEYS) tapKey(id, e.timeStamp || performance.now());
    else if (id in toggles) onToggle?.(id, !toggles[id]);
  });
  const api = {
    el: bar,
    state: () => ({ shift: held.shift, ctrl: held.ctrl, alt: held.alt }),
    with: (ev) => (held.shift || held.ctrl || held.alt ? { ...ev, shift: !!ev.shift || held.shift, ctrl: !!ev.ctrl || held.ctrl, alt: !!ev.alt || held.alt } : ev),
    set(id, on) {
      if (id in KEYS) { held[id] = !!on; if (!on) locked[id] = false; paint(id); }
      else if (id in toggles) { toggles[id] = !!on; paint(id); }
    },
    release() { for (const id of Object.keys(KEYS)) if (held[id] && !locked[id]) setKey(id, false); },
    tap: tapKey,   // for tests: a tap at a time
    wrap(tools) {
      for (const m of ['down', 'move', 'up']) {
        const f = tools[m].bind(tools);
        tools[m] = (ev) => { const r = f(api.with(ev)); if (m === 'up') api.release(); return r; };
      }
      return tools;
    },
  };
  for (const id of Object.keys(KEYS)) paint(id);
  return api;
}
