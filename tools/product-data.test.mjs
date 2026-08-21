import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PRODUCT_SOURCE_REL,
  deriveCatalog,
  derivePriceRegistry,
  deriveSearchIndex,
  loadProductSource,
  serializeJson,
  validateProductSource,
} from './product-data.mjs';
import { syncProductData } from './sync-product-data.mjs';
import { syncLinkedCardPrices, syncProductPagePrice } from './product-price-sync.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

test('canonical source has explicit product and landing grains', async () => {
  const source = await loadProductSource(ROOT);
  assert.equal(source.products.length, 276);
  assert.equal(source.searchLandings.length, 16);
  assert.equal(deriveCatalog(source).length, 276);
  assert.equal(derivePriceRegistry(source).items.length, 276);
  assert.equal(deriveSearchIndex(source).length, 292);
});

test('schema rejects duplicate SKU and URL values', async () => {
  const source = await loadProductSource(ROOT);
  const duplicateSku = structuredClone(source);
  duplicateSku.products[1].sku = duplicateSku.products[0].sku.toUpperCase();
  assert.throws(() => validateProductSource(duplicateSku), /duplicate SKU/);

  const duplicateUrl = structuredClone(source);
  duplicateUrl.searchLandings[0].url = duplicateUrl.products[0].url;
  assert.throws(() => validateProductSource(duplicateUrl), /collides/);
});

test('schema rejects unsafe routes, assets, and inconsistent prices', async () => {
  const source = await loadProductSource(ROOT);
  const unsafeRoute = structuredClone(source);
  unsafeRoute.products[0].url = '../outside/';
  assert.throws(() => validateProductSource(unsafeRoute), /project-relative|normalized/);

  const unsafeAsset = structuredClone(source);
  unsafeAsset.products[0].search.image = 'https://example.com/image.webp';
  assert.throws(() => validateProductSource(unsafeAsset), /project-relative asset/);

  const nullSearchImage = structuredClone(source);
  nullSearchImage.products[0].search.image = null;
  assert.throws(() => validateProductSource(nullSearchImage), /must not be null/);

  const badPrice = structuredClone(source);
  badPrice.products[0].price = { kind: 'onrequest', amount: 1 };
  assert.throws(() => validateProductSource(badPrice), /must be null/);
});

test('sync detects drift and repairs all outputs deterministically', async () => {
  const source = await loadProductSource(ROOT);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-products-'));
  try {
    const sourceFile = path.join(temp, PRODUCT_SOURCE_REL);
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(sourceFile, serializeJson(source));

    const first = await syncProductData({ root: temp, write: true });
    assert.equal(first.changedFiles.length, 3);
    const clean = await syncProductData({ root: temp, write: false });
    assert.equal(clean.changedFiles.length, 0);

    await fs.appendFile(path.join(temp, 'assets/products.json'), 'drift');
    await assert.rejects(() => syncProductData({ root: temp, write: false }), /stale/);
    await syncProductData({ root: temp, write: true });
    const repaired = await syncProductData({ root: temp, write: false });
    assert.equal(repaired.changedFiles.length, 0);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('price materializer updates only product data fields and matching linked cards', () => {
  const product = {
    url: 'maf/skamejki/example/',
    price: { kind: 'from', amount: 12300 },
  };
  const page = '<script type="application/ld+json">{"@type":"Product","name":"Example","offers":{"lowPrice":"100"}}</script>' +
    '<div class="pp-price"><span class="big">от 100 ₽</span><span class="note">note</span></div>';
  const syncedPage = syncProductPagePrice(page, product);
  assert.match(syncedPage, /от 12 300 ₽/);
  assert.match(syncedPage, /"lowPrice":"12300"/);
  assert.match(syncedPage, /<span class="note">note<\/span>/);

  const changes = new Map([[product.url, {
    before: { kind: 'from', amount: 100 },
    after: product.price,
  }]]);
  const cards = '<a href="skamejki/example/"><b>от 100 ₽</b></a>' +
    '<a href="skamejki/other/"><b>от 100 ₽</b></a>';
  assert.equal(
    syncLinkedCardPrices(cards, 'maf/index.html', changes),
    '<a href="skamejki/example/"><b>от 12 300 ₽</b></a>' +
    '<a href="skamejki/other/"><b>от 100 ₽</b></a>'
  );
});
