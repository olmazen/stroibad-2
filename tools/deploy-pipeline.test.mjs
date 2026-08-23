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
const BOOTSTRAP = path.join(ROOT, 'ops', 'deploy', 'bootstrap-production.sh');
const PHP = process.env.EGOE_PHP_BIN || 'php';
const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const RETRY_COMMIT = 'abcdef1234567890abcdef1234567890abcdef12';

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

async function runBootstrap(fixture, action, ...args) {
  return execute('/bin/sh', [BOOTSTRAP, action, fixture.deployRoot, ...args], {
    cwd: ROOT,
    env: fixture.env
  });
}

async function stageBaseline(fixture, stageToken) {
  await runBootstrap(fixture, 'stage', stageToken);
  const stageRoot = path.join(fixture.deployRoot, 'incoming', `bootstrap-${stageToken}`);
  await fs.copyFile(
    path.join(ROOT, 'ops', 'deploy', 'safe-baseline', 'index.html'),
    path.join(stageRoot, 'index.html')
  );
  await fs.copyFile(
    path.join(ROOT, 'ops', 'deploy', 'safe-baseline', '.htaccess'),
    path.join(stageRoot, 'htaccess')
  );
}

async function createBootstrapFixture(t, suffix = '') {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `egoe-bootstrap-${suffix}`));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const deployRoot = path.join(temporary, 'egoe-deploy');
  const liveRoot = path.join(temporary, 'egoe-life.ru');
  const previousTarget = 'releases/baseline-20260823';
  const directories = [
    deployRoot,
    path.join(deployRoot, 'incoming'),
    path.join(deployRoot, 'releases'),
    path.join(deployRoot, 'shared'),
    path.join(deployRoot, 'shared', 'leads'),
    path.join(deployRoot, 'state'),
    path.join(deployRoot, previousTarget),
    liveRoot
  ];
  for (const directory of directories) await fs.mkdir(directory, { recursive: true, mode: 0o755 });
  await fs.chmod(path.join(deployRoot, 'shared', 'leads'), 0o700);
  await fs.writeFile(path.join(deployRoot, 'state', 'site-hostname'), 'egoe-life.ru\n', { mode: 0o600 });
  await fs.writeFile(path.join(deployRoot, previousTarget, 'index.html'), '<title>Previous safe baseline</title>\n');
  await fs.symlink(previousTarget, path.join(deployRoot, 'current'));
  await fs.writeFile(path.join(liveRoot, 'index.html'), '<title>Legacy physical site</title>\n');
  await fs.writeFile(path.join(liveRoot, 'legacy-proof.txt'), 'preserve exactly\n');

  const mockBin = path.join(temporary, 'bin');
  await fs.mkdir(mockBin, { mode: 0o700 });
  const mockFlock = path.join(mockBin, 'flock');
  await fs.writeFile(mockFlock, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.chmod(mockFlock, 0o700);
  const env = {
    ...process.env,
    EGOE_PHP_BIN: PHP,
    PATH: `${mockBin}:${process.env.PATH || '/usr/bin:/bin'}`
  };

  const baselineIndex = path.join(ROOT, 'ops', 'deploy', 'safe-baseline', 'index.html');
  const baselineHtaccess = path.join(ROOT, 'ops', 'deploy', 'safe-baseline', '.htaccess');
  const indexHash = (await fileInfo(baselineIndex)).sha256;
  const htaccessHash = (await fileInfo(baselineHtaccess)).sha256;
  const stageToken = '123456-1';
  const fixture = { temporary, deployRoot, liveRoot, previousTarget, env, indexHash, htaccessHash, stageToken };
  await stageBaseline(fixture, stageToken);
  return fixture;
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
  const bootstrap = await fs.readFile(path.join(ROOT, '.github', 'workflows', 'bootstrap-production.yml'), 'utf8');
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
    ['bootstrap', bootstrap],
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
  assert.match(bootstrap, /Verify successful Pages provenance/i);
  assert.match(bootstrap, /run\.path !== '\.github\/workflows\/pages\.yml'/);
  assert.match(bootstrap, /\[\[ "\$EXPECTED_SHA" != "\$GITHUB_SHA" \]\]/);
  assert.match(bootstrap, /environment:\s*\n\s*name: production/);
  assert.match(bootstrap, /group: egoe-production/);
  assert.match(bootstrap, /StrictHostKeyChecking yes/);
  assert.match(bootstrap, /PasswordAuthentication no/);
  assert.match(bootstrap, /continue-on-error: true/);
  assert.match(bootstrap, /steps\.smoke\.outcome == 'failure'/);
  assert.match(bootstrap, /sh -s -- enable/);
  assert.match(bootstrap, /collection-approved.*remains absent/);
  assert.doesNotMatch(bootstrap, /npm run (?:build|check)/);
  assert.ok(
    bootstrap.indexOf('Externally smoke-test safe baseline before enablement')
      < bootstrap.indexOf('Enable the existing production release workflow'),
    'production enablement must follow the external baseline smoke'
  );

  for (const [name, workflow] of [
    ['pages', pages],
    ['production', production],
    ['bootstrap', bootstrap],
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
  assert.match(apache, /Cache-Control "no-store, max-age=0"/);
  assert.match(apache, /Content-Security-Policy "default-src 'none'/);
  assert.match(apache, /X-Content-Type-Options "nosniff"/);
  assert.match(apache, /X-Robots-Tag "noindex, nofollow, noarchive"/);
  assert.match(apache, /Cross-Origin-Resource-Policy "same-origin"/);
});

test('one-time bootstrap rollback restores physical live and retains only the new safe current', async (t) => {
  const fixture = await createBootstrapFixture(t, 'rollback-');
  await runBootstrap(
    fixture,
    'prepare',
    COMMIT,
    fixture.indexHash,
    fixture.htaccessHash,
    fixture.stageToken
  );

  const expectedCurrent = `releases/safe-baseline-${COMMIT}`;
  const backup = path.join(fixture.deployRoot, 'legacy', 'physical-docroot-pre-rkn-20260823');
  assert.equal(await fs.readlink(path.join(fixture.deployRoot, 'current')), expectedCurrent);
  assert.equal(await fs.readlink(fixture.liveRoot), path.join(fixture.deployRoot, 'current'));
  assert.equal(await fs.readFile(path.join(backup, 'legacy-proof.txt'), 'utf8'), 'preserve exactly\n');
  assert.equal(
    await fs.readFile(path.join(fixture.deployRoot, 'state', 'bootstrap-plan'), 'utf8'),
    `${COMMIT}:NO_SAFE_PREVIOUS\n`
  );
  await assert.rejects(fs.lstat(path.join(fixture.deployRoot, 'state', 'production-enabled')), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(fixture.deployRoot, 'state', 'collection-approved')), { code: 'ENOENT' });
  await runBootstrap(fixture, 'verify', COMMIT, fixture.indexHash, fixture.htaccessHash, 'prepared');

  await runBootstrap(fixture, 'rollback', COMMIT, fixture.indexHash, fixture.htaccessHash);
  const restoredLive = await fs.lstat(fixture.liveRoot);
  assert.equal(restoredLive.isDirectory(), true);
  assert.equal(restoredLive.isSymbolicLink(), false);
  assert.equal(await fs.readFile(path.join(fixture.liveRoot, 'legacy-proof.txt'), 'utf8'), 'preserve exactly\n');
  assert.equal(await fs.readlink(path.join(fixture.deployRoot, 'current')), expectedCurrent);
  await assert.rejects(fs.lstat(path.join(fixture.deployRoot, 'state', 'production-enabled')), { code: 'ENOENT' });
});

test('bootstrap enable is separate, mode-hardened and never creates collection approval', async (t) => {
  const fixture = await createBootstrapFixture(t, 'enable-');
  await runBootstrap(
    fixture,
    'prepare',
    COMMIT,
    fixture.indexHash,
    fixture.htaccessHash,
    fixture.stageToken
  );

  await fs.chmod(path.join(fixture.deployRoot, 'state'), 0o777);
  await assert.rejects(
    runBootstrap(fixture, 'verify', COMMIT, fixture.indexHash, fixture.htaccessHash, 'prepared'),
    (error) => {
      assert.match(String(error.stderr), /not group\/world-writable/);
      return true;
    }
  );
  await fs.chmod(path.join(fixture.deployRoot, 'state'), 0o755);

  const bootstrapPlan = path.join(fixture.deployRoot, 'state', 'bootstrap-plan');
  await fs.chmod(bootstrapPlan, 0o666);
  await assert.rejects(
    runBootstrap(fixture, 'verify', COMMIT, fixture.indexHash, fixture.htaccessHash, 'prepared'),
    (error) => {
      assert.match(String(error.stderr), /Bootstrap plan must be owned.*not group\/world-writable/);
      return true;
    }
  );
  await fs.chmod(bootstrapPlan, 0o600);

  const collectionMarker = path.join(fixture.deployRoot, 'state', 'collection-approved');
  await fs.writeFile(collectionMarker, 'egoe-life.ru\n', { mode: 0o600 });
  await assert.rejects(
    runBootstrap(fixture, 'verify', COMMIT, fixture.indexHash, fixture.htaccessHash, 'prepared'),
    (error) => {
      assert.match(String(error.stderr), /Collection approval marker must be absent/);
      return true;
    }
  );
  await fs.unlink(collectionMarker);

  await runBootstrap(fixture, 'enable', COMMIT, fixture.indexHash, fixture.htaccessHash);
  const productionMarker = path.join(fixture.deployRoot, 'state', 'production-enabled');
  assert.equal(await fs.readFile(productionMarker, 'utf8'), 'egoe-life.ru\n');
  assert.equal((await fs.stat(productionMarker)).mode & 0o022, 0);
  await assert.rejects(fs.lstat(collectionMarker), { code: 'ENOENT' });
  await runBootstrap(fixture, 'verify', COMMIT, fixture.indexHash, fixture.htaccessHash, 'enabled');
  await assert.rejects(
    runBootstrap(fixture, 'rollback', COMMIT, fixture.indexHash, fixture.htaccessHash),
    (error) => {
      assert.match(String(error.stderr), /Production enable marker must be absent/);
      return true;
    }
  );
});

test('bootstrap checksum failure cannot move current or the physical document root', async (t) => {
  const fixture = await createBootstrapFixture(t, 'checksum-');
  await assert.rejects(
    runBootstrap(
      fixture,
      'prepare',
      COMMIT,
      '0'.repeat(64),
      fixture.htaccessHash,
      fixture.stageToken
    ),
    (error) => {
      assert.match(String(error.stderr), /checksum mismatch/);
      return true;
    }
  );
  const live = await fs.lstat(fixture.liveRoot);
  assert.equal(live.isDirectory(), true);
  assert.equal(live.isSymbolicLink(), false);
  assert.equal(await fs.readlink(path.join(fixture.deployRoot, 'current')), fixture.previousTarget);
  await assert.rejects(
    fs.lstat(path.join(fixture.deployRoot, 'legacy', 'physical-docroot-pre-rkn-20260823')),
    { code: 'ENOENT' }
  );
});

test('bootstrap rollback failure restores the safe live symlink and preserves the physical backup', async (t) => {
  const fixture = await createBootstrapFixture(t, 'rollback-failure-');
  await runBootstrap(
    fixture,
    'prepare',
    COMMIT,
    fixture.indexHash,
    fixture.htaccessHash,
    fixture.stageToken
  );

  const legacyRoot = path.join(fixture.deployRoot, 'legacy');
  const backup = path.join(legacyRoot, 'physical-docroot-pre-rkn-20260823');
  await fs.chmod(legacyRoot, 0o500);
  await assert.rejects(
    runBootstrap(fixture, 'rollback', COMMIT, fixture.indexHash, fixture.htaccessHash),
    (error) => {
      assert.match(String(error.stderr), /Cannot restore physical document root/);
      assert.match(String(error.stderr), /safe baseline restored at the live path/);
      return true;
    }
  );
  assert.equal(await fs.readlink(fixture.liveRoot), path.join(fixture.deployRoot, 'current'));
  assert.equal(await fs.readFile(path.join(backup, 'legacy-proof.txt'), 'utf8'), 'preserve exactly\n');
  await fs.chmod(legacyRoot, 0o700);
});

test('a new reviewed SHA can resume only from an intact fail-closed rollback state', async (t) => {
  const fixture = await createBootstrapFixture(t, 'retry-plan-');
  await runBootstrap(
    fixture,
    'prepare',
    COMMIT,
    fixture.indexHash,
    fixture.htaccessHash,
    fixture.stageToken
  );
  await runBootstrap(fixture, 'rollback', COMMIT, fixture.indexHash, fixture.htaccessHash);

  const oldSafeIndex = path.join(
    fixture.deployRoot,
    'releases',
    `safe-baseline-${COMMIT}`,
    'index.html'
  );
  await fs.appendFile(oldSafeIndex, '<form></form>\n');
  const rejectedToken = '654321-2';
  await stageBaseline(fixture, rejectedToken);
  await assert.rejects(
    runBootstrap(
      fixture,
      'prepare',
      RETRY_COMMIT,
      fixture.indexHash,
      fixture.htaccessHash,
      rejectedToken
    ),
    (error) => {
      assert.match(String(error.stderr), /not a verified fail-closed baseline/);
      return true;
    }
  );
  assert.equal(
    await fs.readFile(path.join(fixture.deployRoot, 'state', 'bootstrap-plan'), 'utf8'),
    `${COMMIT}:NO_SAFE_PREVIOUS\n`
  );
  assert.equal((await fs.lstat(fixture.liveRoot)).isDirectory(), true);

  await fs.copyFile(path.join(ROOT, 'ops', 'deploy', 'safe-baseline', 'index.html'), oldSafeIndex);
  await fs.chmod(oldSafeIndex, 0o644);
  const acceptedToken = '654321-3';
  await stageBaseline(fixture, acceptedToken);
  await runBootstrap(
    fixture,
    'prepare',
    RETRY_COMMIT,
    fixture.indexHash,
    fixture.htaccessHash,
    acceptedToken
  );
  assert.equal(
    await fs.readFile(path.join(fixture.deployRoot, 'state', 'bootstrap-plan'), 'utf8'),
    `${RETRY_COMMIT}:NO_SAFE_PREVIOUS\n`
  );
  assert.equal(
    await fs.readlink(path.join(fixture.deployRoot, 'current')),
    `releases/safe-baseline-${RETRY_COMMIT}`
  );
  await assert.rejects(
    fs.lstat(path.join(fixture.deployRoot, 'state', 'production-enabled')),
    { code: 'ENOENT' }
  );
  await assert.rejects(
    fs.lstat(path.join(fixture.deployRoot, 'state', 'collection-approved')),
    { code: 'ENOENT' }
  );

  await runBootstrap(fixture, 'rollback', RETRY_COMMIT, fixture.indexHash, fixture.htaccessHash);
  assert.equal((await fs.lstat(fixture.liveRoot)).isDirectory(), true);
  assert.equal(
    await fs.readlink(path.join(fixture.deployRoot, 'current')),
    `releases/safe-baseline-${RETRY_COMMIT}`
  );
});

test('production smoke and remote helper contain rollback hardening', async () => {
  const production = await fs.readFile(path.join(ROOT, '.github', 'workflows', 'deploy-production.yml'), 'utf8');
  const remote = await fs.readFile(path.join(ROOT, 'ops', 'deploy', 'remote-release.sh'), 'utf8');
  const bootstrap = await fs.readFile(BOOTSTRAP, 'utf8');
  await execute('/bin/sh', ['-n', path.join(ROOT, 'ops', 'deploy', 'remote-release.sh')]);
  await execute('/bin/sh', ['-n', BOOTSTRAP]);

  assert.match(production, /\/maf\/skamejki\/artdeco-a1-101\//);
  assert.match(production, /egoe_deploy=\$smoke_token/);
  assert.match(production, /StrictHostKeyChecking=yes/);
  assert.match(production, /PasswordAuthentication=no/);
  assert.match(production, /test -L "\$deploy_root\/current"/);
  assert.match(production, /PHP_VERSION_ID >= 80200/);
  assert.match(production, /extension_loaded\("pdo_sqlite"\)/);
  assert.match(production, /api\/leads\//);
  assert.match(production, /api\/leads\/status\//);
  assert.match(production, /COLLECTION_DISABLED/);
  assert.match(production, /collectionEnabled/);
  assert.match(production, /state\/collection-approved/);
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
  assert.match(remote, /collectionEnabled/);
  assert.match(remote, /state\/collection-approved/);
  assert.match(remote, /Collection approval marker must not be a symlink/);
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
  assert.match(remote, /validate_owned_mode "\$deploy_root" directory "Deploy root"/);
  assert.match(remote, /validate_owned_mode "\$deploy_root\/state" directory/);
  assert.match(remote, /validate_owned_mode "\$collection_marker" file/);
  assert.match(remote, /trap restore_failed_deploy_switch EXIT HUP INT TERM/);
  assert.match(remote, /previous current symlink restored/);
  assert.match(bootstrap, /trap prepare_abort EXIT HUP INT TERM/);
  assert.match(bootstrap, /trap rollback_abort EXIT HUP INT TERM/);
  assert.match(bootstrap, /resume_bootstrap_plan/);
  assert.match(bootstrap, /Previous current target is not a verified fail-closed baseline/);
  assert.match(bootstrap, /physical-docroot-pre-rkn-20260823/);
  assert.match(bootstrap, /require_absent "\$collection_marker"/);
  assert.match(bootstrap, /verify_bootstrap_state .* prepared/);
  assert.match(bootstrap, /write_once "\$production_marker"/);
  assert.doesNotMatch(bootstrap, /write_once .*collection-approved/);
  assert.doesNotMatch(bootstrap, /rm\s+-rf/);
});
