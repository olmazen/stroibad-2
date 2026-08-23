#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadProductSource,
  renderProductOutputs,
} from './product-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readExisting(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function syncProductData({ root = ROOT, write = false } = {}) {
  const source = await loadProductSource(root);
  const outputs = renderProductOutputs(source);
  const changes = [];

  for (const [rel, expected] of outputs) {
    const actual = await readExisting(path.join(root, rel));
    if (actual !== expected) changes.push({ rel, expected });
  }

  if (!write && changes.length) {
    const list = changes.map(({ rel }) => `  - ${rel}`).join('\n');
    throw new Error(`Generated product data is stale. Run npm run sync:data:\n${list}`);
  }

  if (write && changes.length) {
    const staged = [];
    try {
      for (const { rel, expected } of changes) {
        const target = path.join(root, rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temp = `${target}.tmp-${process.pid}`;
        await fs.writeFile(temp, expected);
        staged.push({ target, temp });
      }
      for (const { target, temp } of staged) await fs.rename(temp, target);
    } catch (error) {
      await Promise.all(staged.map(({ temp }) => fs.rm(temp, { force: true })));
      throw error;
    }
  }

  return {
    products: source.products.length,
    searchLandings: source.searchLandings.length,
    searchEntries: source.products.length + source.searchLandings.length,
    changedFiles: changes.map(({ rel }) => rel),
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const check = args.has('--check');
  if (write === check) throw new Error('Use exactly one of --write or --check');
  const result = await syncProductData({ write });
  console.log(
    `Product data: ${result.products} products + ${result.searchLandings} search landings = ` +
    `${result.searchEntries} search entries; changedFiles=${result.changedFiles.length}`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
