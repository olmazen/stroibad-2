#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatPrice,
  loadProductSource,
} from './product-data.mjs';
import { syncProductData } from './sync-product-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

function productJsonLd(html, route) {
  const blocks = html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue;
    }
    if (parsed?.['@type'] === 'Product') return parsed;
  }
  throw new Error(`${route}: missing valid Product JSON-LD`);
}

function pageSku(html, route) {
  const match = html.match(/class=["']pp-art["'][^>]*>\s*Артикул\s+(?:<b>)?([^<·]+)/i);
  const value = decodeHtml(match?.[1]);
  if (!value) throw new Error(`${route}: missing visible SKU`);
  return value;
}

function pagePrice(html, route) {
  const block = html.match(/class=["']pp-price["'][^>]*>[\s\S]*?class=["']big["'][^>]*>([\s\S]*?)<\/span>/i);
  const value = decodeHtml(block?.[1]);
  if (!value) throw new Error(`${route}: missing visible product price`);
  return value;
}

function unique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label}: duplicate ${value}`);
    seen.add(value);
  }
}

export async function verifyProductData({ root = ROOT } = {}) {
  await syncProductData({ root, write: false });
  const source = await loadProductSource(root);
  const search = JSON.parse(await fs.readFile(path.join(root, 'assets/products.json'), 'utf8'));
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'assets/catalog.json'), 'utf8'));
  const prices = JSON.parse(await fs.readFile(path.join(root, 'assets/data/prices.json'), 'utf8'));
  const contract = JSON.parse(await fs.readFile(path.join(root, 'config/site-contract.json'), 'utf8'));

  unique(source.products.map((product) => product.sku.toLocaleLowerCase('ru')), 'canonical SKU');
  unique(source.products.map((product) => product.url), 'canonical product URL');
  unique(search.map((entry) => entry.u), 'search URL');
  unique(catalog.map((entry) => entry.url), 'quote catalog URL');
  unique(prices.items.map((entry) => entry.url), 'price registry URL');

  if (catalog.length !== source.products.length) throw new Error('quote catalog/product count mismatch');
  if (prices.items.length !== source.products.length) throw new Error('price registry/product count mismatch');
  if (search.length !== source.products.length + source.searchLandings.length) {
    throw new Error('search grain mismatch: expected products + explicit landings');
  }

  let checkedAssets = 0;
  let productsWithoutGallery = 0;
  const searchByUrl = new Map(search.map((entry) => [entry.u, entry]));
  const catalogByUrl = new Map(catalog.map((entry) => [entry.url, entry]));
  const pricesByUrl = new Map(prices.items.map((entry) => [entry.url, entry]));

  async function assertAsset(rel, label) {
    checkedAssets++;
    if (!await exists(path.join(root, rel))) throw new Error(`${label}: missing asset ${rel}`);
  }

  for (const product of source.products) {
    const pageFile = path.join(root, product.url, 'index.html');
    if (!await exists(pageFile)) throw new Error(`${product.url}: missing product page`);
    const html = await fs.readFile(pageFile, 'utf8');
    const jsonLd = productJsonLd(html, product.url);
    const visiblePrice = pagePrice(html, product.url);
    const expectedPrice = product.price.kind === 'from' ? formatPrice(product.price.amount) : 'по запросу';

    if (pageSku(html, product.url) !== product.sku) {
      throw new Error(`${product.url}: visible SKU differs from canonical ${product.sku}`);
    }
    if (decodeHtml(jsonLd.name) !== product.name) {
      throw new Error(`${product.url}: JSON-LD name differs from canonical name`);
    }
    if (decodeHtml(jsonLd.category) !== product.category) {
      throw new Error(`${product.url}: JSON-LD category differs from canonical category`);
    }
    if (visiblePrice !== expectedPrice) {
      throw new Error(`${product.url}: visible price ${visiblePrice} differs from ${expectedPrice}`);
    }
    if (product.price.kind === 'from' && Number(jsonLd.offers?.lowPrice) !== product.price.amount) {
      throw new Error(`${product.url}: JSON-LD lowPrice differs from canonical price`);
    }

    const searchEntry = searchByUrl.get(product.url);
    const catalogEntry = catalogByUrl.get(product.url);
    const priceEntry = pricesByUrl.get(product.url);
    if (!searchEntry || !catalogEntry || !priceEntry) {
      throw new Error(`${product.url}: missing from a generated consumer view`);
    }
    if (catalogEntry.sku !== product.sku || priceEntry.sku !== product.sku) {
      throw new Error(`${product.url}: SKU differs between generated consumer views`);
    }
    if (priceEntry.price !== product.price.amount || priceEntry.underOrder !== (product.price.kind === 'onrequest')) {
      throw new Error(`${product.url}: price differs in generated price registry`);
    }

    await assertAsset(product.search.image, `${product.url} search`);
    if (!product.images.length) productsWithoutGallery++;
    for (const image of product.images) await assertAsset(image.path, `${product.url} gallery`);
    if (product.drawing) await assertAsset(product.drawing, `${product.url} drawing`);
  }

  for (const landing of source.searchLandings) {
    if (!await exists(path.join(root, landing.url, 'index.html'))) {
      throw new Error(`${landing.url}: missing search landing page`);
    }
    if (!searchByUrl.has(landing.url)) throw new Error(`${landing.url}: missing from generated search index`);
    await assertAsset(landing.image, `${landing.url} search landing`);
  }

  const expected = contract.productData;
  const actual = {
    canonicalProducts: source.products.length,
    searchLandings: source.searchLandings.length,
    searchEntries: search.length,
    productsWithoutGallery,
  };
  for (const [key, value] of Object.entries(actual)) {
    if (expected?.[key] !== value) {
      throw new Error(`productData.${key} contract mismatch: expected ${expected?.[key]}, got ${value}`);
    }
  }

  return {
    products: source.products.length,
    searchLandings: source.searchLandings.length,
    searchEntries: search.length,
    priceEntries: prices.items.length,
    checkedAssets,
    productsWithoutGallery,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyProductData();
  console.log(
    `Verified product source: ${result.products} products, ${result.searchLandings} search landings, ` +
    `${result.checkedAssets} asset references; productsWithoutGallery=${result.productsWithoutGallery}`
  );
}
