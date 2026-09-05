#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHP = process.env.EGOE_PHP_BIN || 'php';
const SHA = 'a'.repeat(40);

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(PHP, [path.join(ROOT, 'ops/leads/email-delivery-control.php'), ...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
}

async function privateWrite(target, contents, mode = 0o600) {
  await fs.writeFile(target, contents, { mode });
  await fs.chmod(target, mode);
}

async function hasProductionSendmail() {
  try {
    await fs.access('/usr/sbin/sendmail', fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

test('email control is exact-release-bound, atomic, reversible, and preserves private settings', async (context) => {
  const deployRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-email-control-'));
  context.after(() => fs.rm(deployRoot, { recursive: true, force: true }));
  const realDeployRoot = await fs.realpath(deployRoot);
  const state = path.join(realDeployRoot, 'state');
  const shared = path.join(realDeployRoot, 'shared');
  const leads = path.join(shared, 'leads');
  const release = path.join(realDeployRoot, 'releases', SHA);
  await fs.mkdir(state, { recursive: true });
  await fs.mkdir(leads, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(release, 'api/leads/lib'), { recursive: true });
  await fs.chmod(leads, 0o700);
  await privateWrite(path.join(state, 'site-hostname'), 'egoe-life.ru\n');
  await fs.copyFile(path.join(ROOT, 'api/leads/lib/LeadBackend.php'), path.join(release, 'api/leads/lib/LeadBackend.php'));
  await fs.copyFile(path.join(ROOT, 'api/leads/lib/EmailDelivery.php'), path.join(release, 'api/leads/lib/EmailDelivery.php'));
  await fs.writeFile(path.join(release, 'release.json'), JSON.stringify({ source: { commit: SHA } }));
  await fs.symlink(`releases/${SHA}`, path.join(realDeployRoot, 'current'));

  const untouchedSecret = 'ab'.repeat(32);
  const config = `<?php
declare(strict_types=1);
return [
  'site_host' => 'www.egoe-life.ru',
  'allowed_hosts' => ['www.egoe-life.ru', 'egoe-life.ru'],
  'collection_enabled' => false,
  'consent_version' => '2026-08-27',
  'ip_hash_key' => '${untouchedSecret}',
  'minimum_elapsed_ms' => 600,
  'rate_limit' => ['max_requests' => 5, 'window_seconds' => 600],
  'retention_days' => 365,
  'consent_evidence_days' => 1095,
  'backup_retention_days' => 30,
  'relay' => ['enabled' => false],
  'unrelated_private_setting' => 'preserve-me',
];
`;
  const configPath = path.join(leads, 'config.php');
  await privateWrite(configPath, config);

  let result = JSON.parse((await run(['preflight', realDeployRoot, SHA])).stdout);
  assert.equal(result.emailDeliveryEnabled, false);
  assert.equal(result.markerPresent, false);

  await assert.rejects(
    run(['enable', realDeployRoot, 'b'.repeat(40)]),
    (error) => String(error.stderr).includes('does not match the approved SHA')
  );
  assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600);

  if (await hasProductionSendmail()) {
    result = JSON.parse((await run(['enable', realDeployRoot, SHA])).stdout);
    assert.deepEqual(result, {
      ok: true,
      schemaVersion: 2,
      collectionEnabled: false,
      emailDeliveryEnabled: true,
      mode: 'enable',
      markerPresent: true
    });
    assert.equal(await fs.readFile(path.join(state, 'email-delivery-approved'), 'utf8'), 'egoe-life.ru');
    assert.equal((await fs.stat(path.join(state, 'email-delivery-approved'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600);
    const enabledConfig = (await fs.readFile(configPath, 'utf8'));
    assert.match(enabledConfig, /'unrelated_private_setting' => 'preserve-me'/);
    assert.match(enabledConfig, new RegExp(untouchedSecret));
    assert.match(enabledConfig, /'recipient' => 'zakaz@egoe-life\.ru'/);

    result = JSON.parse((await run(['preflight', realDeployRoot, SHA])).stdout);
    assert.equal(result.emailDeliveryEnabled, true);
    assert.equal(result.markerPresent, true);
  } else {
    await assert.rejects(
      run(['enable', realDeployRoot, SHA]),
      (error) => String(error.stderr).includes('Configured sendmail executable is unavailable')
    );
    const rolledBackConfig = await fs.readFile(configPath, 'utf8');
    assert.match(rolledBackConfig, /'unrelated_private_setting' => 'preserve-me'/);
    assert.match(rolledBackConfig, new RegExp(untouchedSecret));
    await assert.rejects(
      fs.stat(path.join(state, 'email-delivery-approved')),
      (error) => error.code === 'ENOENT'
    );
  }

  result = JSON.parse((await run(['disable', realDeployRoot, SHA])).stdout);
  assert.equal(result.emailDeliveryEnabled, false);
  assert.equal(result.markerPresent, false);
  await assert.rejects(fs.stat(path.join(state, 'email-delivery-approved')), (error) => error.code === 'ENOENT');
  const disabledConfig = await fs.readFile(configPath, 'utf8');
  assert.match(disabledConfig, /'enabled' => false/);
  assert.match(disabledConfig, /'unrelated_private_setting' => 'preserve-me'/);
  assert.match(disabledConfig, new RegExp(untouchedSecret));

  const parkedRelease = `${release}.real`;
  await fs.rename(release, parkedRelease);
  await fs.symlink(path.basename(parkedRelease), release);
  await assert.rejects(
    run(['preflight', realDeployRoot, SHA]),
    (error) => String(error.stderr).includes('release directory must not be a symlink')
  );
  await fs.unlink(release);
  await fs.rename(parkedRelease, release);

  await fs.symlink(configPath, path.join(state, 'email-delivery-approved'));
  await assert.rejects(
    run(['preflight', realDeployRoot, SHA]),
    (error) => String(error.stderr).includes('Unsafe server path')
  );
  assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600);
});
