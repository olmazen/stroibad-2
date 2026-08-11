import fs from 'node:fs/promises';
import path from 'node:path';
import {
  fileToPublicUrl,
  getCanonical,
  isNoindex,
  relativePath,
  walkFiles,
  xmlEscape,
} from './seo-utils.mjs';

const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const check = args.has('--check');
const root = path.resolve('.');
const sitemapPath = path.join(root, 'sitemap.xml');
const htmlFiles = await walkFiles(root, (file) => file.endsWith('.html'));
const urls = [];
const errors = [];

for (const file of htmlFiles) {
  const rel = relativePath(root, file);
  // Internal showrooms/editors are never public search landing pages, even if
  // somebody accidentally removes noindex from one of them later.
  if (/^(?:dev-[^/]+|price-edit-[^/]+)\//.test(rel)) continue;
  const html = await fs.readFile(file, 'utf8');
  if (isNoindex(html)) continue;

  const expectedUrl = fileToPublicUrl(root, file);
  const canonical = getCanonical(html);

  if (!canonical) {
    errors.push(`${rel}: отсутствует canonical`);
    continue;
  }

  if (canonical !== expectedUrl) {
    errors.push(`${rel}: canonical ${canonical} != ${expectedUrl}`);
    continue;
  }

  urls.push(expectedUrl);
}

if (errors.length) {
  console.error(`Sitemap не создан: найдено ошибок canonical — ${errors.length}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const sortedUrls = [...new Set(urls)].sort((left, right) => {
    if (left.endsWith('.ru/')) return -1;
    if (right.endsWith('.ru/')) return 1;
    return left.localeCompare(right, 'ru');
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sortedUrls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  const current = await fs.readFile(sitemapPath, 'utf8').catch(() => '');

  if (write && current !== xml) await fs.writeFile(sitemapPath, xml, 'utf8');

  console.log(JSON.stringify({
    htmlPages: htmlFiles.length,
    sitemapUrls: sortedUrls.length,
    changed: current !== xml,
    written: write && current !== xml,
  }, null, 2));

  if (check && current !== xml) process.exitCode = 1;
}
