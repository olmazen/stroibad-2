#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_PHP_PATHS = new Set([
  'api/leads/index.php',
  'api/leads/lib/leadbackend.php',
  'api/leads/lib/dailyanalytics.php',
  'api/leads/cli/leads.php',
  'api/leads/cli/daily-report.php'
]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = { dir: 'dist', commit: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dir') args.dir = argv[++index] ?? '';
    else if (value === '--commit') args.commit = argv[++index] ?? '';
    else fail(`Unknown argument: ${value}`);
  }
  if (!args.dir) fail('--dir is required');
  if (!/^[0-9a-f]{40}$/i.test(args.commit)) fail('--commit must be a full 40-character SHA');
  return args;
}

function assertSafeRelativePath(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail(`Unsafe artifact path: ${String(value)}`);
  }
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) {
    fail(`Unsafe artifact path: ${value}`);
  }
  if (value.split('/').includes('..')) fail(`Unsafe artifact path: ${value}`);
}

function assertReleasePathPolicy(value) {
  const segments = value.split('/');
  const lower = segments.map((segment) => segment.toLowerCase());
  const basename = lower.at(-1);
  const root = lower[0];
  const normalizedLower = lower.join('/');

  if (basename === '.env' || basename?.startsWith('.env.')) {
    fail(`Persistent secret/config file is forbidden in release: ${value}`);
  }
  if (['.git', '.github', '.private', 'shared', 'state', 'storage', 'runtime'].includes(root)) {
    fail(`Persistent or private root is forbidden in release: ${value}`);
  }
  if (root === 'api' && lower.slice(1, -1).some((segment) => ['config', 'state', 'storage', 'runtime'].includes(segment))) {
    fail(`Persistent API path is forbidden in release: ${value}`);
  }
  if (
    root === 'api'
    && (basename === 'secrets.php' || /^config(?:[._-].*)?\.php$/.test(basename || ''))
  ) {
    fail(`Persistent API configuration is forbidden in release: ${value}`);
  }
  if (basename?.endsWith('.php') && !ALLOWED_PHP_PATHS.has(normalizedLower)) {
    fail(`PHP file is not explicitly allowed in release: ${value}`);
  }
}

async function walkFiles(root, dir = root, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((left, right) => (
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  ));
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    assertSafeRelativePath(relative);
    const absolute = path.join(dir, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) fail(`Symlink is forbidden in artifact: ${relative}`);
    if (stat.isDirectory()) files.push(...await walkFiles(root, absolute, relative));
    else if (stat.isFile()) files.push(relative);
    else fail(`Unsupported artifact entry: ${relative}`);
  }
  return files;
}

async function hashFile(file) {
  const body = await fs.readFile(file);
  return {
    bytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex')
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.dir);
  const manifestPath = path.join(root, 'release.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  if (manifest.schemaVersion !== 1) fail(`Unsupported release schema: ${manifest.schemaVersion}`);
  if (manifest.source?.commit !== args.commit) {
    fail(`Artifact commit ${manifest.source?.commit ?? 'missing'} does not match ${args.commit}`);
  }
  if (manifest.source?.dirty !== false) fail('Artifact was produced from a dirty worktree');
  if (!Array.isArray(manifest.files)) fail('release.json files must be an array');

  const actualPaths = (await walkFiles(root)).filter((item) => item !== 'release.json');
  const listed = new Map();
  for (const entry of manifest.files) {
    assertSafeRelativePath(entry?.path);
    assertReleasePathPolicy(entry.path);
    if (listed.has(entry.path)) fail(`Duplicate manifest path: ${entry.path}`);
    listed.set(entry.path, entry);
  }
  if (listed.size !== actualPaths.length) {
    fail(`File count mismatch: manifest ${listed.size}, artifact ${actualPaths.length}`);
  }

  let totalBytes = 0;
  const normalized = [];
  for (const relative of actualPaths) {
    const expected = listed.get(relative);
    if (!expected) fail(`release.json omits ${relative}`);
    const actual = await hashFile(path.join(root, relative));
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      fail(`Hash or size mismatch: ${relative}`);
    }
    totalBytes += actual.bytes;
    normalized.push({ path: relative, ...actual });
  }
  for (const relative of listed.keys()) {
    if (!actualPaths.includes(relative)) fail(`release.json lists missing file: ${relative}`);
  }

  const artifactInput = normalized
    .map((file) => `${file.path}\0${file.sha256}\0${file.bytes}\n`)
    .join('');
  const artifactSha256 = createHash('sha256').update(artifactInput).digest('hex');
  if (manifest.artifact?.sha256 !== artifactSha256) fail('Artifact aggregate SHA-256 mismatch');
  if (manifest.artifact?.fileCount !== actualPaths.length) fail('Artifact fileCount mismatch');
  if (manifest.artifact?.totalBytes !== totalBytes) fail('Artifact totalBytes mismatch');

  console.log(JSON.stringify({
    commit: args.commit,
    artifactSha256,
    fileCount: actualPaths.length,
    totalBytes
  }));
}

await main();
