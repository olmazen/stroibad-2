import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FOOTER_END,
  FOOTER_START,
  HEADER_END,
  HEADER_START,
  loadSiteShellData,
  publicHref,
  renderSiteFooter,
  renderSiteHeader,
  rootPrefixFor
} from './site-shell.mjs';
import { assertSyncedStructure, renderUpdatedHtml } from './sync-site-shell.mjs';

const data = await loadSiteShellData();

test('root prefix is derived from the public page depth', () => {
  assert.equal(rootPrefixFor('index.html'), '');
  assert.equal(rootPrefixFor('about/index.html'), '../');
  assert.equal(rootPrefixFor('maf/skamejki/index.html'), '../../');
  assert.equal(rootPrefixFor('maf/skamejki/example/index.html'), '../../../');
  assert.equal(publicHref('maf/skamejki/example/index.html', 'contacts/'), '../../../contacts/');
  assert.equal(publicHref('maf/skamejki/example/index.html', '/contacts/'), '../../../contacts/');
  assert.equal(publicHref('index.html', 'contacts/'), 'contacts/');
  assert.equal(publicHref('index.html', 'tel:+79272295828'), 'tel:+79272295828');
  assert.throws(() => publicHref('index.html', '../private/'), /escapes the public root/);
  assert.throws(() => publicHref('index.html', 'javascript:alert(1)'), /Unsupported site shell URL protocol/);
});

test('header renderer emits one canonical four-item dropdown', () => {
  const html = renderSiteHeader(data, 'maf/skamejki/example/index.html');
  assert.equal(html.split(HEADER_START).length - 1, 1);
  assert.equal(html.split(HEADER_END).length - 1, 1);
  assert.equal((html.match(/class="navitem"/g) ?? []).length, 1);
  assert.equal((html.match(/<a class="dd-item"/g) ?? []).length, 4);
  assert.match(html, /<b>Почтовые ящики<\/b>/);
  assert.doesNotMatch(html, /<b>Контейнерные площадки<\/b>/);
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/contacts\/"/);
  assert.match(html, /class="messenger-link is-disabled"[^>]+>.*MAX/s);
  assert.match(html, /<button class="burger" type="button" aria-label="Открыть меню" aria-controls="mnav" aria-expanded="false"/);
});

test('footer renderer preserves canonical order and depth-aware links', () => {
  const html = renderSiteFooter(data, 'about/index.html');
  assert.equal(html.split(FOOTER_START).length - 1, 1);
  assert.equal(html.split(FOOTER_END).length - 1, 1);
  assert.ok(html.indexOf('14 лет') < html.indexOf('800+ объектов'));
  assert.ok(html.indexOf('800+ объектов') < html.indexOf('44-ФЗ · НДС'));
  assert.match(html, /href="\.\.\/privacy\/"/);
  assert.match(html, /href="\.\.\/consent\/"/);
  assert.match(html, /href="\.\.\/cookies\/"/);
  assert.match(html, /Ссылка на MAX появится позже/);
  assert.match(html, /Контейнерные площадки/);
});

test('shell data is loaded from the explicitly targeted worktree', async (context) => {
  const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-shell-target-'));
  context.after(() => fs.rm(targetRoot, { recursive: true, force: true }));
  const targetData = structuredClone(data);
  targetData.brand.name = 'TARGET-WORKTREE';
  const targetDir = path.join(targetRoot, 'src', 'shared');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'site-shell.json'), `${JSON.stringify(targetData, null, 2)}\n`);
  const loaded = await loadSiteShellData(targetRoot);
  assert.equal(loaded.brand.name, 'TARGET-WORKTREE');
});

const legacyHeader = `<div class="topbar"><div class="container">legacy topbar</div></div>
<header id="siteHeader"><div class="container hdr">
  <a class="logo" href="../">Legacy</a>
  <nav class="main" id="nav"><div class="navitem"><a href="../catalog/">Каталог</a><div class="dropdown"></div></div></nav>
</div></header>`;

const legacyFooter = `<footer><div class="container">
  <div class="foot-grid">legacy footer</div>
  <div class="foot-bot">legacy legal</div>
</div></footer>`;

test('legacy page migration preserves body bytes and is idempotent', () => {
  const pageRel = 'about/index.html';
  const body = '<main><section><p id="body-sentinel">BODY MUST STAY BYTE-EXACT</p></section></main>';
  const original = `<!doctype html><body>${legacyHeader}\n${body}\n${legacyFooter}\n<script src="../assets/js/site.js"></script></body>`;
  const migrated = renderUpdatedHtml(original, pageRel, data);
  assert.match(migrated, /BODY MUST STAY BYTE-EXACT/);
  assert.ok(migrated.includes(`\n${body}\n`));
  assertSyncedStructure(migrated, pageRel);
  assert.equal(renderUpdatedHtml(migrated, pageRel, data), migrated);
  assert.throws(
    () => renderUpdatedHtml(migrated.replace(HEADER_START, `${HEADER_START}${HEADER_START}`), pageRel, data),
    /expected exactly one header marker pair/
  );
});

test('cart migration replaces only the common footer', () => {
  const pageRel = 'cart/index.html';
  const drawer = '<div class="kpdrawer"><header class="kpd-head">KP</header><footer class="kpd-foot">KEEP INNER FOOTER</footer></div>';
  const original = `<!doctype html><body>${legacyHeader}\n<section>Cart</section>\n${legacyFooter}\n${drawer}\n<script src="../assets/js/site.js"></script></body>`;
  const migrated = renderUpdatedHtml(original, pageRel, data);
  assert.equal(migrated.split(drawer).length - 1, 1);
  assert.match(migrated, /<footer class="kpd-foot">KEEP INNER FOOTER<\/footer>/);
  assertSyncedStructure(migrated, pageRel, new Set([pageRel]));
  assert.equal(renderUpdatedHtml(migrated, pageRel, data), migrated);
});

test('broken swing migration preserves related products and restores missing closures', () => {
  const pageRel = 'maf/kacheli/example/index.html';
  const original = `<!doctype html><body>${legacyHeader}
<main>
<section><div>Product body</div></section>
<section style="padding-top:0">
  <div class="container">
    <div class="sec-head">Другие модели качелей</div>
    <div class="tiles3"><a class="tile">RELATED PRODUCTS MUST STAY</a></div>
      </div>
      <div><div class="foot-col-h">Продукция</div>ORPHAN FOOTER</div>
    </div><div class="foot-bot">legacy legal</div></div>
</footer>
<script src="../../../assets/js/site.js"></script></body>`;
  const repairPages = new Set([pageRel]);
  const migrated = renderUpdatedHtml(original, pageRel, data, repairPages);
  assert.match(migrated, /RELATED PRODUCTS MUST STAY/);
  assert.doesNotMatch(migrated, /ORPHAN FOOTER/);
  assert.equal((migrated.match(/<section(?:\s[^>]*)?>/g) ?? []).length, 2);
  assert.equal((migrated.match(/<\/section>/g) ?? []).length, 2);
  assertSyncedStructure(migrated, pageRel);
  assert.equal(renderUpdatedHtml(migrated, pageRel, data, repairPages), migrated);
});
