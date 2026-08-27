import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(rel) {
  return fs.readFile(path.join(ROOT, rel), 'utf8');
}

async function htmlFiles(dir = ROOT) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ['.git', '.private', 'dist', 'node_modules', 'dev-hero-variants', 'dev-photo-reveal', 'dev-series-splits', 'dev-wheel', 'price-edit-ewmllyku9j'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(file);
  }
  return files;
}

test('public HTML uses local fonts and local runtime libraries', async () => {
  const forbidden = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'www.gstatic.com/draco',
    'olmazen.github.io/stroibad-2',
    'formsubmit.co',
    'script.google.com/macros'
  ];
  for (const file of await htmlFiles()) {
    const html = await fs.readFile(file, 'utf8');
    for (const origin of forbidden) {
      assert.ok(!html.includes(origin), `${path.relative(ROOT, file)} still connects the browser to ${origin}`);
    }
  }
  const runtime = await Promise.all([
    read('assets/js/site.js'),
    read('assets/js/leads.js'),
    read('assets/js/kp.js'),
    read('assets/js/ad3d.js'),
    read('assets/js/fw3d.js')
  ]);
  for (const source of runtime) {
    assert.doesNotMatch(source, /formsubmit\.co|script\.google\.com\/macros|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|www\.gstatic\.com\/draco/);
  }

  for (const rel of ['kp/index.html', 'tools/dogovor/index.html']) {
    assert.match(await read(rel), /assets\/css\/fonts\.css/, `${rel} must keep its local font stylesheet`);
  }
  for (const rel of [
    'assets/fonts/LICENSE-Cormorant-Garamond.txt',
    'assets/fonts/LICENSE-JetBrains-Mono.txt',
    'assets/fonts/LICENSE-Oswald.txt',
    'assets/fonts/LICENSE-PT-Sans.txt',
    'assets/fonts/LICENSE-Playfair-Display.txt'
  ]) {
    assert.match(await read(rel), /SIL OPEN FONT LICENSE/, `${rel} must accompany the vendored font files`);
  }
  assert.match(await read('assets/vendor/three/draco/LICENSE.txt'), /Apache License/);
  assert.match(await read('assets/vendor/pdf/LICENSE-pdfjs.txt'), /Apache License/);
  assert.match(await read('assets/vendor/pdf/pdf.min.js'), /pdfjsVersion = 6\.2\.108/);
  assert.match(await read('assets/vendor/pdf/pdf.worker.min.js'), /pdfjsVersion = 6\.2\.108/);
  assert.match(await read('assets/vendor/pdf/jspdf.umd.min.js'), /jsPDF[\s\S]{0,160}Version 4\.2\.1/);
});

test('contacts load maps lazily without a click gate', async () => {
  const html = await read('contacts/index.html');
  assert.equal((html.match(/<iframe\b[^>]+yandex\.ru\/map-widget\/v1\//g) ?? []).length, 2);
  assert.equal((html.match(/<iframe\b[^>]+loading=["']lazy["']/g) ?? []).length, 2);
  assert.doesNotMatch(html, /data-map-src|click-to-load|Загрузить карту|Показать карту/iu);
});

test('MAX is a disabled branded placeholder until its URL is configured', async () => {
  const shell = JSON.parse(await read('src/shared/site-shell.json'));
  const max = shell.topbar.messengers.find((item) => item.label === 'MAX');
  assert.deepEqual(max && { href: max.href, disabled: max.disabled, icon: max.icon }, {
    href: '',
    disabled: true,
    icon: 'max'
  });
  const renderer = await read('tools/site-shell.mjs');
  assert.match(renderer, /messenger-icon-max/);
  assert.match(renderer, /viewBox="0 0 100 100"/);
  assert.match(renderer, /aria-disabled="true"/);
});

test('lead forms require explicit consent and only call the same-origin API', async () => {
  const source = await read('assets/js/leads.js');
  const contract = JSON.parse(await read('config/site-contract.json'));
  assert.match(source, /data-lead-consent/);
  assert.match(source, /CONSENT_REQUIRED/);
  assert.match(source, /\/api\/leads\//);
  assert.match(source, /\/api\/leads\/status\//);
  assert.match(source, /lockAllForms\(\)/);
  assert.equal(contract.leadDelivery.collectionEnabledDefault, false);
  assert.equal(contract.leadDelivery.statusEndpoint, '/api/leads/status/');
  assert.equal(contract.leadDelivery.telegramTransport, 'direct-server-bot-api');
  assert.equal(contract.leadDelivery.telegramDeliveryDefault, 'off-until-separate-server-approval');
  assert.match(source, /credentials:\s*['"]same-origin['"]/);
  assert.doesNotMatch(source, /formsubmit|tgRelay|script\.google\.com/i);
});

test('contract requisites persist only after the explicit save button', async () => {
  const html = await read('tools/dogovor/index.html');
  assert.match(html, /Файл обрабатывается только в этом браузере и не загружается на сервер/);
  assert.match(html, /import\('\.\.\/\.\.\/assets\/vendor\/pdf\/pdf\.min\.js'\)/);
  assert.match(html, /isEvalSupported:false/);
  assert.match(html, /enableScripting:false/);
  assert.match(html, /id="btnSave">Запомнить реквизиты/);
  assert.match(html, /\$\('btnSave'\)\.onclick=\(\)=>\{save\(\)/);
  assert.doesNotMatch(html, /addEventListener\(['"]input['"],\s*save/);
  assert.doesNotMatch(html, /oninput=["'][^"']*save\(/);
  assert.equal((html.match(/\bsave\(\);/g) ?? []).length, 1, 'save() must only run from the explicit save button');
});

test('public legal documents and truthful storage notice are present', async () => {
  for (const rel of ['privacy/index.html', 'consent/index.html', 'cookies/index.html']) {
    const html = await read(rel);
    assert.match(html, /САМШИТ»/);
    assert.match(html, /1146439002863/);
    assert.match(html, /6439086125/);
  }
  const runtime = await read('assets/js/site.js');
  assert.match(runtime, /href\*="cookies"/);
  assert.match(runtime, /egoe_cookie_notice_v2/);
  assert.doesNotMatch(runtime, /Продолжая пользоваться сайтом, вы соглашаетесь/);
  assert.match(await read('robots.txt'), /Disallow: \/stroibad-2\//);
});
