#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * test-touch-ui.mjs — touch-ui.js (assets/apps/modelcraft/dev/touch-ui.js) without a browser: hitScale() is 1 in Node
 * until a pointer was seen, then follows the last pointer type the viewport reported (finger 1.6, pen 1.25, mouse 1).
 *
 *   node bin/test-touch-ui.mjs [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPS = path.join(ROOT, 'public_html/assets/apps');
const CANON = path.join(APPS, 'modelcraft/dev');
const VERBOSE = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; if (VERBOSE) console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (extra ? ' — ' + extra : '')); } };
const section = (s) => console.log('\n== ' + s);

// The module has no imports of its own, so outside the .cc-test mirror it is read straight from the repo's app/.
const file = [path.join(CANON, 'touch-ui.js'), path.join(ROOT, '..', 'app', 'touch-ui.js')].find((f) => fs.existsSync(f));
if (!file) { console.log('FAIL touch-ui.js not found (mirror or app/)'); process.exit(1); }
const { hitScale, setLastPointerType } = await import(pathToFileURL(file).href);

// ---------------------------------------------------------------------------
section('hitScale per pointer');
ok(hitScale() === 1, 'no pointer seen, no DOM: 1', String(hitScale()));
setLastPointerType('touch'); ok(hitScale() === 1.6, 'touch: 1.6', String(hitScale()));
setLastPointerType('pen'); ok(hitScale() === 1.25, 'pen: 1.25', String(hitScale()));
setLastPointerType('mouse'); ok(hitScale() === 1, 'mouse: 1', String(hitScale()));
setLastPointerType('bogus'); ok(hitScale() === 1, 'unknown type keeps the last one', String(hitScale()));
setLastPointerType('touch'); setLastPointerType(undefined); ok(hitScale() === 1.6, 'undefined keeps the last one', String(hitScale()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
