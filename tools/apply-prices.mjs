#!/usr/bin/env node

// Applies an export from the private price-review page to the canonical product
// source, then materializes the controlled price fields in HTML and all JSON
// consumer views. It never writes to absolute paths outside this repository.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCT_SOURCE_REL,
  loadProductSource,
  serializeJson,
  validateProductSource,
} from './product-data.mjs';
import {
  syncLinkedCardPrices,
  syncProductPagePrice,
} from './product-price-sync.mjs';
import { syncProductData } from './sync-product-data.mjs';
import { verifyProductData } from './verify-product-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , fileArg, ...flags] = process.argv;
const DRY = flags.includes('--dry');

if (!fileArg) {
  console.error('Usage: node tools/apply-prices.mjs <egoe-prices.json> [--dry]');
  process.exit(1);
}

function samePrice(a, b) {
  return a.kind === b.kind && a.amount === b.amount;
}

function exportPrice(item) {
  if (item.underOrder) return { kind: 'onrequest', amount: null };
  if (!Number.isSafeInteger(item.newPrice) || item.newPrice <= 0) {
    throw new Error(`${item.cat}/${item.slug}: newPrice must be a positive integer or underOrder=true`);
  }
  return { kind: 'from', amount: item.newPrice };
}

function isExcluded(rel, contract) {
  const normalized = rel.split(path.sep).join('/');
  return contract.build.excludedPaths.some((entry) => (
    normalized === entry || normalized.startsWith(`${entry}/`)
  ));
}

async function walkHtml(root, rel, contract, out) {
  if (isExcluded(rel, contract)) return;
  const absolute = path.join(root, rel);
  const stat = await fs.lstat(absolute);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    for (const entry of entries) await walkHtml(root, path.join(rel, entry.name), contract, out);
  } else if (stat.isFile() && rel.endsWith('.html')) {
    out.push(rel.split(path.sep).join('/'));
  }
}

async function publicHtmlFiles(contract) {
  const files = contract.build.rootFiles.filter((rel) => rel.endsWith('.html'));
  for (const rel of [...contract.build.publicDirectories, ...contract.build.legacyPublicDirectories]) {
    await walkHtml(ROOT, rel, contract, files);
  }
  return [...new Set(files)].sort();
}

async function writePrepared(files) {
  const staged = [];
  try {
    for (const [target, body] of files) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temp = `${target}.tmp-${process.pid}`;
      await fs.writeFile(temp, body);
      staged.push({ target, temp });
    }
    for (const { target, temp } of staged) await fs.rename(temp, target);
  } catch (error) {
    await Promise.all(staged.map(({ temp }) => fs.rm(temp, { force: true })));
    throw error;
  }
}

async function main() {
  const priceExport = JSON.parse(await fs.readFile(path.resolve(fileArg), 'utf8'));
  if (!Array.isArray(priceExport.items)) throw new Error('Price export must contain an items array');

  const source = await loadProductSource(ROOT);
  const next = structuredClone(source);
  const byIdentity = new Map(next.products.map((product) => {
    const slug = product.url.split('/').filter(Boolean).at(-1);
    return [`${product.catKey}/${slug}`, product];
  }));
  const changes = new Map();
  const filledIdentities = new Set();
  let skipped = 0;

  for (const item of priceExport.items) {
    if (!item.filled || item.keep) {
      skipped++;
      continue;
    }
    const identity = `${item.cat}/${item.slug}`;
    if (filledIdentities.has(identity)) throw new Error(`Duplicate filled price row: ${identity}`);
    filledIdentities.add(identity);
    const product = byIdentity.get(identity);
    if (!product) throw new Error(`Filled price row is not in canonical products: ${identity}`);
    if (String(item.sku) !== product.sku) throw new Error(`${identity}: SKU mismatch (${item.sku} vs ${product.sku})`);
    if ((item.oldPrice ?? null) !== product.price.amount) {
      throw new Error(
        `${identity}: stale export (oldPrice=${item.oldPrice ?? 'null'}, canonical=${product.price.amount ?? 'null'})`
      );
    }
    const before = { ...product.price };
    const after = exportPrice(item);
    if (samePrice(before, after)) {
      skipped++;
      continue;
    }
    product.price = after;
    changes.set(product.url, { before, after, product });
  }

  validateProductSource(next);
  const contract = JSON.parse(await fs.readFile(path.join(ROOT, 'config/site-contract.json'), 'utf8'));
  const prepared = new Map();

  for (const { product } of changes.values()) {
    const rel = `${product.url}index.html`;
    const file = path.join(ROOT, rel);
    const html = await fs.readFile(file, 'utf8');
    prepared.set(file, syncProductPagePrice(html, product));
  }

  for (const rel of await publicHtmlFiles(contract)) {
    const file = path.join(ROOT, rel);
    const html = prepared.get(file) ?? await fs.readFile(file, 'utf8');
    const synced = syncLinkedCardPrices(html, rel, changes);
    if (synced !== html || prepared.has(file)) prepared.set(file, synced);
  }

  prepared.set(path.join(ROOT, PRODUCT_SOURCE_REL), serializeJson(next));
  if (!DRY) {
    await writePrepared(prepared);
    await syncProductData({ root: ROOT, write: true });
    await verifyProductData({ root: ROOT });
  }

  console.log(
    `${DRY ? '[DRY RUN] ' : ''}price changes=${changes.size}; ` +
    `preparedFiles=${prepared.size}; skipped=${skipped}`
  );
}

await main();
