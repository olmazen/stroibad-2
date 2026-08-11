#!/usr/bin/env node
/**
 * One-time, idempotent repair for already published product pages.
 *
 * - keeps one semantic H1;
 * - replaces cut-off teaser/schema descriptions with the full product copy;
 * - synchronises Product price and image with what is really shown on the page.
 *
 * Usage:
 *   node tools/repair-product-seo.mjs --check
 *   node tools/repair-product-seo.mjs --write
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dev-hero-variants') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, out);
    else if (entry.name === 'index.html') out.push(abs);
  }
  return out;
}

function decodeText(value = '') {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&times;/gi, '×')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value = '') {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function excerpt(value, max = 240) {
  if (value.length <= max) return value;
  const candidate = value.slice(0, max + 1);
  const sentence = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('! '), candidate.lastIndexOf('? '));
  if (sentence >= Math.floor(max * 0.55)) return candidate.slice(0, sentence + 1).trim();
  const word = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, word > 0 ? word : max).replace(/[,:;\-–—\s]+$/, '')}…`;
}

function findFullDescription(html) {
  const prose = html.match(/<div class="prose">([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const first = prose.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '';
  return decodeText(first);
}

function findProductImage(html, file) {
  const gallery = html.match(/<div class="gallery[^\"]*">([\s\S]*?)<div class="pp-info">/i)?.[1] ?? '';
  const sources = [...gallery.matchAll(/<img\b[^>]*\bsrc="([^\"]+)"[^>]*>/gi)].map((m) => m[1].split('?')[0]);
  const chosen = sources.find((src) => /(?:^|\/)white\.(?:webp|jpe?g|png)$/i.test(src))
    || sources.find((src) => /(?:^|\/)hero\.(?:webp|jpe?g|png)$/i.test(src))
    || sources.find((src) => /(?:^|\/)main\.(?:webp|jpe?g|png)$/i.test(src))
    || sources[0];
  if (!chosen || /^(?:https?:)?\/\//i.test(chosen)) return chosen || '';
  const abs = path.resolve(path.dirname(file), chosen);
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  return `https://www.egoe-life.ru/${rel}`;
}

function repairProductJsonLd(html, file, description, price) {
  return html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (whole, raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return whole; }
    if (!data || data['@type'] !== 'Product') return whole;

    if (description) data.description = description;
    const image = findProductImage(html, file);
    if (image) data.image = image;
    else delete data.image;

    if (price != null) {
      data.offers = {
        '@type': 'AggregateOffer',
        priceCurrency: 'RUB',
        lowPrice: String(price),
        availability: 'https://schema.org/PreOrder',
        seller: { '@type': 'Organization', name: 'EGOE' },
      };
    } else {
      // An individually calculated product must not advertise an invented zero price.
      delete data.offers;
    }

    return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  });
}

const stats = { products: 0, changed: 0, h1: 0, descriptions: 0, priced: 0, onRequest: 0, missingImage: [] };
for (const file of await walk(ROOT)) {
  let html = await fs.readFile(file, 'utf8');
  if (!html.includes('class="pp-info"') || !html.includes('class="pp-price"')) continue;
  stats.products++;
  const before = html;

  const infoTitle = /(<div class="pp-info">[\s\S]*?)<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i;
  if (infoTitle.test(html)) {
    html = html.replace(infoTitle, '$1<div class="pp-title">$2</div>');
    stats.h1++;
  }

  const description = findFullDescription(html);
  if (description) {
    const teaser = escapeHtml(excerpt(description));
    html = html.replace(
      /(<div class="page-head"><div class="container">[\s\S]*?<h1[^>]*>[\s\S]*?<\/h1>\s*)<p>[\s\S]*?<\/p>/i,
      `$1<p>${teaser}</p>`,
    );
    stats.descriptions++;
  }

  const priceText = decodeText(html.match(/class="pp-price"[\s\S]*?class="big">([\s\S]*?)<\/span>/i)?.[1] ?? '');
  const digits = priceText.replace(/\D/g, '');
  const price = digits ? Number(digits) : null;
  if (price == null) stats.onRequest++;
  else stats.priced++;

  html = repairProductJsonLd(html, file, description, price);
  if (!findProductImage(html, file)) stats.missingImage.push(path.relative(ROOT, file).split(path.sep).join('/'));

  if (html !== before) {
    stats.changed++;
    if (WRITE) await fs.writeFile(file, html);
  }
}

console.log(JSON.stringify({ mode: WRITE ? 'write' : 'check', ...stats }, null, 2));
if (!WRITE && stats.changed) process.exitCode = 1;
