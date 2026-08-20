#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FOOTER_END,
  FOOTER_START,
  HEADER_END,
  HEADER_START
} from './site-shell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const CONTRACT_PATH = path.join(ROOT, 'config', 'site-contract.json');
const errors = [];

function fail(message) {
  errors.push(message);
}

function compareNames(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(dir, prefix = '', options = {}) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort(compareNames);
  const files = [];
  for (const entry of entries) {
    if (options.skip?.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute, rel, options));
    else if (entry.isFile()) files.push(rel);
    else fail(`Unsupported filesystem entry: ${rel}`);
  }
  return files;
}

async function sha256(file) {
  const body = await fs.readFile(file);
  return {
    bytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex')
  };
}

function artifactPathIsForbidden(rel, contract) {
  const exception = contract.allowedForbiddenPrefixExceptions.some((prefix) => (
    rel === prefix.replace(/\/$/, '') || rel.startsWith(prefix)
  ));
  if (exception) return false;
  return contract.forbiddenArtifactPrefixes.some((prefix) => (
    rel === prefix.replace(/\/$/, '') || rel.startsWith(prefix)
  ));
}

function stripUrl(value) {
  let clean = value.trim().replace(/&amp;/g, '&');
  if (!clean || clean.startsWith('#')) return null;
  if (/^(?:https?:|mailto:|tel:|data:|javascript:|blob:|\/\/)/i.test(clean)) return null;
  clean = clean.split('#')[0].split('?')[0];
  if (!clean) return null;
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

async function resolvePublicReference(fromRel, rawUrl) {
  const clean = stripUrl(rawUrl);
  if (!clean) return true;

  const withoutRootSlash = clean.replace(/^\/+/, '');
  const candidate = clean.startsWith('/')
    ? path.join(DIST, withoutRootSlash)
    : path.resolve(path.dirname(path.join(DIST, fromRel)), clean);
  const normalized = path.resolve(candidate);

  if (normalized !== DIST && !normalized.startsWith(`${DIST}${path.sep}`)) return false;
  if (await exists(normalized)) {
    const stat = await fs.stat(normalized);
    if (stat.isDirectory()) return exists(path.join(normalized, 'index.html'));
    return stat.isFile();
  }
  if (!path.extname(normalized)) return exists(path.join(normalized, 'index.html'));
  return false;
}

function extractHtmlReferences(html) {
  const refs = [];
  const attrPattern = /\b(?:href|src|poster|action)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(attrPattern)) refs.push(match[2]);
  const srcsetPattern = /\bsrcset\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(srcsetPattern)) {
    for (const item of match[2].split(',')) {
      const candidate = item.trim().split(/\s+/)[0];
      if (candidate) refs.push(candidate);
    }
  }
  return refs;
}

function extractCssReferences(css) {
  const refs = [];
  const pattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  for (const match of css.matchAll(pattern)) refs.push(match[2]);
  return refs;
}

async function verifyReferences(files) {
  let checked = 0;
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (ext !== '.html' && ext !== '.css') continue;
    const body = await fs.readFile(path.join(DIST, rel), 'utf8');
    const refs = ext === '.html' ? extractHtmlReferences(body) : extractCssReferences(body);
    for (const ref of refs) {
      checked += 1;
      if (!await resolvePublicReference(rel, ref)) {
        fail(`${rel}: broken local reference "${ref}"`);
      }
    }
  }
  return checked;
}

function countMatchingPages(pages, predicate) {
  return pages.reduce((count, page) => count + (predicate(page.body) ? 1 : 0), 0);
}

function containsDropdownItem(html, text) {
  const pattern = new RegExp(`class=["'][^"']*dd-item[^"']*["'][\\s\\S]{0,900}?<b>${text}<\\/b>`, 'i');
  return pattern.test(html);
}

function countOccurrences(value, token) {
  return value.split(token).length - 1;
}

async function verifySiteShell(contract, distFiles) {
  const htmlFiles = distFiles.filter((rel) => rel.endsWith('.html'));
  const excluded = new Set(contract.siteShell.excludedPages);
  const pagesWithoutMain = new Set(contract.siteShell.pagesWithoutMain);
  const unknownExcluded = [...excluded].filter((rel) => !htmlFiles.includes(rel));
  for (const rel of unknownExcluded) fail(`site shell exclusion is not public HTML: ${rel}`);

  const pages = await Promise.all(htmlFiles.map(async (rel) => ({
    rel,
    body: await fs.readFile(path.join(DIST, rel), 'utf8')
  })));
  const shellPages = pages.filter((page) => !excluded.has(page.rel));
  if (shellPages.length !== contract.siteShell.expectedPages) {
    fail(`site shell page count mismatch: expected ${contract.siteShell.expectedPages}, got ${shellPages.length}`);
  }

  for (const page of pages.filter((item) => excluded.has(item.rel))) {
    for (const token of [HEADER_START, HEADER_END, FOOTER_START, FOOTER_END, 'data-site-header', 'data-site-footer']) {
      if (page.body.includes(token)) fail(`${page.rel}: standalone page unexpectedly contains shared site shell token ${token}`);
    }
  }

  for (const { rel, body } of shellPages) {
    const exactTokens = [
      HEADER_START,
      HEADER_END,
      FOOTER_START,
      FOOTER_END,
      'data-site-header',
      'data-site-footer',
      'id="siteHeader"',
      'id="nav"',
      '<div class="topbar">',
      '<button class="burger"',
      'aria-controls="mnav"',
      'aria-expanded="false"',
      'class="foot-grid"',
      'class="foot-bot"'
    ];
    for (const token of exactTokens) {
      const actual = countOccurrences(body, token);
      if (actual !== 1) fail(`${rel}: expected one shared shell token ${token}, got ${actual}`);
    }
    if (!(body.indexOf(HEADER_START) < body.indexOf(HEADER_END)
      && body.indexOf(HEADER_END) < body.indexOf(FOOTER_START)
      && body.indexOf(FOOTER_START) < body.indexOf(FOOTER_END))) {
      fail(`${rel}: shared shell markers are out of order`);
    }

    const navItems = (body.match(/class=["'][^"']*\bnavitem\b[^"']*["']/g) ?? []).length;
    const dropdownItems = (body.match(/<a class="dd-item"/g) ?? []).length;
    if (navItems !== 1) fail(`${rel}: expected only Catalog to be a navitem, got ${navItems}`);
    if (dropdownItems !== 4) fail(`${rel}: expected four catalog dropdown items, got ${dropdownItems}`);
    if (!containsDropdownItem(body, 'Почтовые ящики')) fail(`${rel}: postal dropdown item is missing`);
    if (containsDropdownItem(body, 'Контейнерные площадки')) fail(`${rel}: container category must stay out of compact dropdown`);

    const mainOpen = (body.match(/<main(?:\s[^>]*)?>/g) ?? []).length;
    const mainClose = countOccurrences(body, '</main>');
    const expectedMain = pagesWithoutMain.has(rel) ? 0 : 1;
    if (mainOpen !== expectedMain || mainClose !== expectedMain) {
      fail(`${rel}: unbalanced main element ${mainOpen}/${mainClose}, expected ${expectedMain}`);
    }
    const sectionOpen = (body.match(/<section(?:\s[^>]*)?>/g) ?? []).length;
    const sectionClose = countOccurrences(body, '</section>');
    if (sectionOpen !== sectionClose) {
      fail(`${rel}: unbalanced section elements ${sectionOpen}/${sectionClose}`);
    }
    const siteScripts = (body.match(/<script\b[^>]*src=["'][^"']*assets\/js\/site\.js(?:\?[^"']*)?["'][^>]*>/gi) ?? []).length;
    if (siteScripts !== 1) fail(`${rel}: expected one site.js script, got ${siteScripts}`);
  }

  const cart = pages.find((page) => page.rel === 'cart/index.html');
  if (!cart || countOccurrences(cart.body, 'class="kpd-foot"') !== 1) {
    fail('cart/index.html: quote drawer footer was not preserved');
  }
  for (const rel of contract.siteShell.legacyBrokenFooterPages) {
    const page = pages.find((item) => item.rel === rel);
    if (!page || countOccurrences(page.body, 'Другие модели качелей') !== 1) {
      fail(`${rel}: repaired related-products section was not preserved`);
    }
  }

  return {
    siteShellPages: shellPages.length,
    standaloneHtmlPages: excluded.size,
    canonicalDropdownItemsPerPage: 4
  };
}

function localDataPath(value) {
  if (!value || typeof value !== 'string') return null;
  let candidate = value.trim();
  if (/^https?:\/\//i.test(candidate)) {
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'www.egoe-life.ru' || host === 'egoe-life.ru') {
      candidate = parsed.pathname;
    } else if (host === 'olmazen.github.io' && parsed.pathname.startsWith('/stroibad-2/')) {
      candidate = parsed.pathname.slice('/stroibad-2'.length);
    } else {
      return null;
    }
  }
  candidate = candidate.split('#')[0].split('?')[0].replace(/^\/+/, '');
  return candidate || null;
}

async function verifyLegacyBaseline(contract, distFiles) {
  const baseline = contract.knownLegacyBaseline;
  const sourceFiles = await walkFiles(ROOT, '', {
    skip: new Set(['.git', 'dist', 'node_modules', '.private'])
  });
  const sourceHtml = sourceFiles.filter((rel) => rel.endsWith('.html'));
  const publicHtml = distFiles.filter((rel) => rel.endsWith('.html'));

  if (sourceHtml.length !== baseline.sourceHtmlFiles) {
    fail(`source HTML baseline changed: expected ${baseline.sourceHtmlFiles}, got ${sourceHtml.length}`);
  }
  if (publicHtml.length !== baseline.publicHtmlFiles) {
    fail(`public HTML baseline changed: expected ${baseline.publicHtmlFiles}, got ${publicHtml.length}`);
  }

  const pages = await Promise.all(publicHtml.map(async (rel) => ({
    rel,
    body: await fs.readFile(path.join(DIST, rel), 'utf8')
  })));
  const dropdownPages = countMatchingPages(pages, (body) => /class=["'][^"']*dd-item/.test(body));
  const postalPages = countMatchingPages(pages, (body) => containsDropdownItem(body, 'Почтовые ящики'));
  const containerPages = countMatchingPages(pages, (body) => containsDropdownItem(body, 'Контейнерные площадки'));

  const actualMetrics = {
    dropdownPages,
    postalDropdownPages: postalPages,
    containerDropdownPages: containerPages
  };
  for (const [key, actual] of Object.entries(actualMetrics)) {
    if (actual !== baseline[key]) {
      fail(`${key} baseline changed: expected ${baseline[key]}, got ${actual}`);
    }
  }

  const sitemap = await fs.readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
  const sitemapUrls = [...sitemap.matchAll(/<loc>[^<]+<\/loc>/g)].length;
  if (sitemapUrls !== baseline.sitemapUrls) {
    fail(`sitemap URL baseline changed: expected ${baseline.sitemapUrls}, got ${sitemapUrls}`);
  }

  const products = JSON.parse(await fs.readFile(path.join(DIST, 'assets', 'products.json'), 'utf8'));
  const catalog = JSON.parse(await fs.readFile(path.join(DIST, 'assets', 'catalog.json'), 'utf8'));
  const prices = JSON.parse(await fs.readFile(path.join(ROOT, 'assets', 'data', 'prices.json'), 'utf8'));
  const dataMetrics = {
    searchProducts: Array.isArray(products) ? products.length : -1,
    quoteCatalogProducts: Array.isArray(catalog) ? catalog.length : -1,
    pricedProducts: Array.isArray(prices.items) ? prices.items.length : -1
  };
  for (const [key, actual] of Object.entries(dataMetrics)) {
    if (actual !== baseline[key]) {
      fail(`${key} baseline changed: expected ${baseline[key]}, got ${actual}`);
    }
  }

  const knownMissing = new Set(baseline.knownMissingDataAssets ?? []);
  const observedKnownMissing = new Set();
  async function verifyDataFile(value, label) {
    const rel = localDataPath(value);
    if (!rel || await exists(path.join(DIST, rel))) return;
    if (knownMissing.has(rel)) {
      observedKnownMissing.add(rel);
      return;
    }
    fail(`${label} references missing file: ${value}`);
  }

  for (const [index, product] of products.entries()) {
    const routePath = localDataPath(product.u);
    await verifyDataFile(product.i, `assets/products.json[${index}]`);
    if (routePath && !await exists(path.join(DIST, routePath, 'index.html'))) {
      fail(`assets/products.json[${index}] references missing route: ${product.u}`);
    }
  }
  for (const [index, product] of catalog.entries()) {
    const routePath = localDataPath(product.url);
    if (routePath && !await exists(path.join(DIST, routePath, 'index.html'))) {
      fail(`assets/catalog.json[${index}] references missing route: ${product.url}`);
    }
    for (const image of product.images ?? []) {
      await verifyDataFile(image.path, `assets/catalog.json[${index}]`);
    }
    const drawingValue = typeof product.drawing === 'string' ? product.drawing : product.drawing?.path;
    await verifyDataFile(drawingValue, `assets/catalog.json[${index}]`);
  }
  for (const rel of knownMissing) {
    if (!observedKnownMissing.has(rel)) {
      fail(`known missing data asset is no longer observed; update the contract baseline: ${rel}`);
    }
  }

  return {
    sourceHtml: sourceHtml.length,
    publicHtml: publicHtml.length,
    ...actualMetrics,
    ...dataMetrics,
    knownMissingDataAssets: observedKnownMissing.size
  };
}

async function verifyReleaseManifest(files) {
  const manifestPath = path.join(DIST, 'release.json');
  if (!await exists(manifestPath)) {
    fail('release.json is missing');
    return null;
  }
  const release = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const actualPaths = files.filter((rel) => rel !== 'release.json');
  const listed = release.files ?? [];
  if (listed.length !== actualPaths.length) {
    fail(`release manifest file count mismatch: listed ${listed.length}, actual ${actualPaths.length}`);
  }

  const listedByPath = new Map(listed.map((entry) => [entry.path, entry]));
  let totalBytes = 0;
  const normalized = [];
  for (const rel of actualPaths) {
    const actual = await sha256(path.join(DIST, rel));
    totalBytes += actual.bytes;
    normalized.push({ path: rel, ...actual });
    const expected = listedByPath.get(rel);
    if (!expected) fail(`release manifest omits ${rel}`);
    else if (expected.sha256 !== actual.sha256 || expected.bytes !== actual.bytes) {
      fail(`release manifest hash/size mismatch for ${rel}`);
    }
  }
  for (const entry of listed) {
    if (!actualPaths.includes(entry.path)) fail(`release manifest lists absent file ${entry.path}`);
  }
  const artifactInput = normalized
    .map((file) => `${file.path}\0${file.sha256}\0${file.bytes}\n`)
    .join('');
  const artifactHash = createHash('sha256').update(artifactInput).digest('hex');
  if (release.artifact?.sha256 !== artifactHash) fail('release artifact sha256 mismatch');
  if (release.artifact?.fileCount !== actualPaths.length) fail('release artifact fileCount mismatch');
  if (release.artifact?.totalBytes !== totalBytes) fail('release artifact totalBytes mismatch');
  return release;
}

async function verifySourceParity(files, contract) {
  if (contract.build.mode !== 'byte-for-byte-copy') return 0;
  let compared = 0;
  for (const rel of files) {
    if (rel === 'release.json') continue;
    const source = path.join(ROOT, rel);
    if (!await exists(source)) {
      fail(`copy-mode artifact has no matching source file: ${rel}`);
      continue;
    }
    const [sourceHash, outputHash] = await Promise.all([
      sha256(source),
      sha256(path.join(DIST, rel))
    ]);
    if (sourceHash.sha256 !== outputHash.sha256 || sourceHash.bytes !== outputHash.bytes) {
      fail(`copy-mode artifact differs from source: ${rel}`);
    }
    compared += 1;
  }
  return compared;
}

async function scanForPrivateMaterial(files) {
  const textExtensions = new Set(['.css', '.htaccess', '.html', '.js', '.json', '.svg', '.txt', '.xml']);
  const patterns = [
    { label: 'macOS user path', pattern: /\/Users\/[^/\s]+\// },
    { label: 'Linux home path', pattern: /\/home\/[^/\s]+\// },
    { label: 'Windows user path', pattern: /[A-Za-z]:\\\\Users\\\\[^\\\s]+\\\\/ },
    { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { label: 'GitHub token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
    { label: 'deployment secret name', pattern: /WEBNAMES_FTP_PASSWORD/ }
  ];
  for (const rel of files) {
    const extension = path.extname(rel) || (path.basename(rel).startsWith('.') ? path.basename(rel) : '');
    if (!textExtensions.has(extension)) continue;
    const body = await fs.readFile(path.join(DIST, rel), 'utf8');
    for (const item of patterns) {
      if (item.pattern.test(body)) fail(`${rel}: contains ${item.label}`);
    }
  }
}

async function main() {
  if (!await exists(DIST)) throw new Error('dist/ does not exist; run npm run build first');
  const contract = JSON.parse(await fs.readFile(CONTRACT_PATH, 'utf8'));
  const files = await walkFiles(DIST);

  for (const rel of files) {
    if (artifactPathIsForbidden(rel, contract)) fail(`forbidden artifact path: ${rel}`);
  }
  for (const rel of contract.requiredFiles) {
    if (!await exists(path.join(DIST, rel))) fail(`required public file is missing: ${rel}`);
  }

  const release = await verifyReleaseManifest(files);
  const byteIdenticalSourceFiles = await verifySourceParity(files, contract);
  const referenceCount = await verifyReferences(files);
  const metrics = await verifyLegacyBaseline(contract, files);
  const shellMetrics = await verifySiteShell(contract, files);
  await scanForPrivateMaterial(files);

  if (errors.length) {
    console.error(`Public artifact verification failed with ${errors.length} error(s):`);
    for (const message of errors.slice(0, 100)) console.error(`- ${message}`);
    if (errors.length > 100) console.error(`- ...and ${errors.length - 100} more`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    artifact: release?.artifact,
    byteIdenticalSourceFiles,
    checkedLocalReferences: referenceCount,
    metrics: { ...metrics, ...shellMetrics }
  }, null, 2));
}

await main();
