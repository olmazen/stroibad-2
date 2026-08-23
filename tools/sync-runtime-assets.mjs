#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_PATH = path.join(ROOT, 'config/site-contract.json');
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');
const LEGACY_LEAD_SUBMIT = 'onsubmit="return submitLead(this)"';
const SAFE_LEAD_SUBMIT = 'onsubmit="return window.EGOE_LEADS ? window.EGOE_LEADS.submitForm(this) : false"';

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
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
      const entries = (await fs.readdir(absolute, { withFileTypes: true }))
        .sort((a, b) => compareNames(a.name, b.name));
      for (const entry of entries) await walk(toPosix(path.join(rel, entry.name)));
    } else if (stat.isFile() && rel.endsWith('.html')) {
      files.push(rel);
    }
  }

  for (const entry of roots) await walk(entry);
  return [...new Set(files)].sort(compareNames);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function revisionPattern(assetPath) {
  return new RegExp(
    `(^|\\s)(href|src)=(["'])((?:\\.\\.\\/)*${escapeRegExp(assetPath)})(?:\\?[^"']*)?\\3`,
    'gm'
  );
}

export function applyRevision(html, assetPath, revision) {
  let matches = 0;
  const updated = html.replace(revisionPattern(assetPath), (whole, prefix, attr, quote, relativePath) => {
    matches += 1;
    return `${prefix}${attr}=${quote}${relativePath}?v=${revision}${quote}`;
  });
  return { updated, matches };
}

export function insertScriptAfter(html, assetPath, anchorPath, revision) {
  let matches = 0;
  const anchor = new RegExp(
    `(<script\\b[^>]*\\bsrc=(["'])((?:\\.\\.\\/)*${escapeRegExp(anchorPath)})(?:\\?[^"']*)?\\2[^>]*>\\s*</script>)`,
    'gm'
  );
  const updated = html.replace(anchor, (whole, tag, quote, relativeAnchor) => {
    matches += 1;
    const prefix = relativeAnchor.slice(0, relativeAnchor.length - anchorPath.length);
    return `${tag}\n<script src=${quote}${prefix}${assetPath}?v=${revision}${quote}></script>`;
  });
  return { updated, matches };
}

async function contentRevision(assetPath) {
  const body = await fs.readFile(path.join(ROOT, assetPath));
  return createHash('sha256').update(body).digest('hex').slice(0, 12);
}

async function main() {
  if (WRITE === CHECK) throw new Error('Choose exactly one mode: --write or --check');
  const contract = JSON.parse(await fs.readFile(CONTRACT_PATH, 'utf8'));
  const assets = contract.runtime?.assetRevisions;
  if (!Array.isArray(assets) || !assets.length) throw new Error('runtime.assetRevisions is missing');

  const publicHtml = await walkPublicHtml(contract);
  const publicHtmlSet = new Set(publicHtml);
  const excluded = new Set(contract.siteShell.excludedPages);
  const pages = publicHtml.filter((rel) => !excluded.has(rel));
  if (pages.length !== contract.siteShell.expectedPages) {
    throw new Error(`Expected ${contract.siteShell.expectedPages} runtime pages, found ${pages.length}`);
  }

  const revisions = new Map();
  const targetPages = new Map();
  for (const asset of assets) {
    if (!/^assets\/(?:css|js)\/[a-z0-9._/-]+$/i.test(asset.path) || asset.path.includes('..')) {
      throw new Error(`Unsafe runtime asset path: ${asset.path}`);
    }
    if (!Number.isInteger(asset.expectedPages) || asset.expectedPages < 1) {
      throw new Error(`Invalid expectedPages for ${asset.path}`);
    }
    if (asset.insertAfter && (!/^assets\/js\/[a-z0-9._/-]+$/i.test(asset.insertAfter) || asset.insertAfter.includes('..'))) {
      throw new Error(`Unsafe runtime insertion anchor: ${asset.insertAfter}`);
    }
    const configuredPages = asset.pages == null ? pages : asset.pages;
    if (!Array.isArray(configuredPages) || !configuredPages.length || new Set(configuredPages).size !== configuredPages.length) {
      throw new Error(`Invalid target pages for ${asset.path}`);
    }
    for (const rel of configuredPages) {
      if (typeof rel !== 'string' || rel.includes('..') || !publicHtmlSet.has(rel)) {
        throw new Error(`Unsafe or non-public target page for ${asset.path}: ${rel}`);
      }
    }
    targetPages.set(asset.path, new Set(configuredPages));
    revisions.set(asset.path, await contentRevision(asset.path));
  }

  const totals = new Map(assets.map((asset) => [asset.path, 0]));
  let safeLeadForms = 0;
  const changed = [];
  const pendingWrites = [];
  const scannedPages = [...new Set(assets.flatMap((asset) => [...targetPages.get(asset.path)]))].sort(compareNames);
  for (const rel of scannedPages) {
    const absolute = path.join(ROOT, rel);
    const original = await fs.readFile(absolute, 'utf8');
    let updated = original.split(LEGACY_LEAD_SUBMIT).join(SAFE_LEAD_SUBMIT);
    for (const asset of assets) {
      if (!targetPages.get(asset.path).has(rel)) continue;
      let result = applyRevision(updated, asset.path, revisions.get(asset.path));
      if (result.matches === 0 && WRITE && asset.insertAfter) {
        result = insertScriptAfter(updated, asset.path, asset.insertAfter, revisions.get(asset.path));
      }
      if (result.matches > 1) throw new Error(`${rel}: duplicate reference to ${asset.path}`);
      totals.set(asset.path, totals.get(asset.path) + result.matches);
      updated = result.updated;
    }
    safeLeadForms += updated.split(SAFE_LEAD_SUBMIT).length - 1;
    if (updated !== original) {
      changed.push(rel);
      if (WRITE) pendingWrites.push({ absolute, updated });
    }
  }

  for (const asset of assets) {
    const actual = totals.get(asset.path);
    if (actual !== asset.expectedPages) {
      throw new Error(`${asset.path}: expected ${asset.expectedPages} page references, found ${actual}`);
    }
  }
  if (safeLeadForms !== contract.leadDelivery.standardForms) {
    throw new Error(`Expected ${contract.leadDelivery.standardForms} fail-closed lead forms, found ${safeLeadForms}`);
  }

  if (WRITE && pendingWrites.length) {
    const staged = pendingWrites.map((entry, index) => ({
      ...entry,
      temporary: `${entry.absolute}.runtime-assets-${process.pid}-${index}.tmp`
    }));
    try {
      for (const entry of staged) await fs.writeFile(entry.temporary, entry.updated, { flag: 'wx' });
      for (const entry of staged) await fs.rename(entry.temporary, entry.absolute);
    } finally {
      await Promise.all(staged.map((entry) => fs.rm(entry.temporary, { force: true })));
    }
  }

  const result = {
    mode: WRITE ? 'write' : 'check',
    runtimePages: pages.length,
    scannedPages: scannedPages.length,
    failClosedLeadForms: safeLeadForms,
    changedPages: changed.length,
    assets: assets.map((asset) => ({
      path: asset.path,
      revision: revisions.get(asset.path),
      pages: totals.get(asset.path)
    })),
    examples: changed.slice(0, 12)
  };
  console.log(JSON.stringify(result, null, 2));
  if (CHECK && changed.length) process.exitCode = 1;
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) await main();
