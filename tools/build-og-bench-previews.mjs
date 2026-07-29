#!/usr/bin/env node
// Создаёт лёгкие JPEG-превью для соцсетей на основе белого фото каждой скамейки
// и обновляет Open Graph метатеги в её карточке.
//
// Запуск:
//   node tools/build-og-bench-previews.mjs --dry-run
//   node tools/build-og-bench-previews.mjs
//   node tools/build-og-bench-previews.mjs --check

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORY_DIR = join(ROOT, 'maf', 'skamejki');
const OUTPUT_DIR = join(ROOT, 'assets', 'img', 'og', 'maf', 'skamejki');
const SITE_ORIGIN = 'https://www.egoe-life.ru';
const WIDTH = 1200;
const HEIGHT = 630;
const FLAGS = new Set(process.argv.slice(2));
const DRY_RUN = FLAGS.has('--dry-run');
const CHECK_ONLY = FLAGS.has('--check');

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function cleanUrl(value) {
  return String(value || '').trim().replace(/&amp;/g, '&').split(/[?#]/, 1)[0];
}

function localAssetPath(value, pageDir) {
  const url = cleanUrl(value);
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) {
    const parsed = new URL(url);
    if (parsed.origin !== SITE_ORIGIN) return null;
    return join(ROOT, decodeURIComponent(parsed.pathname).replace(/^\/+/, ''));
  }
  if (url.startsWith('/')) return join(ROOT, url.replace(/^\/+/, ''));
  return resolve(pageDir, url);
}

function productPages() {
  return readdirSync(CATEGORY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ slug: entry.name, file: join(CATEGORY_DIR, entry.name, 'index.html') }))
    .filter(({ file }) => existsSync(file))
    .filter(({ file }) => readFileSync(file, 'utf8').includes('class="pp-price"'))
    .sort((a, b) => a.slug.localeCompare(b.slug, 'ru'));
}

function previewPages() {
  // Каталог тоже расшаривают как «ссылку на скамейки», поэтому даём ему отдельное JPEG-превью.
  const categoryPage = {
    slug: 'catalog',
    file: join(CATEGORY_DIR, 'index.html'),
    sourceOverride: '../../assets/img/maf/skamejki/7106/white.webp',
  };
  return [categoryPage, ...productPages()];
}

function metaContent(html, property) {
  const match = html.match(new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]*)"`, 'i'));
  return match ? match[1] : '';
}

function whiteImageSource(html, pageDir, sourceOverride = '') {
  if (sourceOverride && existsSync(localAssetPath(sourceOverride, pageDir))) return { source: sourceOverride, kind: 'white' };
  const white = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*\/white\.webp(?:\?[^\"]*)?)"[^>]*>/gi)]
    .map((match) => match[1])
    .find((src) => existsSync(localAssetPath(src, pageDir)));
  if (white) return { source: white, kind: 'white' };

  // У Art Déco главное hero-изображение уже выполнено на нейтральном светлом фоне.
  const ogImage = metaContent(html, 'og:image');
  if (ogImage && existsSync(localAssetPath(ogImage, pageDir))) return { source: ogImage, kind: 'hero' };
  return null;
}

function replaceImageMeta(html, imageUrl, alt) {
  // Удаляем только метатеги, которыми управляет этот скрипт, затем вставляем единый набор.
  const managedMeta = /^<meta\s+(?:property="og:image(?::[^"]*)?"|name="twitter:(?:card|image|image:alt)")[^>]*>\r?\n?/gim;
  const cleaned = html
    .replace(managedMeta, '')
    .replace(/(<meta\s+property="og:url"\s+content="[^"]*">\r?\n)(?:[ \t]*\r?\n)*/i, '$1');
  const block = [
    `<meta property="og:image" content="${imageUrl}">`,
    `<meta property="og:image:secure_url" content="${imageUrl}">`,
    '<meta property="og:image:type" content="image/jpeg">',
    `<meta property="og:image:width" content="${WIDTH}">`,
    `<meta property="og:image:height" content="${HEIGHT}">`,
    `<meta property="og:image:alt" content="${htmlEscape(alt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${imageUrl}">`,
    `<meta name="twitter:image:alt" content="${htmlEscape(alt)}">`,
  ].join('\n');
  const anchor = /(<meta\s+property="og:url"\s+content="[^"]*">\r?\n)/i;
  if (!anchor.test(cleaned)) throw new Error('Не найден meta og:url');
  return cleaned.replace(anchor, `$1${block}\n`);
}

function buildJpeg(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  const filter = [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0xf2f2f2`,
    'format=yuvj420p',
  ].join(',');
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-map_metadata', '-1', '-vf', filter,
    '-frames:v', '1', '-q:v', '4', target,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg: ${result.stderr || result.error?.message || 'неизвестная ошибка'}`);
}

function jpegDimensions(target) {
  const result = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', target], { encoding: 'utf8' });
  const width = Number(result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  return { width, height };
}

function run() {
  const products = productPages();
  const pages = previewPages();
  const report = { productPages: products.length, pages: pages.length, generated: 0, updated: 0, errors: [], files: [] };
  for (const { slug, file, sourceOverride } of pages) {
    const html = readFileSync(file, 'utf8');
    const pageDir = dirname(file);
    const selected = whiteImageSource(html, pageDir, sourceOverride);
    const title = metaContent(html, 'og:title') || html.match(/<title>([^<]+)<\/title>/i)?.[1] || `Скамейка ${slug}`;
    const imageAlt = `${title.replace(/\s*\|\s*EGOE\s*$/i, '')} — фото на белом фоне`;
    const target = join(OUTPUT_DIR, `${slug}.jpg`);
    const relativeTarget = relative(ROOT, target).split('\\').join('/');
    const imageUrl = `${SITE_ORIGIN}/${relativeTarget}`;
    try {
      if (!selected) throw new Error('Не найдено белое или hero-изображение');
      const source = localAssetPath(selected.source, pageDir);
      if (!source || !existsSync(source)) throw new Error(`Не найден исходник: ${selected.source}`);
      if (!CHECK_ONLY && !DRY_RUN) {
        buildJpeg(source, target);
        report.generated += 1;
      }
      const updated = replaceImageMeta(html, imageUrl, imageAlt);
      if (!CHECK_ONLY && !DRY_RUN && updated !== html) {
        writeFileSync(file, updated);
        report.updated += 1;
      }
      if (CHECK_ONLY) {
        if (!existsSync(target)) throw new Error(`Нет файла: ${relativeTarget}`);
        const dimensions = jpegDimensions(target);
        if (dimensions.width !== WIDTH || dimensions.height !== HEIGHT) throw new Error(`Неверный размер ${dimensions.width}×${dimensions.height}`);
        if (statSync(target).size > 180_000) throw new Error(`Файл слишком тяжёлый: ${statSync(target).size} байт`);
        if (!html.includes(`property="og:image" content="${imageUrl}"`)) throw new Error('og:image не указывает на generated JPEG');
        if (!html.includes('property="og:image:type" content="image/jpeg"')) throw new Error('Нет типа JPEG');
      }
      report.files.push({ slug, source: relative(ROOT, source).split('\\').join('/'), sourceKind: selected.kind, target: relativeTarget });
    } catch (error) {
      report.errors.push({ slug, error: error.message });
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

run();
