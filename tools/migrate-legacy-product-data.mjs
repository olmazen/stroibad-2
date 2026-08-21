#!/usr/bin/env node

// One-time importer for the P2 migration. It reconciles the three legacy JSON
// collections and product-page metadata into src/data/products.json. It is not
// part of the normal build: after migration, the canonical source owns data.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeJson, validateProductSource } from './product-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/products.json');

const CATEGORY_LABELS = new Map([
  ['maf/skamejki', 'Скамейки'],
  ['maf/kacheli', 'Качели'],
  ['maf/urny', 'Урны'],
  ['maf/lezhaki', 'Лежаки'],
  ['maf/veloparkovki', 'Велопарковки'],
  ['maf/pavilony-i-navesy', 'Павильоны и навесы'],
  ['maf/parkovochnye-stolbiki', 'Парковочные столбики'],
  ['metallokonstrukcii/korziny-dlya-konditsionerov', 'Корзины для кондиционеров'],
  ['metallokonstrukcii/konteynernye-ploshchadki', 'Контейнерные площадки'],
  ['metallokonstrukcii/pochtovye-yashchiki', 'Почтовые ящики и постаматы'],
  ['ograzhdeniya', 'Ограждения'],
]);

function stripKnownOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['www.egoe-life.ru', 'egoe-life.ru', 'olmazen.github.io'].includes(url.hostname)) return '';
    const pathname = url.pathname.replace(/^\/stroibad-2\//, '/');
    return pathname.replace(/^\//, '').replace(/[?#].*$/, '');
  } catch {
    return value.replace(/^\.\//, '').replace(/^\//, '').replace(/[?#].*$/, '');
  }
}

async function exists(rel) {
  if (!rel) return false;
  try {
    await fs.access(path.join(ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

async function pageMetadata(route) {
  const html = await fs.readFile(path.join(ROOT, route, 'index.html'), 'utf8');
  const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  return { ogImage: stripKnownOrigin(match?.[1] ?? '') };
}

function usefulLegacyKeywords(value) {
  const text = String(value ?? '').trim();
  return text && !/^(?:b|span|td)$/i.test(text) ? text : '';
}

function normalizeKeywordText(value) {
  const seen = new Set();
  return String(value).split(/\s+/).filter((token) => {
    const key = token.toLocaleLowerCase('ru');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' ');
}

function searchCategory(product) {
  if (product.category.startsWith('Малые архитектурные формы')) return 'МАФ';
  if (product.category.startsWith('Металлоконструкции')) return 'Металлоконструкции';
  if (product.category.startsWith('Ограждения')) return 'Ограждения';
  return product.category.split('/')[0].trim();
}

async function chooseImage(candidates, route) {
  for (const raw of candidates) {
    const candidate = stripKnownOrigin(raw);
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`No existing search image for ${route}; candidates: ${candidates.join(', ')}`);
}

async function main() {
  try {
    await fs.access(OUT);
    if (!process.argv.includes('--force')) {
      throw new Error('Canonical product source already exists; use --force only for an intentional re-import');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const catalog = JSON.parse(await fs.readFile(path.join(ROOT, 'assets/catalog.json'), 'utf8'));
  const search = JSON.parse(await fs.readFile(path.join(ROOT, 'assets/products.json'), 'utf8'));
  const prices = JSON.parse(await fs.readFile(path.join(ROOT, 'assets/data/prices.json'), 'utf8')).items;
  const bySearchUrl = new Map(search.map((item) => [item.u, item]));
  const byPriceUrl = new Map(prices.map((item) => [item.url, item]));
  const productUrls = new Set(catalog.map((item) => item.url));

  const products = [];
  for (const legacy of catalog) {
    const oldSearch = bySearchUrl.get(legacy.url);
    const oldPrice = byPriceUrl.get(legacy.url);
    const page = await pageMetadata(legacy.url);
    const searchImage = await chooseImage([
      oldSearch?.i,
      legacy.images[0]?.path,
      page.ogImage,
    ], legacy.url);
    const keywordParts = [
      legacy.sku,
      legacy.productType,
      usefulLegacyKeywords(oldSearch?.k),
    ].filter(Boolean);
    products.push({
      sku: legacy.sku,
      name: legacy.name,
      productType: legacy.productType,
      url: legacy.url,
      category: legacy.category,
      catKey: legacy.catKey,
      description: legacy.description,
      price: { kind: legacy.price.kind, amount: legacy.price.from },
      specs: legacy.specs,
      ral: legacy.ral,
      images: legacy.images.map((image) => ({ ...image, path: stripKnownOrigin(image.path) })),
      drawing: legacy.drawing ? stripKnownOrigin(legacy.drawing) : null,
      search: {
        category: oldSearch?.c || searchCategory(legacy),
        keywords: normalizeKeywordText(keywordParts.join(' ')),
        image: searchImage,
      },
      editorGroup: oldPrice?.group || (/\/artdeco-/i.test(legacy.url) ? 'artdeco' : 'standard'),
    });
  }

  const searchLandings = [];
  for (const legacy of search.filter((item) => !productUrls.has(item.u))) {
    const page = await pageMetadata(legacy.u);
    const image = await chooseImage([legacy.i, page.ogImage], legacy.u);
    const legacyKeywords = usefulLegacyKeywords(legacy.k);
    searchLandings.push({
      name: legacy.n,
      url: legacy.u,
      image,
      category: legacy.c,
      keywords: normalizeKeywordText(legacyKeywords || `${legacy.n} ${legacy.c}`),
    });
  }

  const source = validateProductSource({
    schemaVersion: 1,
    categories: [...CATEGORY_LABELS].map(([key, label]) => ({ key, label })),
    products,
    searchLandings,
  });
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, serializeJson(source));

  const missingFromSearch = products.filter((item) => !bySearchUrl.has(item.url)).length;
  const missingFromPrices = products.filter((item) => !byPriceUrl.has(item.url)).length;
  const nonProductsInPrices = prices.filter((item) => !productUrls.has(item.url)).length;
  console.log(JSON.stringify({
    output: path.relative(ROOT, OUT),
    products: products.length,
    searchLandings: searchLandings.length,
    legacy: { missingFromSearch, missingFromPrices, nonProductsInPrices },
  }, null, 2));
}

await main();
