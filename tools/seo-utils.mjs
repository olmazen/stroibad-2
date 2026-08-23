import fs from 'node:fs/promises';
import path from 'node:path';

export const SITE_ORIGIN = 'https://www.egoe-life.ru';
export const SOCIAL_ASSET_ORIGIN = 'https://www.egoe-life.ru';

const IGNORED_DIRECTORIES = new Set(['.git', 'dist', 'node_modules', 'ops']);

export async function walkFiles(directory, predicate = () => true) {
  const files = [];

  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolutePath, predicate));
    if (entry.isFile() && predicate(absolutePath)) files.push(absolutePath);
  }

  return files;
}

export function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }

  return attributes;
}

export function findTags(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  return [...html.matchAll(pattern)].map((match) => ({
    raw: match[0],
    attributes: parseAttributes(match[0]),
  }));
}

export function getMetaContent(html, name) {
  const normalizedName = name.toLowerCase();
  return findTags(html, 'meta').find((tag) => (
    tag.attributes.name?.toLowerCase() === normalizedName
    || tag.attributes.property?.toLowerCase() === normalizedName
  ))?.attributes.content?.trim() ?? '';
}

export function getCanonical(html) {
  return findTags(html, 'link').find((tag) => (
    (tag.attributes.rel ?? '').toLowerCase().split(/\s+/).includes('canonical')
  ))?.attributes.href?.trim() ?? '';
}

export function getRobotsDirectives(html) {
  return findTags(html, 'meta')
    .filter((tag) => ['robots', 'yandex'].includes(tag.attributes.name?.toLowerCase()))
    .map((tag) => tag.attributes.content ?? '')
    .join(',')
    .toLowerCase();
}

export function isNoindex(html) {
  return getRobotsDirectives(html).split(/[\s,]+/).includes('noindex');
}

export function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

export function fileToPublicUrl(root, file) {
  const relative = relativePath(root, file);
  if (relative === 'index.html') return `${SITE_ORIGIN}/`;
  return `${SITE_ORIGIN}/${relative.replace(/\/index\.html$/, '/')}`;
}

export function decodeText(value = '') {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
