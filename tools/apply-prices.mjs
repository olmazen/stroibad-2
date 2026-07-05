#!/usr/bin/env node
// Применяет заполненный владельцем файл egoe-prices.json ко всему сайту:
//  1) страницы товаров (pp-price, meta description, schema.org lowPrice)
//  2) карточки в категориях и прочих страницах, где товар упомянут ссылкой
//  3) канонический реестр assets/data/prices.json
//  4) исходные products.csv генератора (hobbyka-export), чтобы перегенерация не откатила цены
// Запуск: node tools/apply-prices.mjs <egoe-prices.json> [--dry]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SOURCE_ROOT = process.env.EGOE_SOURCE_ROOT || '/Users/almazrafikov/Documents/Codex/2026-06-15/files-mentioned-by-the-user-view/outputs/hobbyka-export/site-nomenclature';
const CSV_SOURCE = {
  'maf/skamejki': 'skameyki',
  'maf/lezhaki': 'lezhaki_dlya_plyazha_i_dachi',
  'maf/pavilony-i-navesy': 'pavilony_i_navesy',
  'maf/urny': 'urny',
  'metallokonstrukcii/konteynernye-ploshchadki': 'konteynernye_ploshchadki_dlya_tbo',
  'maf/veloparkovki': 'velosipednye_parkovki',
};

const [, , fileArg, ...flags] = process.argv;
const DRY = flags.includes('--dry');
if (!fileArg) { console.error('нужен путь к egoe-prices.json'); process.exit(1); }

const data = JSON.parse(fs.readFileSync(fileArg, 'utf8'));
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/prices.json'), 'utf8'));
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const stats = { pages: 0, repl: 0, csvRows: 0, skipped: 0, warn: [] };
const touched = new Map(); // file -> content
const readF = (f) => touched.get(f) ?? fs.readFileSync(f, 'utf8');
const writeF = (f, s) => touched.set(f, s);

// все html сайта — для карточек вне категории (главная и т.п.)
const allHtml = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'tools') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) allHtml.push(p);
  }
})(ROOT);

function replaceNearLink(file, slug, from, to) {
  let s = readF(file); let n = 0;
  const linkRe = new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(index\\.html)?"', 'g');
  let m;
  while ((m = linkRe.exec(s))) {
    const start = m.index;
    let win = s.slice(start, start + 2400);
    const close = win.indexOf('</a>'); // карточка/плитка товара заканчивается </a>
    if (close >= 0) win = win.slice(0, close);
    if (win.includes(from)) {
      const rep = win.replace(from, to); // только первое совпадение внутри своей карточки
      n += 1;
      s = s.slice(0, start) + rep + s.slice(start + win.length);
    }
  }
  if (n) writeF(file, s);
  return n;
}

for (const it of data.items) {
  if (!it.filled) { stats.skipped++; continue; }
  const regItem = reg.items.find((r) => r.cat === it.cat && r.slug === it.slug);
  if (!regItem) { stats.warn.push('нет в реестре: ' + it.cat + '/' + it.slug); continue; }
  const page = path.join(ROOT, it.cat, it.slug, 'index.html');

  if (it.underOrder) { // осталось/стало «под заказ»
    regItem.price = null; regItem.underOrder = true;
    if (it.note) regItem.note = it.note;
    continue;
  }
  if (it.newPrice == null) { stats.skipped++; continue; }

  const oldTxt = it.oldPrice != null ? 'от ' + fmt(it.oldPrice) + ' ₽' : null;
  const newTxt = 'от ' + fmt(it.newPrice) + ' ₽';

  if (it.oldPrice != null && it.newPrice !== it.oldPrice) {
    // страница товара: все вхождения старой цены + schema lowPrice
    let s = readF(page); let n = 0;
    n += (s.match(new RegExp(oldTxt.replace(/ /g, '[\\s\\u00a0]'), 'g')) || []).length;
    s = s.replace(new RegExp('от[\\s\\u00a0]' + fmt(it.oldPrice).replace(/ /g, '[\\s\\u00a0]') + '[\\s\\u00a0]₽', 'g'), newTxt);
    s = s.replace(new RegExp('"lowPrice":"' + it.oldPrice + '"', 'g'), '"lowPrice":"' + it.newPrice + '"');
    if (n) { writeF(page, s); stats.pages++; stats.repl += n; }
    // карточки на остальных страницах
    for (const f of allHtml) {
      if (f === page) continue;
      const nn = replaceNearLink(f, it.slug, oldTxt, newTxt);
      if (nn) { stats.pages++; stats.repl += nn; }
    }
  } else if (it.oldPrice == null) {
    // был «под заказ» (Art Déco) → появилась цена
    let s = readF(page);
    const before = s;
    s = s.replace('<span class="big">Под заказ</span>', '<span class="big">' + newTxt + '</span>');
    if (s !== before) { writeF(page, s); stats.pages++; stats.repl++; }
    else stats.warn.push('не нашёл «Под заказ» на ' + it.cat + '/' + it.slug);
    for (const f of allHtml) {
      if (f === page) continue;
      const nn = replaceNearLink(f, it.slug, '<b>под заказ</b>', '<b>' + newTxt + '</b>');
      if (nn) { stats.pages++; stats.repl += nn; }
    }
  }

  regItem.price = it.newPrice; regItem.underOrder = false;
  if (it.note) regItem.note = it.note;

  // products.csv генератора (только стандарт — Art Déco в hobbyka-выгрузке нет)
  if (it.group === 'standard' && CSV_SOURCE[it.cat] && it.newPrice !== it.oldPrice) {
    const csvFile = path.join(SOURCE_ROOT, CSV_SOURCE[it.cat], 'products.csv');
    if (fs.existsSync(csvFile)) {
      let csv = readF(csvFile);
      const lines = csv.split('\n');
      const hdr = lines[0].split(';');
      const priceIdx = hdr.findIndex((h) => /price|цена/i.test(h));
      const skuIdx = hdr.findIndex((h) => /article|sku|артикул/i.test(h));
      if (priceIdx >= 0 && skuIdx >= 0) {
        let hit = false;
        for (let i = 1; i < lines.length; i++) {
          const cells = lines[i].split(';');
          if ((cells[skuIdx] || '').replace(/"/g, '').trim() === String(it.sku)) {
            cells[priceIdx] = String(it.newPrice); lines[i] = cells.join(';'); hit = true; stats.csvRows++;
          }
        }
        if (hit) writeF(csvFile, lines.join('\n'));
        else stats.warn.push('csv: артикул ' + it.sku + ' не найден в ' + CSV_SOURCE[it.cat]);
      } else stats.warn.push('csv: не нашёл колонки price/sku в ' + CSV_SOURCE[it.cat]);
    }
  }
}

if (!DRY) {
  for (const [f, s] of touched) fs.writeFileSync(f, s);
  reg.updated = data.exportedAt || null;
  fs.writeFileSync(path.join(ROOT, 'assets/data/prices.json'), JSON.stringify(reg, null, 1));
}
console.log((DRY ? '[DRY RUN] ' : '') + 'страниц изменено:', new Set([...touched.keys()]).size, '| замен:', stats.repl, '| csv-строк:', stats.csvRows, '| пропущено (не заполнено):', stats.skipped);
if (stats.warn.length) console.log('ПРЕДУПРЕЖДЕНИЯ:\n - ' + stats.warn.join('\n - '));
