#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const checks = [
  ['seo-audit.mjs', '--strict'],
  ['build-sitemap.mjs', '--check'],
  ['normalize-public-urls.mjs', '--check']
];

for (const [script, ...args] of checks) {
  console.log(`\n> public SEO check: ${script} ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'tools', script), ...args], {
    cwd: DIST,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nPublic SEO checks passed.');
