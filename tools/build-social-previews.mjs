#!/usr/bin/env node
/**
 * Builds crawler-friendly 1200×630 JPEG previews and writes complete OG/Twitter
 * metadata into every indexable page.
 *
 * Product-style previews are used only when a verified light product shot exists:
 * white.webp, an ArtDeco hero.webp, or the DS-58 white render (04.webp).
 * Other pages and product fallbacks use a gently darkened, branded page preview.
 *
 * Usage:
 *   node tools/build-social-previews.mjs --check
 *   node tools/build-social-previews.mjs --write
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SOCIAL_ASSET_ORIGIN,
  getCanonical,
  getMetaContent,
  isNoindex,
  walkFiles,
} from './seo-utils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const PYTHON = process.env.CODEX_PYTHON || '/Users/almazrafikov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const RENDERER = path.join(ROOT, 'tools', 'render-social-preview.py');
const OUTPUT_ROOT = path.join(ROOT, 'assets', 'img', 'social');
const ORIGIN = 'https://www.egoe-life.ru';
// Social crawlers must be able to fetch preview files before the same build is
// copied to production hosting. GitHub Pages is the permanent public backup,
// so it is also the stable origin for OG/Twitter images.
const PREVIEW_ORIGIN = SOCIAL_ASSET_ORIGIN;

function decode(value = '') {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}

function attr(value = '') {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function localFromUrl(url) {
  try {
    const parsed = new URL(url, ORIGIN);
    if (parsed.origin === ORIGIN) {
      return path.join(ROOT, decodeURIComponent(parsed.pathname).replace(/^\/+/, ''));
    }
    if (parsed.origin === new URL(PREVIEW_ORIGIN).origin) {
      const previewBase = new URL(PREVIEW_ORIGIN).pathname.replace(/^\/+|\/+$/g, '');
      const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      if (pathname === previewBase) return ROOT;
      if (pathname.startsWith(`${previewBase}/`)) {
        return path.join(ROOT, pathname.slice(previewBase.length + 1));
      }
    }
    return '';
  } catch { return ''; }
}

function resolveImage(pageFile, raw = '') {
  const clean = raw.split(/[?#]/)[0];
  if (!clean || clean.startsWith('data:')) return '';
  const abs = /^https?:\/\//i.test(clean) ? localFromUrl(clean) : path.resolve(path.dirname(pageFile), clean);
  return abs && fsSync.existsSync(abs) && fsSync.statSync(abs).isFile() ? abs : '';
}

function gallerySources(html) {
  const gallery = html.match(/<div class="gallery[^\"]*">([\s\S]*?)<div class="pp-info">/i)?.[1] ?? '';
  return [...gallery.matchAll(/<img\b[^>]*\bsrc="([^\"]+)"[^>]*>/gi)].map((m) => m[1]);
}

function firstPageImage(html) {
  const hero = html.match(/class="(?:shero-bg|hero-media|catalog-hero[^\"]*)"[\s\S]*?<img\b[^>]*\bsrc="([^\"]+)"/i)?.[1];
  if (hero) return hero;
  return [...html.matchAll(/<img\b[^>]*\bsrc="([^\"]+)"[^>]*>/gi)]
    .map((m) => m[1])
    .find((src) => !/assets\/img\/(?:social|docs)\//i.test(src) && !/(?:thumb|drawing)/i.test(src)) || '';
}

function fallbackSource(html, file, isProduct) {
  // The four legacy bollard pages do not yet contain individual photos. Keep
  // their category image as a clearly branded fallback, never as a product shot.
  const bollards = path.join(ROOT, 'assets', 'img', 'catalog', 'categories', 'parkovochnye-stolbiki-1448.webp');
  if (isProduct && file.includes(`${path.sep}parkovochnye-stolbiki${path.sep}`) && fsSync.existsSync(bollards)) {
    return bollards;
  }

  const currentOg = getMetaContent(html, 'og:image');
  const fromOg = resolveImage(file, currentOg);
  if (fromOg && !fromOg.startsWith(OUTPUT_ROOT)) return fromOg;
  const fromPage = resolveImage(file, firstPageImage(html));
  if (fromPage) return fromPage;
  return path.join(ROOT, 'assets', 'img', 'hero', 'facade-jk.webp');
}

function chooseSource(html, file, isProduct, canonical) {
  if (isProduct) {
    const candidates = gallerySources(html);

    // DS-58 has one proper light render, but its filename does not describe it.
    if (canonical === `${ORIGIN}/ograzhdeniya/ds-58/`) {
      const ds58 = path.join(ROOT, 'ograzhdeniya', 'uploads', 'catalog', 'ds-58', '04.webp');
      if (fsSync.existsSync(ds58)) return { source: ds58, previewStyle: 'product', fallbackProduct: false };
    }

    for (const candidate of candidates.filter((src) => /(?:^|\/)white\.(?:webp|jpe?g|png)$/i.test(src.split(/[?#]/)[0]))) {
      const resolved = resolveImage(file, candidate);
      if (resolved) return { source: resolved, previewStyle: 'product', fallbackProduct: false };
    }

    for (const candidate of candidates.filter((src) => /(?:^|\/)hero\.(?:webp|jpe?g|png)$/i.test(src.split(/[?#]/)[0]))) {
      const resolved = resolveImage(file, candidate);
      const artdecoRoot = `${path.sep}assets${path.sep}img${path.sep}artdeco${path.sep}`;
      if (resolved && resolved.includes(artdecoRoot)) {
        return { source: resolved, previewStyle: 'product', fallbackProduct: false };
      }
    }
  }

  return {
    source: fallbackSource(html, file, isProduct),
    previewStyle: 'branded',
    fallbackProduct: isProduct,
  };
}

function slugFromCanonical(canonical, kind) {
  const pathname = new URL(canonical).pathname.replace(/^\/+|\/+$/g, '');
  const slug = pathname ? pathname.replaceAll('/', '--') : 'home';
  return `${kind === 'product' ? 'products' : 'pages'}/${slug}.jpg`;
}

function renderPreview(source, dest, previewStyle) {
  fsSync.mkdirSync(path.dirname(dest), { recursive: true });
  const result = spawnSync(PYTHON, [RENDERER, source, dest, previewStyle], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`preview renderer failed for ${source}:\n${result.stderr || result.stdout}`);
}

function updateMetadata(html, imageUrl, title, description, imageAlt, ogType) {
  const names = [
    'og:type', 'og:image', 'og:image:width', 'og:image:height', 'og:image:type', 'og:image:alt',
    'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt',
  ];
  for (const name of names) {
    const re = new RegExp(`<meta\\s+(?:property|name)="${name.replaceAll(':', '\\:')}"[^>]*>\\s*`, 'gi');
    html = html.replace(re, '');
  }

  const tags = [
    `<meta property="og:type" content="${ogType}">`,
    `<meta property="og:image" content="${attr(imageUrl)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:type" content="image/jpeg">',
    `<meta property="og:image:alt" content="${attr(imageAlt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(description)}">`,
    `<meta name="twitter:image" content="${attr(imageUrl)}">`,
    `<meta name="twitter:image:alt" content="${attr(imageAlt)}">`,
  ].join('\n');

  if (/<meta property="og:url"[^>]*>/i.test(html)) {
    return html.replace(/(<meta property="og:url"[^>]*>)/i, `$1\n${tags}`);
  }
  return html.replace(/(<meta name="robots"[^>]*>)/i, `$1\n${tags}`);
}

const pages = [];
for (const file of await walkFiles(ROOT, (f) => f.endsWith('.html'))) {
  const html = await fs.readFile(file, 'utf8');
  const canonical = getCanonical(html);
  if (!canonical || isNoindex(html) || !canonical.startsWith(`${ORIGIN}/`)) continue;
  const isProduct = html.includes('class="pp-price"') && /"@type"\s*:\s*"Product"/.test(html);
  const { source, previewStyle, fallbackProduct } = chooseSource(html, file, isProduct, canonical);
  const outputRel = `assets/img/social/${slugFromCanonical(canonical, isProduct ? 'product' : 'page')}`;
  const output = path.join(ROOT, outputRel);
  const imageUrl = `${PREVIEW_ORIGIN}/${outputRel}`;
  const title = decode(getMetaContent(html, 'og:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'EGOE');
  const description = decode(getMetaContent(html, 'og:description') || getMetaContent(html, 'description'));
  const h1 = decode(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || title);
  const nextHtml = updateMetadata(
    html,
    imageUrl,
    title,
    description,
    isProduct ? `${h1} — EGOE` : `${title} — EGOE`,
    isProduct ? 'product' : 'website',
  );
  pages.push({
    file, html, nextHtml, canonical, kind: isProduct ? 'product' : 'page',
    source, output, outputRel, previewStyle, fallbackProduct,
  });
}

const changed = pages.filter((page) => page.html !== page.nextHtml || !fsSync.existsSync(page.output));
const missingSources = pages.filter((page) => !page.source || !fsSync.existsSync(page.source));
if (WRITE) {
  if (!fsSync.existsSync(PYTHON)) throw new Error(`python not found: ${PYTHON}`);
  if (!fsSync.existsSync(RENDERER)) throw new Error(`renderer not found: ${RENDERER}`);
  for (const page of pages) {
    renderPreview(page.source, page.output, page.previewStyle);
    if (page.html !== page.nextHtml) await fs.writeFile(page.file, page.nextHtml);
  }
  const fallbackProducts = pages.filter((page) => page.fallbackProduct).map((page) => page.canonical);
  const manifest = {
    previewStyle: {
      product: pages.filter((page) => page.previewStyle === 'product').length,
      branded: pages.filter((page) => page.previewStyle === 'branded').length,
    },
    fallbackProducts,
    previews: pages.map((page) => ({
      canonical: page.canonical,
      kind: page.kind,
      previewStyle: page.previewStyle,
      fallbackProduct: page.fallbackProduct,
      source: path.relative(ROOT, page.source).split(path.sep).join('/'),
      output: page.outputRel,
      bytes: fsSync.statSync(page.output).size,
    })),
  };
  await fs.writeFile(path.join(OUTPUT_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

const fallbackProducts = pages.filter((page) => page.fallbackProduct).map((page) => page.canonical);
console.log(JSON.stringify({
  mode: WRITE ? 'write' : 'check',
  pages: pages.length,
  products: pages.filter((p) => p.kind === 'product').length,
  brandedPages: pages.filter((p) => p.kind === 'page').length,
  previewStyle: {
    product: pages.filter((page) => page.previewStyle === 'product').length,
    branded: pages.filter((page) => page.previewStyle === 'branded').length,
  },
  fallbackProducts,
  pending: changed.length,
  missingSources: missingSources.map((p) => path.relative(ROOT, p.file).split(path.sep).join('/')),
}, null, 2));
if (!WRITE && changed.length) process.exitCode = 1;
