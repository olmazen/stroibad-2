import fs from 'node:fs/promises';
import path from 'node:path';

export const PRODUCT_SOURCE_REL = 'src/data/products.json';
export const PRODUCT_OUTPUTS = Object.freeze({
  catalog: 'assets/catalog.json',
  search: 'assets/products.json',
  prices: 'assets/data/prices.json',
});

const PRODUCT_KEYS = [
  'sku', 'name', 'productType', 'url', 'category', 'catKey', 'description',
  'price', 'specs', 'ral', 'images', 'drawing', 'search', 'editorGroup',
];
const LANDING_KEYS = ['name', 'url', 'image', 'category', 'keywords'];
const PRICE_KINDS = new Set(['from', 'onrequest']);
const EDITOR_GROUPS = new Set(['standard', 'artdeco']);

function fail(message) {
  throw new Error(`Product data: ${message}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\0') !== wanted.join('\0')) {
    fail(`${label} keys must be exactly ${wanted.join(', ')}; got ${actual.join(', ')}`);
  }
}

function assertText(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    fail(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
  if (value !== value.trim()) fail(`${label} must not have outer whitespace`);
}

export function normalizeRoute(value, label = 'route') {
  assertText(value, label);
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('/') || value.includes('\\')) {
    fail(`${label} must be a project-relative URL: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized.startsWith('../') || normalized === '..' || normalized !== value || !value.endsWith('/')) {
    fail(`${label} must be a normalized directory URL ending with /: ${value}`);
  }
  return value;
}

export function normalizeAsset(value, label = 'asset') {
  if (value === null) return null;
  assertText(value, label);
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('/') || value.includes('\\')) {
    fail(`${label} must be a project-relative asset path: ${value}`);
  }
  if (/[?#]/.test(value)) fail(`${label} must not contain a query or fragment: ${value}`);
  const normalized = path.posix.normalize(value);
  if (normalized.startsWith('../') || normalized === '..' || normalized !== value || value.endsWith('/')) {
    fail(`${label} must be a normalized file path: ${value}`);
  }
  return value;
}

function validatePrice(price, label) {
  if (!isObject(price)) fail(`${label} must be an object`);
  assertExactKeys(price, ['kind', 'amount'], label);
  if (!PRICE_KINDS.has(price.kind)) fail(`${label}.kind must be from or onrequest`);
  if (price.kind === 'from') {
    if (!Number.isSafeInteger(price.amount) || price.amount <= 0) {
      fail(`${label}.amount must be a positive integer for kind=from`);
    }
  } else if (price.amount !== null) {
    fail(`${label}.amount must be null for kind=onrequest`);
  }
}

function validateProduct(product, index, categoryKeys) {
  const label = `products[${index}]`;
  if (!isObject(product)) fail(`${label} must be an object`);
  assertExactKeys(product, PRODUCT_KEYS, label);
  for (const key of ['sku', 'name', 'productType', 'category', 'catKey', 'description']) {
    assertText(product[key], `${label}.${key}`);
  }
  normalizeRoute(product.url, `${label}.url`);
  if (!categoryKeys.has(product.catKey)) fail(`${label}.catKey is not registered: ${product.catKey}`);
  if (!product.url.startsWith(`${product.catKey}/`)) {
    fail(`${label}.url must be nested under catKey ${product.catKey}`);
  }
  validatePrice(product.price, `${label}.price`);

  if (!Array.isArray(product.specs) || product.specs.length === 0) fail(`${label}.specs must be non-empty`);
  product.specs.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== 2) fail(`${label}.specs[${rowIndex}] must be [label, value]`);
    assertText(row[0], `${label}.specs[${rowIndex}][0]`);
    assertText(row[1], `${label}.specs[${rowIndex}][1]`);
  });

  if (!Array.isArray(product.ral) || product.ral.length === 0) fail(`${label}.ral must be non-empty`);
  product.ral.forEach((color, colorIndex) => {
    if (!isObject(color)) fail(`${label}.ral[${colorIndex}] must be an object`);
    assertExactKeys(color, ['hex', 'name'], `${label}.ral[${colorIndex}]`);
    if (!/^#[0-9a-f]{6}$/i.test(color.hex)) fail(`${label}.ral[${colorIndex}].hex is invalid`);
    assertText(color.name, `${label}.ral[${colorIndex}].name`);
  });

  if (!Array.isArray(product.images)) fail(`${label}.images must be an array`);
  product.images.forEach((image, imageIndex) => {
    if (!isObject(image)) fail(`${label}.images[${imageIndex}] must be an object`);
    assertExactKeys(image, ['path', 'kind', 'label'], `${label}.images[${imageIndex}]`);
    normalizeAsset(image.path, `${label}.images[${imageIndex}].path`);
    assertText(image.kind, `${label}.images[${imageIndex}].kind`);
    assertText(image.label, `${label}.images[${imageIndex}].label`, { allowEmpty: true });
  });
  normalizeAsset(product.drawing, `${label}.drawing`);

  if (!isObject(product.search)) fail(`${label}.search must be an object`);
  assertExactKeys(product.search, ['category', 'keywords', 'image'], `${label}.search`);
  assertText(product.search.category, `${label}.search.category`);
  assertText(product.search.keywords, `${label}.search.keywords`);
  normalizeAsset(product.search.image, `${label}.search.image`);
  if (product.search.image === null) fail(`${label}.search.image must not be null`);
  if (!EDITOR_GROUPS.has(product.editorGroup)) fail(`${label}.editorGroup is invalid`);
}

export function validateProductSource(source) {
  if (!isObject(source)) fail('root must be an object');
  assertExactKeys(source, ['schemaVersion', 'categories', 'products', 'searchLandings'], 'root');
  if (source.schemaVersion !== 1) fail(`unsupported schemaVersion ${source.schemaVersion}`);
  if (!Array.isArray(source.categories) || source.categories.length === 0) fail('categories must be non-empty');
  if (!Array.isArray(source.products) || source.products.length === 0) fail('products must be non-empty');
  if (!Array.isArray(source.searchLandings)) fail('searchLandings must be an array');

  const categoryKeys = new Set();
  const categoryLabels = new Set();
  source.categories.forEach((category, index) => {
    const label = `categories[${index}]`;
    if (!isObject(category)) fail(`${label} must be an object`);
    assertExactKeys(category, ['key', 'label'], label);
    assertText(category.key, `${label}.key`);
    assertText(category.label, `${label}.label`);
    normalizeRoute(`${category.key}/`, `${label}.key`);
    if (categoryKeys.has(category.key)) fail(`duplicate category key: ${category.key}`);
    if (categoryLabels.has(category.label)) fail(`duplicate category label: ${category.label}`);
    categoryKeys.add(category.key);
    categoryLabels.add(category.label);
  });

  const skus = new Map();
  const urls = new Map();
  source.products.forEach((product, index) => {
    validateProduct(product, index, categoryKeys);
    const skuKey = product.sku.toLocaleLowerCase('ru');
    if (skus.has(skuKey)) fail(`duplicate SKU ${product.sku}: products[${skus.get(skuKey)}] and products[${index}]`);
    if (urls.has(product.url)) fail(`duplicate product URL ${product.url}`);
    skus.set(skuKey, index);
    urls.set(product.url, `products[${index}]`);
  });

  source.searchLandings.forEach((landing, index) => {
    const label = `searchLandings[${index}]`;
    if (!isObject(landing)) fail(`${label} must be an object`);
    assertExactKeys(landing, LANDING_KEYS, label);
    assertText(landing.name, `${label}.name`);
    normalizeRoute(landing.url, `${label}.url`);
    normalizeAsset(landing.image, `${label}.image`);
    if (landing.image === null) fail(`${label}.image must not be null`);
    assertText(landing.category, `${label}.category`);
    assertText(landing.keywords, `${label}.keywords`);
    if (urls.has(landing.url)) fail(`search landing collides with ${urls.get(landing.url)}: ${landing.url}`);
    urls.set(landing.url, label);
  });

  return source;
}

export async function loadProductSource(root) {
  const file = path.join(root, PRODUCT_SOURCE_REL);
  const source = JSON.parse(await fs.readFile(file, 'utf8'));
  return validateProductSource(source);
}

export function formatPrice(amount) {
  return `от ${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
}

export function deriveCatalog(source) {
  return source.products.map((product) => ({
    sku: product.sku,
    name: product.name,
    productType: product.productType,
    url: product.url,
    category: product.category,
    catKey: product.catKey,
    description: product.description,
    price: {
      text: product.price.kind === 'from' ? formatPrice(product.price.amount) : 'по запросу',
      from: product.price.amount,
      kind: product.price.kind,
    },
    specs: product.specs,
    ral: product.ral,
    images: product.images,
    drawing: product.drawing,
  }));
}

export function deriveSearchIndex(source) {
  const productEntries = source.products.map((product) => ({
    n: product.name,
    u: product.url,
    i: product.search.image,
    c: product.search.category,
    k: product.search.keywords,
  })).sort((a, b) => a.n < b.n ? -1 : a.n > b.n ? 1 : a.u.localeCompare(b.u, 'en'));
  const landingEntries = source.searchLandings.map((landing) => ({
    n: landing.name,
    u: landing.url,
    i: landing.image,
    c: landing.category,
    k: landing.keywords,
  }));
  return [...productEntries, ...landingEntries];
}

export function derivePriceRegistry(source) {
  const labels = new Map(source.categories.map((category) => [category.key, category.label]));
  const orderedProducts = source.categories.flatMap((category) => (
    source.products.filter((product) => product.catKey === category.key)
  ));
  return {
    version: 3,
    source: PRODUCT_SOURCE_REL,
    items: orderedProducts.map((product) => {
      const slug = product.url.split('/').filter(Boolean).at(-1);
      const photos = product.images.map((image) => image.path);
      if (!photos.length) photos.push(product.search.image);
      return {
        cat: product.catKey,
        catLabel: labels.get(product.catKey),
        group: product.editorGroup,
        slug,
        sku: product.sku,
        name: product.name,
        price: product.price.amount,
        underOrder: product.price.kind === 'onrequest',
        photo: photos[0],
        photos,
        url: product.url,
      };
    }),
  };
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 1)}\n`;
}

export function renderProductOutputs(source) {
  validateProductSource(source);
  return new Map([
    [PRODUCT_OUTPUTS.catalog, serializeJson(deriveCatalog(source))],
    [PRODUCT_OUTPUTS.search, `${JSON.stringify(deriveSearchIndex(source))}\n`],
    [PRODUCT_OUTPUTS.prices, serializeJson(derivePriceRegistry(source))],
  ]);
}
