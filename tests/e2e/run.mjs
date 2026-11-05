/* SPDX-License-Identifier: Apache-2.0 */
/**
 * tests/e2e/run.mjs — ModelCraft on an emulated iPad (Chromium via the preinstalled `playwright` package; no
 * @playwright/test, no npm dependencies). `npm run e2e`.
 *
 * Starts devshell/serve.mjs --offline on a port, opens ?space=model as an iPad Pro 11 (834×1194, dpr 2, touch, the
 * iPad Safari user agent), and drives trusted pointer input through the Chrome DevTools Protocol — a pen with pressure
 * draws a rectangle, two fingers pinch, a finger taps a toolbar button. Synthetic PointerEvents from page.evaluate are
 * untrusted: the viewport's pointerdown calls setPointerCapture(pointerId), which throws for a pointer the browser does
 * not own, so CDP Input.dispatchMouseEvent (pointerType 'pen', force) and Input.dispatchTouchEvent are used instead.
 *
 * Every console error and pageerror fails the run (ALLOW below lists the only tolerated messages, each with its reason).
 * Screenshots land in tests/e2e/out/ (gitignored). Exit code 1 on any failed check.
 *
 *   node tests/e2e/run.mjs [--port 8150] [--headed] [--url http://host:port/]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt('--port', 8150));
const HEADED = argv.includes('--headed');
const URL = opt('--url', null);

/** Console/page messages that do NOT fail the run. Keep this list empty unless a message was actually observed. */
const ALLOW = [
  // (none observed so far)
];
const allowed = (text) => ALLOW.some((a) => (a instanceof RegExp ? a.test(text) : text.includes(a)));

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the server ----
async function startServer() {
  if (URL) return { url: URL, stop() {} };
  const child = spawn(process.execPath, [path.join(ROOT, 'devshell', 'serve.mjs'), '--port', String(PORT), '--offline'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${PORT}/`;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try { const r = await fetch(url, { method: 'HEAD' }); if (r.status < 500) return { url, stop: () => child.kill(), log: () => log }; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error('server exited: ' + log);
    await sleep(150);
  }
  child.kill();
  throw new Error('server did not start on ' + url + '\n' + log);
}

// ---- the browser ----
function launchOptions() {
  const o = { headless: !HEADED, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  // another Playwright version pinned by a project? The browsers preinstalled here are under /opt/pw-browsers.
  for (const p of ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']) if (fs.existsSync(p) && process.env.E2E_SYSTEM_CHROMIUM) o.executablePath = p;
  return o;
}

/** The iPad Pro 11 (playwright's `devices['iPad Pro 11']`, spelled out so the run does not depend on the device list). */
const IPAD = {
  viewport: { width: 834, height: 1194 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
};

async function main() {
  const { chromium, devices } = require('playwright');
  const server = await startServer();
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ ...(devices['iPad Pro 11'] || {}), ...IPAD });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!allowed(t)) errors.push('console: ' + t); } });
  page.on('pageerror', (e) => { const t = String(e?.message || e); if (!allowed(t)) errors.push('pageerror: ' + t); });
  page.on('requestfailed', (r) => { const t = `${r.url()} ${r.failure()?.errorText || ''}`; if (!allowed(t) && !/favicon/.test(t)) errors.push('request failed: ' + t); });
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') }).catch(() => {});

  try {
    // ---- load ----
    const url = server.url + '?space=model';
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    check('page loads', !!resp && resp.ok(), `${url} → ${resp?.status()}`);
    await page.waitForSelector('canvas[data-over]', { state: 'attached', timeout: 60000 });
    await page.waitForFunction(() => !!window.modelcraft?.view?.renderer && !!window.modelcraft?.model && !!window.modelcraft?.tools, null, { timeout: 60000 });
    await page.waitForTimeout(600);   // the first draw, fonts, the import map's late modules
    await shot('01-loaded');
    check('app globals present (window.modelcraft)', true);
    const canvasBox = await page.locator('canvas[data-over]').boundingBox();
    check('viewport canvas has a size', !!canvasBox && canvasBox.width > 300 && canvasBox.height > 300, canvasBox ? `${Math.round(canvasBox.width)}×${Math.round(canvasBox.height)} css px` : 'no box');

    // ---- GL settings as the app applied them ----
    const gl = await page.evaluate(() => {
      const v = window.modelcraft.view, r = v.renderer, c = r.getContext(), a = c.getContextAttributes();
      return { dpr: window.devicePixelRatio, ratio: r.getPixelRatio(), viewDpr: v.dpr, attrs: { antialias: a.antialias, preserveDrawingBuffer: a.preserveDrawingBuffer, stencil: a.stencil, powerPreference: a.powerPreference }, w: v.w, h: v.h, ua: navigator.userAgent, touch: navigator.maxTouchPoints, over: { w: v.over.width, h: v.over.height } };
    });
    const bigCanvas = gl.w * gl.h > 2_000_000;
    const wantRatio = Math.min(gl.dpr, bigCanvas ? 1.5 : 2);
    check('iPad detected (UA + touch points)', /Macintosh|iPad/.test(gl.ua) && gl.touch > 1, `maxTouchPoints=${gl.touch}`);
    check('renderer pixel ratio capped for iPad', gl.ratio === wantRatio && gl.viewDpr === wantRatio, `canvas ${gl.w}×${gl.h} → ratio ${gl.ratio} (want ${wantRatio})`);
    check('overlay canvas matches the ratio', gl.over.w === Math.round(gl.w * wantRatio) && gl.over.h === Math.round(gl.h * wantRatio), `${gl.over.w}×${gl.over.h}`);
    check('GL: preserveDrawingBuffer + stencil kept', gl.attrs.preserveDrawingBuffer === true && gl.attrs.stencil === true, JSON.stringify(gl.attrs));
    check('GL: antialias on (ratio ≤ 2)', gl.attrs.antialias === true, `antialias=${gl.attrs.antialias}`);
    check('GL: high-performance power preference', gl.attrs.powerPreference === 'high-performance', `powerPreference=${gl.attrs.powerPreference}`);

    // ---- a pen draws a rectangle (trusted pointer events, pointerType 'pen', pressure 0.6) ----
    const cdp = await context.newCDPSession(page);
    const before = await page.evaluate(() => { const d = window.modelcraft.model.root; return { e: d.edges.size, f: d.faces.size, v: window.modelcraft.model.version }; });
    await page.click('[data-tool="rect"]');   // the toolbar (a mouse click: the pen taps buttons the same way)
    const toolIsRect = await page.evaluate(() => window.modelcraft.tools.name);
    check('rectangle tool selected via [data-tool="rect"]', toolIsRect === 'rect', `tools.name=${toolIsRect}`);
    const cx = canvasBox.x + canvasBox.width / 2, cy = canvasBox.y + canvasBox.height * 0.6;
    const pen = async (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, pointerType: 'pen', force: type === 'mouseReleased' ? 0 : 0.6, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
    const penClick = async (x, y) => { await pen('mouseMoved', x, y); await sleep(40); await pen('mousePressed', x, y, { buttons: 1 }); await sleep(60); await pen('mouseReleased', x, y); await sleep(80); };
    // record what the viewport actually received
    await page.evaluate(() => { window.__e2e = { types: [], pressures: [] }; const c = document.querySelector('canvas[data-over]'); for (const t of ['pointerdown', 'pointermove', 'pointerup']) c.addEventListener(t, (e) => { if (t === 'pointerdown') { window.__e2e.types.push(e.pointerType); window.__e2e.pressures.push(e.pressure); } }, true); });
    await penClick(cx - 120, cy - 60);
    for (let i = 1; i <= 6; i++) { await pen('mouseMoved', cx - 120 + i * 40, cy - 60 + i * 20); await sleep(25); }
    await penClick(cx + 120, cy + 60);
    await page.waitForTimeout(300);
    await shot('02-rectangle');
    const after = await page.evaluate(() => { const d = window.modelcraft.model.root; return { e: d.edges.size, f: d.faces.size, v: window.modelcraft.model.version, seen: window.__e2e }; });
    check('pen pointerdown reached the viewport as pointerType pen', after.seen.types.length >= 2 && after.seen.types.every((t) => t === 'pen'), `types=${JSON.stringify(after.seen.types)}`);
    check('pen pressure arrived (0.6)', after.seen.pressures.some((p) => Math.abs(p - 0.6) < 0.05), `pressures=${JSON.stringify(after.seen.pressures.map((p) => +p.toFixed(2)))}`);
    check('rectangle added geometry to the model', after.e >= before.e + 4 && after.f >= before.f + 1, `edges ${before.e}→${after.e}, faces ${before.f}→${after.f}`);

    // ---- two fingers pinch (touch pointer events, two pointerIds) → the camera changes ----
    await page.click('[data-tool="select"]');
    const camSnap = () => page.evaluate(() => { const c = window.modelcraft.cam; const o = {}; for (const k of Object.keys(c)) { const v = c[k]; if (typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number'))) o[k] = v; } return JSON.stringify(o); });
    const cam0 = await camSnap();
    const px0 = await page.evaluate(() => { const c = window.modelcraft.view.gl, g = c.getContext('webgl2') || c.getContext('webgl'); const b = new Uint8Array(4 * 64); g.readPixels((c.width / 2) | 0, (c.height / 2) | 0, 8, 8, g.RGBA, g.UNSIGNED_BYTE, b); return Array.from(b).join(','); });
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: i + 1, radiusX: 8, radiusY: 8, force: 0.5 })) });
    const f1 = [cx - 60, cy], f2 = [cx + 60, cy];
    await touch('touchStart', [f1, f2]);
    await sleep(40);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [[cx - 60 - i * 14, cy - i * 3], [cx + 60 + i * 14, cy + i * 3]]); await sleep(25); }
    await touch('touchEnd', []);
    await page.waitForTimeout(350);
    await shot('03-pinched');
    const cam1 = await camSnap();
    const px1 = await page.evaluate(() => { const c = window.modelcraft.view.gl, g = c.getContext('webgl2') || c.getContext('webgl'); const b = new Uint8Array(4 * 64); g.readPixels((c.width / 2) | 0, (c.height / 2) | 0, 8, 8, g.RGBA, g.UNSIGNED_BYTE, b); return Array.from(b).join(','); });
    const touched = await page.evaluate(() => document.documentElement.classList.contains('is-touch') || document.body.classList.contains('is-touch') || !!document.querySelector('.is-touch'));
    check('two-finger pinch changed the camera', cam1 !== cam0, cam1 === cam0 ? 'camera state identical' : 'camera state differs');
    check('viewport pixels changed after the pinch (or camera did)', px1 !== px0 || cam1 !== cam0);
    check('touch marked the UI (.is-touch)', touched);

    // ---- a finger taps a toolbar button ----
    await page.touchscreen.tap(...(await (async () => { const b = await page.locator('[data-tool="line"]').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; })()));
    await page.waitForTimeout(150);
    const tapped = await page.evaluate(() => ({ name: window.modelcraft.tools.name, pressed: document.querySelector('[data-tool="line"]')?.getAttribute('aria-pressed') }));
    check('touchscreen.tap on [data-tool="line"] selects the Line tool', tapped.name === 'line' && tapped.pressed === 'true', JSON.stringify(tapped));

    // ---- a lost WebGL context comes back ----
    const lost = await page.evaluate(async () => {
      const v = window.modelcraft.view, c = v.renderer.getContext(), ext = c.getExtension('WEBGL_lose_context');
      if (!ext) return { skipped: true };
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 150));
      const flagLost = v.contextLost === true;
      ext.restoreContext();
      await new Promise((r) => setTimeout(r, 400));
      v.invalidate();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { skipped: false, flagLost, flagAfter: v.contextLost, isLost: c.isContextLost() };
    });
    if (lost.skipped) check('webglcontextlost / restored round trip', true, 'skipped: WEBGL_lose_context unavailable');
    else check('webglcontextlost / restored round trip', lost.flagLost && lost.flagAfter === false && !lost.isLost, JSON.stringify(lost));
    await page.waitForTimeout(200);
    await shot('04-restored');

    // ---- dispose() exists and is safe ----
    const disposed = await page.evaluate(() => { const v = window.modelcraft.view; return typeof v.dispose === 'function'; });
    check('View3D.dispose() exists', disposed);
  } catch (e) {
    check('run completed without an exception', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
    await shot('99-exception');
  }

  await page.waitForTimeout(200);
  check('no console errors / pageerrors / failed requests', errors.length === 0, errors.length ? `${errors.length}: ${errors.slice(0, 5).join(' || ').slice(0, 900)}` : '');

  await browser.close().catch(() => {});
  server.stop();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed}/${results.length} checks  (screenshots in ${path.relative(ROOT, OUT)}/)`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
