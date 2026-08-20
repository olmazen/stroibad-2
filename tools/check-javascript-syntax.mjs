#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skippedDirectories = new Set(['.git', '.private', 'dist', 'node_modules']);

async function walk(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute, rel));
    else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(rel);
  }
  return files;
}

const files = await walk(root);
for (const rel of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, rel)], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe'
    });
  } catch (error) {
    const details = error.stderr || error.stdout || error.message;
    throw new Error(`${rel}: JavaScript syntax check failed\n${details}`);
  }
}

console.log(JSON.stringify({ checkedJavaScriptFiles: files.length }, null, 2));
