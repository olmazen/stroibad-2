import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { applyRevision } from './sync-runtime-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = JSON.parse(await fs.readFile(path.join(ROOT, 'config/site-contract.json'), 'utf8'));
const RUNTIME = CONTRACT.runtime;

async function walkHtml(dir = ROOT, rel = '') {
  const skipped = new Set(['.git', '.private', 'dist', 'node_modules']);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && skipped.has(entry.name)) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkHtml(child, childRel));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(childRel);
  }
  return files.sort();
}

function scriptIndex(html, script) {
  return html.search(new RegExp(`<script\\b[^>]*src=["'][^"']*${script.replaceAll('.', '\\.')}[^"']*["'][^>]*>`, 'i'));
}

test('runtime guard isolates initializers, reports errors, and bounds its journal', async () => {
  const source = await fs.readFile(path.join(ROOT, RUNTIME.script), 'utf8');
  const firstFeature = source.indexOf("window.EGOE_RUNTIME.run('core-actions'");
  assert.ok(firstFeature > 0, 'runtime bootstrap must precede the first feature');

  const events = [];
  class FakeCustomEvent {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
  }
  const browserWindow = {
    CustomEvent: FakeCustomEvent,
    dispatchEvent(event) { events.push(event); }
  };
  const context = {
    window: browserWindow,
    console: { error() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Error,
    Date
  };
  vm.runInNewContext(source.slice(0, firstFeature), context, { filename: RUNTIME.script });

  const runtime = browserWindow.EGOE_RUNTIME;
  assert.ok(runtime, 'runtime API was not installed');
  let healthyRan = false;
  runtime.run('broken-feature', () => { throw new Error('boom'); });
  runtime.run('healthy-feature', () => { healthyRan = true; });
  assert.equal(healthyRan, true, 'a failed feature blocked the next feature');
  assert.equal(events.at(-1)?.type, 'egoe:runtime-error');
  assert.equal(events.at(-1)?.detail.feature, 'broken-feature');
  runtime.run('async-broken-feature', () => Promise.reject(new Error('async boom')));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.at(-1)?.detail.feature, 'async-broken-feature');
  assert.equal(runtime.value('broken-value', () => { throw new Error('no value'); }, 'fallback'), 'fallback');

  for (let index = 0; index < RUNTIME.maxFailureEntries + 5; index += 1) {
    runtime.report(`failure-${index}`, new Error('expected test failure'));
  }
  assert.equal(runtime.failures().length, RUNTIME.maxFailureEntries);

  assert.equal(await runtime.withTimeout(Promise.resolve('ok'), 50, 'fast operation'), 'ok');
  await assert.rejects(
    runtime.withTimeout(new Promise(() => {}), 5, 'slow operation'),
    (error) => error?.code === 'EGOE_TIMEOUT'
  );
});

test('every top-level site feature is named and guarded exactly once', async () => {
  const source = await fs.readFile(path.join(ROOT, RUNTIME.script), 'utf8');
  const actual = [...source.matchAll(/window\.EGOE_RUNTIME\.(?:run|value)\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(actual, RUNTIME.features);
  assert.equal(new Set(actual).size, actual.length, 'runtime feature names must be unique');
  assert.equal((source.match(/^\(function \(\) \{/gm) ?? []).length, 0, 'unguarded top-level IIFE found');
});

test('asset revision sync only changes real href/src attributes', () => {
  const original = '<div data-src="assets/js/site.js?v=legacy"></div>\n<script src="assets/js/site.js?v=old"></script>';
  const result = applyRevision(original, 'assets/js/site.js', 'abc123');
  assert.equal(result.matches, 1);
  assert.equal(
    result.updated,
    '<div data-src="assets/js/site.js?v=legacy"></div>\n<script src="assets/js/site.js?v=abc123"></script>'
  );
});

test('Art Déco late load failure does not reopen 3D after Draw was selected', async () => {
  class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
    toggle(name, force) {
      const next = force === undefined ? !this.contains(name) : Boolean(force);
      if (next) this.add(name); else this.remove(name);
      return next;
    }
  }
  class FakeElement {
    constructor(tagName = 'DIV') {
      this.tagName = tagName;
      this.classList = new FakeClassList();
      this.children = [];
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {};
      this.parentNode = null;
      this.textContent = '';
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    insertBefore(child) { return this.appendChild(child); }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    closest(selector) { return selector === 'button' && this.tagName === 'BUTTON' ? this : null; }
    getContext() {
      return {
        setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}
      };
    }
  }

  const plate = new FakeElement();
  const toggle = new FakeElement();
  const view3d = new FakeElement();
  const load = new FakeElement();
  const drawButton = new FakeElement('BUTTON');
  const threeButton = new FakeElement('BUTTON');
  plate.setAttribute('data-glb', 'model.glb');
  drawButton.setAttribute('data-view', 'draw');
  threeButton.setAttribute('data-view', '3d');
  view3d.appendChild(load);
  plate.querySelector = (selector) => selector === '.ad-3d' ? view3d : null;
  view3d.querySelector = (selector) => selector === '.ad-3d-load' ? load : null;
  toggle.querySelectorAll = (selector) => selector === 'button' ? [drawButton, threeButton] : [];
  const document = {
    querySelector(selector) {
      if (selector === '.ad-plate[data-glb]') return plate;
      if (selector === '.ad-viewtoggle') return toggle;
      return null;
    },
    createElement(tagName) { return new FakeElement(tagName.toUpperCase()); }
  };
  const reported = [];
  const browserWindow = { EGOE_RUNTIME: { report(name) { reported.push(name); } } };
  const adSource = await fs.readFile(path.join(ROOT, RUNTIME.threeD.artDecoScript), 'utf8');
  vm.runInNewContext(adSource, {
    window: browserWindow,
    document,
    console: { error() {} },
    Promise,
    Error,
    Array,
    Math,
    performance: { now: () => 0 },
    devicePixelRatio: 1,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout
  }, {
    filename: RUNTIME.threeD.artDecoScript,
    importModuleDynamically: async () => { throw new Error('simulated module failure'); }
  });

  toggle.listeners.get('click')({ target: threeButton });
  toggle.listeners.get('click')({ target: drawButton });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(plate.classList.contains('is3d'), false);
  assert.equal(view3d.classList.contains('failed'), true);
  assert.equal(view3d.classList.contains('show'), false);
  assert.equal(view3d.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(reported, ['artdeco-3d']);
});

test('3D integrations have bounded loading and a static local fallback', async () => {
  const adSource = await fs.readFile(path.join(ROOT, RUNTIME.threeD.artDecoScript), 'utf8');
  const fwSource = await fs.readFile(path.join(ROOT, RUNTIME.threeD.orderWheelScript), 'utf8');
  const css = await fs.readFile(path.join(ROOT, 'assets/css/style.css'), 'utf8');

  for (const source of [adSource, fwSource]) {
    assert.match(source, new RegExp(`MODULE_TIMEOUT_MS\\s*=\\s*${RUNTIME.threeD.moduleTimeoutMs}`));
    assert.match(source, new RegExp(`MODEL_TIMEOUT_MS\\s*=\\s*${RUNTIME.threeD.modelTimeoutMs}`));
    assert.match(source, /EGOE_TIMEOUT/);
  }
  assert.ok(adSource.includes(RUNTIME.threeD.fallbackText));
  assert.ok(css.includes(RUNTIME.threeD.fallbackText));
  assert.match(css, /\.fw-pp-3d-stage\.fw3d-fb \.fw-pp-3dimg[^\n]*animation:none!important/);
  assert.match(adSource, /var active = plate\.classList\.contains\('is3d'\)/);
  assert.match(adSource, /v3d\.classList\.toggle\('show', active\)/);
  assert.match(adSource, /running = plate\.classList\.contains\('is3d'\)/);
  assert.match(adSource, /resume:[^\n]+v3d\.classList\.contains\('ready'\)/);

  const htmlFiles = await walkHtml();
  const pages = await Promise.all(htmlFiles.map(async (rel) => ({
    rel,
    html: await fs.readFile(path.join(ROOT, rel), 'utf8')
  })));
  const artDecoPages = pages.filter(({ html }) => html.includes('assets/js/ad3d.js'));
  const orderWheelPages = pages.filter(({ html }) => html.includes('assets/js/fw3d.js'));
  assert.equal(artDecoPages.length, RUNTIME.threeD.artDecoPages);
  assert.equal(orderWheelPages.length, RUNTIME.threeD.orderWheelPages);

  for (const { rel, html } of artDecoPages) {
    const siteAt = scriptIndex(html, 'site.js');
    const adAt = scriptIndex(html, 'ad3d.js');
    assert.ok(siteAt >= 0 && adAt > siteAt, `${rel}: site.js must initialize the runtime before ad3d.js`);
    assert.match(html, /<script\s+type=["']importmap["']>/i, `${rel}: Three.js importmap is missing`);
    const glbMatch = html.match(/\bdata-glb=["']([^"']+)["']/i);
    assert.ok(glbMatch, `${rel}: data-glb is missing`);
    const cleanGlb = glbMatch[1].split(/[?#]/)[0];
    const absoluteGlb = path.resolve(path.dirname(path.join(ROOT, rel)), cleanGlb);
    assert.ok(absoluteGlb.startsWith(`${ROOT}${path.sep}`), `${rel}: data-glb escapes the repository`);
    await fs.access(absoluteGlb);
  }

  const wheel = orderWheelPages[0];
  assert.equal(wheel.rel, 'index.html');
  assert.match(wheel.html, /<script\b[^>]*src=["'][^"']*assets\/js\/fw3d\.js[^"']*["'][^>]*\bdefer\b[^>]*>/i);
  assert.ok(scriptIndex(wheel.html, 'site.js') > scriptIndex(wheel.html, 'fw3d.js'));
});
