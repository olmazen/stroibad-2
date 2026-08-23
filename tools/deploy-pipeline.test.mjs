import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(ROOT, 'tools', 'verify-release-artifact.mjs');
const COMMIT = '1234567890abcdef1234567890abcdef12345678';

async function fileInfo(file) {
  const body = await fs.readFile(file);
  return {
    bytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex')
  };
}

async function createRelease(root, entries) {
  const files = [];
  for (const [relative, body] of Object.entries(entries)) {
    const absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, body);
  }
  for (const relative of Object.keys(entries).sort()) {
    files.push({ path: relative, ...await fileInfo(path.join(root, relative)) });
  }
  const artifactInput = files
    .map((file) => `${file.path}\0${file.sha256}\0${file.bytes}\n`)
    .join('');
  const manifest = {
    schemaVersion: 1,
    source: { commit: COMMIT, dirty: false },
    artifact: {
      profile: 'public',
      sha256: createHash('sha256').update(artifactInput).digest('hex'),
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0)
    },
    files
  };
  await fs.writeFile(path.join(root, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function verify(root) {
  return execute(process.execPath, [VERIFY, '--dir', root, '--commit', COMMIT], { cwd: ROOT });
}

test('release verifier accepts immutable PHP code but keeps persistent config outside releases', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-release-test-'));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await createRelease(temporaryRoot, {
    '.htaccess': 'Options -Indexes\n',
    'api/leads/index.php': '<?php declare(strict_types=1); echo "ok";\n',
    'index.html': '<!doctype html><title>EGOE</title>\n'
  });
  const result = await verify(temporaryRoot);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.commit, COMMIT);
  assert.equal(summary.fileCount, 3);
});

test('release verifier rejects every PHP path outside the three-file backend allowlist', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-release-php-path-test-'));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await createRelease(temporaryRoot, {
    'assets/unexpected.php': '<?php echo "must not ship";\n',
    'index.html': '<!doctype html><title>EGOE</title>\n'
  });
  await assert.rejects(verify(temporaryRoot), (error) => {
    assert.match(String(error.stderr), /PHP file is not explicitly allowed/);
    return true;
  });
});

test('release verifier rejects persistent API configuration in an artifact', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-release-secret-test-'));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await createRelease(temporaryRoot, {
    'api/config.php': '<?php return ["secret" => "must-not-ship"];\n',
    'index.html': '<!doctype html><title>EGOE</title>\n'
  });
  await assert.rejects(verify(temporaryRoot), (error) => {
    assert.match(String(error.stderr), /Persistent API configuration is forbidden/);
    return true;
  });
});

test('release verifier rejects mutation and symlinks', async (t) => {
  const mutatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-release-mutation-test-'));
  const linkedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-release-link-test-'));
  t.after(() => Promise.all([
    fs.rm(mutatedRoot, { recursive: true, force: true }),
    fs.rm(linkedRoot, { recursive: true, force: true })
  ]));

  await createRelease(mutatedRoot, { 'index.html': '<title>before</title>\n' });
  await fs.writeFile(path.join(mutatedRoot, 'index.html'), '<title>after</title>\n');
  await assert.rejects(verify(mutatedRoot), (error) => {
    assert.match(String(error.stderr), /Hash or size mismatch/);
    return true;
  });

  await createRelease(linkedRoot, { 'index.html': '<title>safe</title>\n' });
  await fs.symlink('index.html', path.join(linkedRoot, 'linked.html'));
  await assert.rejects(verify(linkedRoot), (error) => {
    assert.match(String(error.stderr), /Symlink is forbidden/);
    return true;
  });
});

test('deployment workflows pin actions and preserve exact staging provenance', async () => {
  const pages = await fs.readFile(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  const production = await fs.readFile(path.join(ROOT, '.github', 'workflows', 'deploy-production.yml'), 'utf8');
  const prepare = await fs.readFile(path.join(ROOT, '.github', 'workflows', 'prepare-release.yml'), 'utf8');
  const quality = await fs.readFile(path.join(ROOT, '.github', 'workflows', 'site-quality.yml'), 'utf8');
  const trustedPins = new Map([
    ['actions/checkout', '11bd71901bbe5b1630ceea73d27597364c9af683'],
    ['actions/setup-node', '49933ea5288caeca8642d1e84afbd3f7d6820020'],
    ['actions/upload-artifact', 'ea165f8d65b6e75b540449e92b4886f43607fa02'],
    ['actions/download-artifact', 'd3f86a106a0bac45b974a628896c90dbdf5c8093'],
    ['actions/configure-pages', '983d7736d9b0ae728b81ab479565c72886d7745b'],
    ['actions/upload-pages-artifact', '56afc609e74202658d3ffba0e8f6dda462b719fa'],
    ['actions/deploy-pages', 'd6db90164ac5ed86f2b6aed7e0febac5b3c0c03e'],
    ['shivammathur/setup-php', 'f3e473d116dcccaddc5834248c87452386958240']
  ]);
  for (const [name, workflow] of [
    ['pages', pages],
    ['production', production],
    ['prepare-release', prepare],
    ['site-quality', quality]
  ]) {
    for (const line of workflow.split('\n').filter((item) => /^\s*uses:/.test(item))) {
      const action = line.match(/uses:\s*([^@\s]+)/)?.[1] || '';
      const reference = line.match(/@([^\s#]+)/)?.[1] || '';
      assert.match(reference, /^[0-9a-f]{40}$/, `${name}: action is not pinned: ${line.trim()}`);
      assert.equal(reference, trustedPins.get(action), `${name}: unreviewed pin for ${action}`);
    }
  }

  assert.match(pages, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(pages, /GITHUB_REF" != "refs\/heads\/main"/);
  assert.match(pages, /name: egoe-release-\$\{\{ steps\.source\.outputs\.sha \}\}/);
  assert.match(pages, /include-hidden-files: true/);
  assert.match(production, /test "\$EXPECTED_SHA" = "\$GITHUB_SHA"/);
  assert.doesNotMatch(production, /git merge-base --is-ancestor/);
  assert.equal((production.match(/ref: \$\{\{ github\.sha \}\}/g) || []).length, 2);
  assert.doesNotMatch(production, /npm run (?:build|check)/);
  assert.match(production, /timeout-minutes: 30/);
  assert.match(production, /timeout-minutes: 45/);
  assert.match(production, /run\.path !== '\.github\/workflows\/pages\.yml'/);
  assert.doesNotMatch(production, /prepare-release\.yml/);

  for (const [name, workflow] of [
    ['pages', pages],
    ['production', production],
    ['prepare-release', prepare],
    ['site-quality', quality]
  ]) {
    assert.match(workflow, /persist-credentials: false/, `${name}: checkout credentials must not persist`);
  }

  assert.match(prepare, /name: Prepare archive-only artifact \(not production\)/);
  assert.match(prepare, /name: egoe-archive-only-\$\{\{ steps\.source\.outputs\.sha \}\}/);
  assert.doesNotMatch(prepare, /name: egoe-release-/);
  assert.match(prepare, /production accepts only the artifact from a successful Pages run on main/i);
  assert.match(prepare, /include-hidden-files: true/);
  assert.match(quality, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(quality, /include-hidden-files: true/);
});

test('initial rollback baseline is fail-closed and contains no data-collection surface', async () => {
  const html = await fs.readFile(path.join(ROOT, 'ops', 'deploy', 'safe-baseline', 'index.html'), 'utf8');
  const apache = await fs.readFile(path.join(ROOT, 'ops', 'deploy', 'safe-baseline', '.htaccess'), 'utf8');
  assert.doesNotMatch(html, /<form\b|<script\b|https?:\/\/|<iframe\b|localStorage|sessionStorage/i);
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(apache, /Options -Indexes -MultiViews/);
  assert.match(apache, /X-Content-Type-Options "nosniff"/);
});

test('production smoke and remote helper contain rollback hardening', async () => {
  const production = await fs.readFile(path.join(ROOT, '.github', 'workflows', 'deploy-production.yml'), 'utf8');
  const remote = await fs.readFile(path.join(ROOT, 'ops', 'deploy', 'remote-release.sh'), 'utf8');
  await execute('/bin/sh', ['-n', path.join(ROOT, 'ops', 'deploy', 'remote-release.sh')]);

  assert.match(production, /\/maf\/skamejki\/artdeco-a1-101\//);
  assert.match(production, /egoe_deploy=\$smoke_token/);
  assert.match(production, /StrictHostKeyChecking=yes/);
  assert.match(production, /PasswordAuthentication=no/);
  assert.match(production, /test -L "\$deploy_root\/current"/);
  assert.match(production, /PHP_VERSION_ID >= 80200/);
  assert.match(production, /extension_loaded\("pdo_sqlite"\)/);
  assert.match(production, /api\/leads\//);
  assert.match(production, /METHOD_NOT_ALLOWED/);
  assert.match(production, /x-content-type-options/);
  assert.match(production, /strict-transport-security/);
  assert.match(production, /api\/leads\/index\.php/);
  assert.match(production, /api\/leads\/index\.php\/anything/);
  assert.match(production, /api\/leads\/lib\/LeadBackend\.php/);
  assert.match(production, /api\/leads\/cli\/leads\.php/);
  assert.match(remote, /flock -n 9/);
  assert.match(remote, /Deployment lock must not be a symlink/);
  assert.match(remote, /PHP_VERSION_ID >= 80200/);
  assert.match(remote, /extension_loaded\("pdo_sqlite"\)/);
  assert.match(remote, /lead_cli/);
  assert.match(remote, /relayEnabled/);
  assert.match(remote, /schemaVersion"] \?\? null\) === 2/);
  assert.match(remote, /api\/leads\/lib\/leadbackend\.php/);
  assert.match(remote, /str_ends_with\(\$basename, "\.php"\)/);
  assert.match(remote, /verify_release_tree "\$final_release" "\$expected_sha"/);
  assert.match(remote, /cmp "\$temporary_release\/release\.json" "\$final_release\/release\.json"/);
  assert.match(remote, /lint_php_tree "\$final_release"/);
  assert.match(remote, /for persistent_directory in incoming releases shared state/);
  assert.match(remote, /deploy_root\/shared\/leads/);
  assert.match(remote, /Current baseline symlink is required before production deployment/);
  assert.match(remote, /Previous release directory must not be a symlink/);
});
