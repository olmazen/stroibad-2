#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const CONTRACT_PATH = path.join(ROOT, 'config', 'site-contract.json');

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function compareNames(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function assertSafeDistPath() {
  if (path.dirname(DIST) !== ROOT || path.basename(DIST) !== 'dist') {
    throw new Error(`Refusing to clean unsafe output path: ${DIST}`);
  }
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readContract() {
  const raw = await fs.readFile(CONTRACT_PATH, 'utf8');
  const contract = JSON.parse(raw);
  if (contract.schemaVersion !== 1) {
    throw new Error(`Unsupported site contract version: ${contract.schemaVersion}`);
  }
  return contract;
}

function isExcluded(rel, contract) {
  const normalized = toPosix(rel).replace(/^\.\//, '');
  const basename = path.posix.basename(normalized);
  if (contract.build.excludedFileNames.includes(basename)) return true;
  return contract.build.excludedPaths.some((entry) => (
    normalized === entry || normalized.startsWith(`${entry}/`)
  ));
}

async function copyTree(sourceRel, targetRel, contract) {
  const source = path.join(ROOT, sourceRel);
  const target = path.join(DIST, targetRel);
  const stat = await fs.lstat(source);

  if (stat.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed in the public artifact: ${sourceRel}`);
  }

  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });
    entries.sort(compareNames);
    for (const entry of entries) {
      const childSource = toPosix(path.join(sourceRel, entry.name));
      const childTarget = toPosix(path.join(targetRel, entry.name));
      if (isExcluded(childSource, contract)) continue;
      await copyTree(childSource, childTarget, contract);
    }
    return;
  }

  if (!stat.isFile()) {
    throw new Error(`Unsupported public filesystem entry: ${sourceRel}`);
  }

  const normalizedSource = toPosix(sourceRel);
  const isRootFile = contract.build.rootFiles.includes(normalizedSource);
  const extension = path.extname(normalizedSource).toLowerCase();
  if (!isRootFile && !contract.build.allowedExtensions.includes(extension)) {
    throw new Error(`File type is not allowed in public artifact: ${sourceRel}`);
  }
  if (extension === '.json' && !contract.build.allowedJsonFiles.includes(normalizedSource)) {
    throw new Error(`JSON file is not explicitly allowed in public artifact: ${sourceRel}`);
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function walkFiles(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort(compareNames);
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute, rel));
    else if (entry.isFile()) files.push(rel);
    else throw new Error(`Unsupported entry in dist: ${rel}`);
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

function git(args, fallback = 'unknown') {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
}

async function writeReleaseManifest() {
  const paths = (await walkFiles(DIST)).filter((rel) => rel !== 'release.json');
  const files = [];
  let totalBytes = 0;
  for (const rel of paths) {
    const info = await hashFile(path.join(DIST, rel));
    totalBytes += info.bytes;
    files.push({ path: rel, ...info });
  }

  const artifactInput = files
    .map((file) => `${file.path}\0${file.sha256}\0${file.bytes}\n`)
    .join('');
  const sourceStatus = git(['status', '--porcelain', '--untracked-files=normal'], '');
  const release = {
    schemaVersion: 1,
    source: {
      commit: git(['rev-parse', 'HEAD']),
      commitTime: git(['show', '-s', '--format=%cI', 'HEAD']),
      dirty: Boolean(sourceStatus)
    },
    artifact: {
      profile: 'public',
      sha256: createHash('sha256').update(artifactInput).digest('hex'),
      fileCount: files.length,
      totalBytes
    },
    files
  };
  await fs.writeFile(path.join(DIST, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  return release;
}

async function main() {
  const contract = await readContract();
  assertSafeDistPath();
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  for (const file of contract.build.rootFiles) {
    if (!await pathExists(path.join(ROOT, file))) {
      throw new Error(`Required public root file does not exist: ${file}`);
    }
    await copyTree(file, file, contract);
  }

  for (const dir of [
    ...contract.build.publicDirectories,
    ...contract.build.legacyPublicDirectories
  ]) {
    if (!await pathExists(path.join(ROOT, dir))) {
      throw new Error(`Allowlisted public directory does not exist: ${dir}`);
    }
    await copyTree(dir, dir, contract);
  }

  const release = await writeReleaseManifest();
  console.log(
    `Built dist: ${release.artifact.fileCount} files, ` +
    `${release.artifact.totalBytes} bytes, sha256 ${release.artifact.sha256}`
  );
}

await main();
