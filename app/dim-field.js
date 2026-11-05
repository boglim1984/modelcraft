/* SPDX-License-Identifier: Apache-2.0 */
/**
 * dim-field.js — typed precision on a touch screen (iPad): the status bar's value box as a first-class touch control.
 *
 * On `.is-touch` the value box grows to a finger's height and shows a "123" affordance; a floating "Enter a length" button
 * sits near the bottom-right of the stage whenever a tool is waiting for a value (a distance, an angle, a count). Tapping either
 * focuses the field with the number keyboard (inputMode 'decimal'); Enter / Go submits through the form's existing handler, which
 * feeds tools.value(text) → the app's own parser (units.js). A row of unit chips (mm cm m in ft ' ") above the field appends a unit
 * mark, so the number keyboard is enough for 5'6" or 2m. Focusing the field never cancels the tool; after a submit the field is
 * blurred and the view focused again, so the next pen stroke goes to the tool.
 *
 *   createDimField(ui, { tools, focusView, root, t, el }) → { open(), close(), refresh(), dispose() }
 */

const UNITS = ['mm', 'cm', 'm', 'in', 'ft', "'", '"'];
const POLL_MS = 150;

export function createDimField(ui, { tools, focusView, root, t, el }) {
  const form = ui.vcbForm, field = ui.vcb;
  if (!form || !field || form.dataset.dimField) return null;
  form.dataset.dimField = '1';
  let wasMode = null;   // the inputMode before open() switched it to numbers (the "abc" toggle's choice), put back on blur

  // (a) the "123" affordance in the status bar's form: tapping it opens the number keyboard in the field
  const num = el('button', { type: 'button', className: 'mc-vcb-num', dataset: { vcbNum: '' }, title: t('ui.dim.num.title'), 'aria-label': t('ui.dim.num.title') }, '123');
  form.insertBefore(num, field);

  // (d) unit chips above the field while it has the keyboard: tap to append a unit mark to what was typed
  const units = el('div', { className: 'mc-dim-units', dataset: { dimUnits: '' }, role: 'group', 'aria-label': t('ui.dim.units.aria') },
    UNITS.map((u) => el('button', { type: 'button', className: 'mc-dim-unit', dataset: { dimUnit: u }, title: t('ui.dim.units.add', { unit: u }) }, u)));
  form.append(units);
  units.addEventListener('pointerdown', (e) => e.preventDefault());   // keep the field's focus (and its keyboard) open
  units.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dim-unit]');
    if (!b) return;
    const u = b.dataset.dimUnit, v = field.value;
    // a number before a unit mark, a space between two measures (5' 6"): what parseLength reads
    field.value = /[0-9.]$/.test(v) ? v + u : /['"]$/.test(v) ? v + ' ' : v;
    field.setSelectionRange?.(field.value.length, field.value.length);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // (b) the floating "Enter a length" button on the stage while a tool is waiting for a value
  const tap = el('button', { type: 'button', className: 'mc-dim-tap', dataset: { dimTap: '' }, hidden: true, title: t('ui.dim.tap.title') },
    el('i', { className: 'bi bi-123', 'aria-hidden': 'true' }), el('span', {}, t('ui.dim.tap')));
  (ui.stage || root).append(tap);

  // (c) opening the field never cancels the tool: nothing here reaches the view's pointer handlers or tools.escape()
  const open = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (wasMode === null) wasMode = field.inputMode || 'text';
    field.inputMode = 'decimal';
    if (document.activeElement === field) { field.blur(); }   // the keyboard changes on the next focus
    field.focus({ preventScroll: true });
    field.setSelectionRange?.(field.value.length, field.value.length);
  };
  const close = () => { field.blur(); focusView?.(); };
  for (const b of [num, tap]) { b.addEventListener('pointerdown', (e) => e.preventDefault()); b.addEventListener('click', open); }
  field.addEventListener('blur', () => { if (wasMode !== null) { field.inputMode = wasMode; wasMode = null; } refresh(); });
  field.addEventListener('focus', refresh);
  // after the form's own submit handler (registered first) has fed tools.value(): let go of the keyboard, back to the pen
  form.addEventListener('submit', () => { setTimeout(close, 0); });

  // the tool's state is polled cheaply (a hidden flag flip only when it changes), only while this touch session lasts
  let shown = null;
  function refresh() {
    const busy = !!tools.tool?.busy && document.activeElement !== field;
    if (busy !== shown) { shown = busy; tap.hidden = !busy; }
  }
  const timer = setInterval(refresh, POLL_MS);
  refresh();

  return {
    open, close, refresh,
    dispose() { clearInterval(timer); num.remove(); units.remove(); tap.remove(); delete form.dataset.dimField; },
  };
}
