import fs from 'node:fs/promises';
import path from 'node:path';
import {
  SOCIAL_ASSET_ORIGIN,
  SITE_ORIGIN,
  decodeText,
  fileToPublicUrl,
  findTags,
  getCanonical,
  getMetaContent,
  isNoindex,
  relativePath,
  walkFiles,
} from './seo-utils.mjs';

const root = path.resolve('.');
const strict = new Set(process.argv.slice(2)).has('--strict');
const htmlFiles = await walkFiles(root, (file) => file.endsWith('.html'));
const allFiles = new Set((await walkFiles(root)).map((file) => relativePath(root, file)));
const sitemapXml = await fs.readFile(path.join(root, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const sitemapSet = new Set(sitemapUrls);
const pages = [];

function localUrlExists(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  let pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  if (parsed.origin === SOCIAL_ASSET_ORIGIN) {
    const socialBase = new URL(SOCIAL_ASSET_ORIGIN).pathname.replace(/^\/+|\/+$/g, '');
    if (pathname === socialBase) pathname = '';
    else if (pathname.startsWith(`${socialBase}/`)) pathname = pathname.slice(socialBase.length + 1);
    else return false;
  } else if (parsed.origin !== SITE_ORIGIN) {
    return true;
  }
  if (!pathname) return allFiles.has('index.html');
  if (pathname.endsWith('/')) return allFiles.has(`${pathname}index.html`);
  return allFiles.has(pathname) || allFiles.has(`${pathname}/index.html`);
}

for (const file of htmlFiles) {
  const html = await fs.readFile(file, 'utf8');
  const expectedUrl = fileToPublicUrl(root, file);
  const title = decodeText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((match) => decodeText(match[1]))
    .filter(Boolean);
  const canonical = getCanonical(html);
  const noindex = isNoindex(html);
  const ogImage = getMetaContent(html, 'og:image');
  const images = findTags(html, 'img');
  const documentUrl = new URL(expectedUrl);
  const baseHref = findTags(html, 'base')[0]?.attributes.href;
  const baseUrl = baseHref ? new URL(baseHref, documentUrl) : documentUrl;
  const brokenLocalLinks = findTags(html, 'a')
    .map((tag) => tag.attributes.href ?? '')
    .filter((href) => href && !/^(?:#|mailto:|tel:|javascript:|data:)/i.test(href))
    .map((href) => ({ href, resolved: new URL(href, baseUrl).href }))
    .filter(({ resolved }) => !localUrlExists(resolved));
  const indexHtmlLinks = findTags(html, 'a')
    .map((tag) => tag.attributes.href ?? '')
    .filter((href) => /(?:^|\/)index\.html(?:[?#].*)?$/i.test(href));

  pages.push({
    file: relativePath(root, file),
    expectedUrl,
    title,
    description: getMetaContent(html, 'description'),
    canonical,
    noindex,
    h1,
    ogImage,
    brokenOgImage: ogImage && !localUrlExists(ogImage) ? ogImage : '',
    brokenLocalLinks,
    imagesWithoutAlt: images.filter((tag) => !(tag.attributes.alt ?? '').trim()).length,
    indexHtmlLinks: indexHtmlLinks.length,
  });
}

const indexable = pages.filter((page) => !page.noindex);
const report = {
  totals: {
    htmlPages: pages.length,
    indexablePages: indexable.length,
    noindexPages: pages.length - indexable.length,
    sitemapUrls: sitemapUrls.length,
    indexHtmlLinks: pages.reduce((sum, page) => sum + page.indexHtmlLinks, 0),
  },
  errors: {
    missingTitle: pages.filter((page) => !page.title).map((page) => page.file),
    missingDescription: indexable.filter((page) => !page.description).map((page) => page.file),
    missingCanonical: indexable.filter((page) => !page.canonical).map((page) => page.file),
    canonicalMismatch: indexable
      .filter((page) => page.canonical && page.canonical !== page.expectedUrl)
      .map((page) => ({ file: page.file, canonical: page.canonical, expected: page.expectedUrl })),
    missingH1: indexable.filter((page) => page.h1.length === 0).map((page) => page.file),
    multipleH1: indexable.filter((page) => page.h1.length > 1).map((page) => ({ file: page.file, h1: page.h1 })),
    missingOgImage: indexable.filter((page) => !page.ogImage).map((page) => page.file),
    brokenOgImage: indexable
      .filter((page) => page.brokenOgImage)
      .map((page) => ({ file: page.file, image: page.brokenOgImage })),
    brokenLocalLinks: pages
      .filter((page) => page.brokenLocalLinks.length > 0)
      .map((page) => ({ file: page.file, links: page.brokenLocalLinks })),
    absentFromSitemap: indexable.filter((page) => !sitemapSet.has(page.expectedUrl)).map((page) => page.file),
    noindexInSitemap: pages.filter((page) => page.noindex && sitemapSet.has(page.expectedUrl)).map((page) => page.file),
    unknownSitemapUrls: sitemapUrls.filter((url) => !pages.some((page) => page.expectedUrl === url)),
    pagesWithIndexHtmlLinks: pages
      .filter((page) => page.indexHtmlLinks > 0)
      .map((page) => ({ file: page.file, links: page.indexHtmlLinks })),
    imagesWithoutAlt: pages
      .filter((page) => page.imagesWithoutAlt > 0)
      .map((page) => ({ file: page.file, images: page.imagesWithoutAlt })),
  },
};

console.log(JSON.stringify(report, null, 2));

const criticalErrors = [
  ...report.errors.missingTitle,
  ...report.errors.missingDescription,
  ...report.errors.missingCanonical,
  ...report.errors.canonicalMismatch,
  ...report.errors.brokenLocalLinks,
  ...report.errors.absentFromSitemap,
  ...report.errors.noindexInSitemap,
  ...report.errors.unknownSitemapUrls,
  ...report.errors.pagesWithIndexHtmlLinks,
];

if (strict && criticalErrors.length > 0) process.exitCode = 1;
