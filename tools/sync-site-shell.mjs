#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FOOTER_END,
  FOOTER_START,
  HEADER_END,
  HEADER_START,
  loadSiteShellData,
  renderSiteFooter,
  renderSiteHeader
} from './site-shell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_PATH = path.join(ROOT, 'config', 'site-contract.json');
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');

function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isExcluded(rel, contract) {
  const basename = path.posix.basename(rel);
  if (contract.build.excludedFileNames.includes(basename)) return true;
  return contract.build.excludedPaths.some((entry) => rel === entry || rel.startsWith(`${entry}/`));
}

async function walkPublicHtml(contract) {
  const roots = [
    ...contract.build.rootFiles.filter((entry) => entry.endsWith('.html')),
    ...contract.build.publicDirectories,
    ...contract.build.legacyPublicDirectories
  ];
  const files = [];

  async function walk(rel) {
    if (isExcluded(rel, contract)) return;
    const absolute = path.join(ROOT, rel);
    const stat = await fs.lstat(absolute);
    if (stat.isDirectory()) {
      const entries = (await fs.readdir(absolute, { withFileTypes: true })).sort((a, b) => compareNames(a.name, b.name));
      for (const entry of entries) await walk(toPosix(path.join(rel, entry.name)));
    } else if (stat.isFile() && rel.endsWith('.html')) {
      files.push(rel);
    }
  }

  for (const entry of roots) await walk(entry);
  return [...new Set(files)].sort(compareNames);
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function markedRange(html, startMarker, endMarker, label, pageRel) {
  const startCount = count(html, startMarker);
  const endCount = count(html, endMarker);
  if (startCount === 0 && endCount === 0) return null;
  if (startCount !== 1 || endCount !== 1) {
    throw new Error(`${pageRel}: expected exactly one ${label} marker pair, got ${startCount}/${endCount}`);
  }
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start) + endMarker.length;
  if (end <= start) throw new Error(`${pageRel}: invalid ${label} marker order`);
  return { start, end };
}

function findLegacyHeaderRange(html, pageRel) {
  const start = html.indexOf('<div class="topbar"');
  const close = html.indexOf('</header>', start);
  if (start < 0 || close < 0) throw new Error(`${pageRel}: legacy site header boundary not found`);
  return { start, end: close + '</header>'.length };
}

function findLegacyFooterRange(html, pageRel) {
  const start = html.indexOf('<footer>');
  const close = html.indexOf('</footer>', start);
  if (start < 0 || close < 0) throw new Error(`${pageRel}: legacy site footer boundary not found`);
  const fragment = html.slice(start, close + '</footer>'.length);
  if (!fragment.includes('class="foot-grid"') || !fragment.includes('class="foot-bot"')) {
    throw new Error(`${pageRel}: selected footer is not the common site footer`);
  }
  return { start, end: close + '</footer>'.length };
}

function findBrokenFooterRange(html, pageRel, repairPages) {
  if (!repairPages.has(pageRel)) return null;
  if (html.includes('<footer>') || html.includes('</main>')) {
    throw new Error(`${pageRel}: expected the recorded broken footer shape, but page structure changed`);
  }
  const relatedSectionStart = html.lastIndexOf('<section style="padding-top:0">');
  const tilesStart = html.indexOf('<div class="tiles3">', relatedSectionStart);
  const tilesLineEnd = html.indexOf('\n', tilesStart);
  const orphanFooterClose = html.indexOf('</footer>', tilesLineEnd);
  if (relatedSectionStart < 0 || tilesStart < 0 || tilesLineEnd < 0 || orphanFooterClose < 0) {
    throw new Error(`${pageRel}: broken footer repair boundaries not found`);
  }
  const orphan = html.slice(tilesLineEnd + 1, orphanFooterClose);
  if (!orphan.includes('class="foot-col-h"') || !orphan.includes('class="foot-bot"')) {
    throw new Error(`${pageRel}: broken footer fragment does not match the audited shape`);
  }
  return {
    start: tilesLineEnd + 1,
    end: orphanFooterClose + '</footer>'.length,
    insertBrokenClosures: true
  };
}

function shellRanges(html, pageRel, repairPages) {
  const header = markedRange(html, HEADER_START, HEADER_END, 'header', pageRel)
    ?? findLegacyHeaderRange(html, pageRel);
  const markedFooter = markedRange(html, FOOTER_START, FOOTER_END, 'footer', pageRel);
  const footer = markedFooter
    ?? findBrokenFooterRange(html, pageRel, repairPages)
    ?? findLegacyFooterRange(html, pageRel);
  if (header.end >= footer.start) throw new Error(`${pageRel}: header/footer ranges overlap`);
  return { header, footer };
}

export function renderUpdatedHtml(original, pageRel, data, repairPages = new Set()) {
  const { header, footer } = shellRanges(original, pageRel, repairPages);
  const between = original.slice(header.end, footer.start);
  const repairedClosures = footer.insertBrokenClosures
    ? '  </div>\n</section>\n\n</main>\n\n'
    : '';
  return original.slice(0, header.start)
    + renderSiteHeader(data, pageRel)
    + between
    + repairedClosures
    + renderSiteFooter(data, pageRel)
    + original.slice(footer.end);
}

export function assertSyncedStructure(html, pageRel, pagesWithoutMain = new Set()) {
  const requirements = [
    [HEADER_START, 1],
    [HEADER_END, 1],
    [FOOTER_START, 1],
    [FOOTER_END, 1],
    ['data-site-header', 1],
    ['data-site-footer', 1],
    ['id="siteHeader"', 1],
    ['id="nav"', 1],
    ['class="foot-grid"', 1],
    ['class="foot-bot"', 1]
  ];
  for (const [token, expected] of requirements) {
    const actual = count(html, token);
    if (actual !== expected) throw new Error(`${pageRel}: expected ${expected} occurrence(s) of ${token}, got ${actual}`);
  }
  const mainOpen = (html.match(/<main(?:\s[^>]*)?>/g) ?? []).length;
  const mainClose = count(html, '</main>');
  const expectedMain = pagesWithoutMain.has(pageRel) ? 0 : 1;
  if (mainOpen !== expectedMain || mainClose !== expectedMain) {
    throw new Error(`${pageRel}: unbalanced main element ${mainOpen}/${mainClose}, expected ${expectedMain}`);
  }
}

async function main() {
  if (WRITE === CHECK) throw new Error('Choose exactly one mode: --write or --check');
  const [contract, data] = await Promise.all([
    fs.readFile(CONTRACT_PATH, 'utf8').then(JSON.parse),
    loadSiteShellData()
  ]);
  const files = await walkPublicHtml(contract);
  const excluded = new Set(contract.siteShell.excludedPages);
  const repairPages = new Set(contract.siteShell.legacyBrokenFooterPages);
  const pagesWithoutMain = new Set(contract.siteShell.pagesWithoutMain);
  const shellPages = files.filter((rel) => !excluded.has(rel));
  const unknownExcluded = [...excluded].filter((rel) => !files.includes(rel));
  if (unknownExcluded.length) throw new Error(`Unknown site shell exclusions: ${unknownExcluded.join(', ')}`);
  if (shellPages.length !== contract.siteShell.expectedPages) {
    throw new Error(`Expected ${contract.siteShell.expectedPages} shell pages, found ${shellPages.length}`);
  }

  const changed = [];
  const repaired = [];
  const pendingWrites = [];
  for (const pageRel of shellPages) {
    const absolute = path.join(ROOT, pageRel);
    const original = await fs.readFile(absolute, 'utf8');
    const wasBroken = repairPages.has(pageRel) && !original.includes(FOOTER_START);
    const updated = renderUpdatedHtml(original, pageRel, data, repairPages);
    assertSyncedStructure(updated, pageRel, pagesWithoutMain);
    if (updated !== original) {
      changed.push(pageRel);
      if (wasBroken) repaired.push(pageRel);
      if (WRITE) pendingWrites.push({ absolute, updated });
    }
  }

  if (WRITE && pendingWrites.length) {
    const staged = pendingWrites.map((entry, index) => ({
      ...entry,
      temporary: `${entry.absolute}.site-shell-${process.pid}-${index}.tmp`
    }));
    try {
      for (const entry of staged) {
        await fs.writeFile(entry.temporary, entry.updated, { flag: 'wx' });
      }
      for (const entry of staged) await fs.rename(entry.temporary, entry.absolute);
    } finally {
      await Promise.all(staged.map((entry) => fs.rm(entry.temporary, { force: true })));
    }
  }

  const result = {
    mode: WRITE ? 'write' : 'check',
    publicHtmlFiles: files.length,
    shellPages: shellPages.length,
    excludedPages: excluded.size,
    changedPages: changed.length,
    repairedLegacyPages: repaired.length,
    examples: changed.slice(0, 12)
  };
  console.log(JSON.stringify(result, null, 2));
  if (CHECK && changed.length) process.exitCode = 1;
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) await main();
