#!/usr/bin/env node
// Собирает единый каталог из опубликованных товарных страниц.
// Источник правды — сами HTML-страницы (все категории единообразно, включая инлайн-чертежи),
// т.к. внешний CSV-корень неполон и не содержит чертежей.
//
// Выход:
//   assets/catalog.json          — массив товаров (sku, name, price, specs, images, ral, ...)
//   assets/drawings/<sku>.svg     — вынесенные векторные чертежи (у кого есть)
//
// Запуск: node tools/build-catalog.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRAWINGS_DIR = join(ROOT, 'assets', 'drawings');

// Категории, где живут товарные страницы (catdir/<slug>/index.html)
const CATEGORY_ROOTS = ['maf', 'metallokonstrukcii', 'ograzhdeniya'];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'index.html') out.push(p);
  }
  return out;
}

function collectProductPages() {
  const pages = [];
  for (const root of CATEGORY_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const f of walk(abs)) {
      const html = readFileSync(f, 'utf8');
      if (html.includes('class="pp-price"')) pages.push({ file: f, html });
    }
  }
  return pages;
}

// --- утилиты извлечения ---------------------------------------------------

const stripTags = (s) => s.replace(/<[^>]*>/g, '').trim();
const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–').replace(/&times;/g, '×').trim();
const clean = (s) => decode(stripTags(s)).replace(/\s+/g, ' ').trim();

function firstMatch(re, html) {
  const m = html.match(re);
  return m ? m[1] : null;
}

function parseJsonLdProduct(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const b of blocks) {
    try {
      const obj = JSON.parse(b[1]);
      if (obj && obj['@type'] === 'Product') return obj;
    } catch { /* ignore malformed */ }
  }
  return null;
}

function parsePrice(html) {
  const raw = firstMatch(/class="pp-price"[\s\S]*?class="big">([\s\S]*?)<\/span>/, html);
  const text = raw ? clean(raw) : null;
  if (!text) return { text: null, kind: 'unknown', value: null };
  const digits = text.replace(/[^\d]/g, '');
  const value = digits ? Number(digits) : null;
  const kind = value ? 'from' : 'onrequest'; // "от 32 700 ₽" → from; "Под заказ" → onrequest
  return { text, kind, value };
}

function parseSpecs(html) {
  const table = firstMatch(/<table class="specs">([\s\S]*?)<\/table>/, html);
  if (!table) return [];
  return [...table.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)]
    .map((m) => [clean(m[1]), clean(m[2])])
    .filter(([k, v]) => k && v);
}

function parseRal(html) {
  const ralBlock = firstMatch(/<div class="ral">([\s\S]*?)<\/div>/, html);
  if (!ralBlock) return [];
  return [...ralBlock.matchAll(/data-ral="([^"]*)"[^>]*title="([^"]*)"/g)]
    .map((m) => ({ hex: m[1], name: clean(m[2]) }));
}

function parseImages(html, pageDir) {
  const gallery = firstMatch(/<div class="gallery[^"]*">([\s\S]*?)<div class="pp-info"/, html);
  if (!gallery) return [];
  const imgs = [...gallery.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  const labels = [...gallery.matchAll(/class="ph-label">([^<]*)</g)].map((m) => clean(m[1]));
  return imgs.map((src, i) => {
    // src относительна странице → приводим к корню сайта
    const absImg = resolve(pageDir, src);
    const rel = relative(ROOT, absImg).split('\\').join('/');
    const kind = /main\.|hero\./.test(src) ? 'main'
      : /closeup\.|facade2\./.test(src) ? 'closeup'
      : /white\./.test(src) ? 'white'
      : /angle\.|facade1\./.test(src) ? 'angle' : 'other';
    return { path: rel, kind, label: labels[i] || '', exists: existsSync(absImg) };
  });
}

function parseDrawing(html) {
  // Реальный чертёж — <svg> внутри div class="ad-draw-holder" (не CSS-упоминание в <style>).
  const svg = firstMatch(/class="ad-draw-holder"[\s\S]*?(<svg[\s\S]*?<\/svg>)/, html);
  return svg || null;
}

function parseDescription(html, jsonld) {
  // Полное описание — первый <p> в блоке .prose (раздел «Описание»)
  const prose = firstMatch(/<div class="prose">([\s\S]*?)<\/div>/, html);
  if (prose) {
    const p = firstMatch(/<p>([\s\S]*?)<\/p>/, prose);
    if (p && clean(p)) return clean(p);
  }
  // запасной вариант — hero <p> или JSON-LD description
  return jsonld?.description ? clean(jsonld.description) : null;
}

// --- основной проход ------------------------------------------------------

function build() {
  const pages = collectProductPages();
  const products = [];
  const report = { total: pages.length, withPrice: 0, onRequest: 0, withDrawing: 0, missingSku: [], missingImages: [], byCategory: {} };

  if (!existsSync(DRAWINGS_DIR)) mkdirSync(DRAWINGS_DIR, { recursive: true });

  for (const { file, html } of pages) {
    const pageDir = dirname(file);
    const url = relative(ROOT, pageDir).split('\\').join('/') + '/';
    const jsonld = parseJsonLdProduct(html);

    const sku = clean(firstMatch(/class="pp-art">\s*Артикул\s+(?:<b>)?([^<·]+)/, html) || '');
    const slug = url.split('/').filter(Boolean).pop();
    const name = clean(jsonld?.name || firstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/, html) || '');
    const productType = clean(firstMatch(/class="pp-art">[\s\S]*?·\s*([^<]*)</, html) || '');
    const price = parsePrice(html);
    const specs = parseSpecs(html);
    const ral = parseRal(html);
    const images = parseImages(html, pageDir);
    const description = parseDescription(html, jsonld);
    const category = clean(jsonld?.category || '');
    const catKey = url.split('/').slice(0, -2).join('/'); // maf/skamejki

    const drawingSvg = parseDrawing(html);
    let drawing = null;
    if (drawingSvg) {
      const fname = `${(sku || slug).replace(/[^A-Za-z0-9_-]/g, '_')}.svg`;
      writeFileSync(join(DRAWINGS_DIR, fname), drawingSvg);
      drawing = `assets/drawings/${fname}`;
      report.withDrawing++;
    }

    if (!sku) report.missingSku.push(url);
    if (!images.length) report.missingImages.push(url);
    if (price.kind === 'from') report.withPrice++;
    if (price.kind === 'onrequest') report.onRequest++;
    report.byCategory[catKey] = (report.byCategory[catKey] || 0) + 1;

    products.push({
      sku, name, productType, url, category, catKey,
      description,
      price: { text: price.text, from: price.value, kind: price.kind },
      specs, ral, images: images.map(({ path, kind, label }) => ({ path, kind, label })),
      drawing,
    });
  }

  products.sort((a, b) => (a.catKey + a.name).localeCompare(b.catKey + b.name, 'ru'));
  writeFileSync(join(ROOT, 'assets', 'catalog.json'), JSON.stringify(products, null, 1));

  // отчёт
  console.log(`Товаров: ${report.total}`);
  console.log(`  с ценой «от»: ${report.withPrice}`);
  console.log(`  «Под заказ»:  ${report.onRequest}`);
  console.log(`  с чертежом:   ${report.withDrawing}`);
  console.log(`  без sku:      ${report.missingSku.length}${report.missingSku.length ? ' → ' + report.missingSku.slice(0, 5).join(', ') : ''}`);
  console.log(`  без фото:     ${report.missingImages.length}${report.missingImages.length ? ' → ' + report.missingImages.slice(0, 5).join(', ') : ''}`);
  console.log('По категориям:');
  for (const [k, n] of Object.entries(report.byCategory).sort()) console.log(`  ${k}: ${n}`);
  console.log(`\nЗаписано: assets/catalog.json (${products.length}), assets/drawings/*.svg (${report.withDrawing})`);
}

build();
