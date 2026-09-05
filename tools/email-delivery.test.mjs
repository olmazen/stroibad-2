#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHP = process.env.EGOE_PHP_BIN || 'php';

function phpString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function settingsProbe(deployRoot) {
  return spawnSync(PHP, ['-r', `
    require ${phpString(path.join(ROOT, 'api/leads/lib/LeadBackend.php'))};
    try {
      $settings = Egoe\\Leads\\Settings::load(getenv('EGOE_DEPLOY_ROOT'));
      echo ($settings['email']['enabled'] ?? false) === true ? 'on' : 'off';
    } catch (Throwable $error) {
      echo 'error:' . $error->getMessage();
    }
  `], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, EGOE_DEPLOY_ROOT: deployRoot }
  });
}

test('email duplication is transactional, minimal, independent, and bounded', async (context) => {
  const deployRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-email-'));
  context.after(() => fs.rm(deployRoot, { recursive: true, force: true }));
  const state = path.join(deployRoot, 'state');
  const shared = path.join(deployRoot, 'shared', 'leads');
  const bin = path.join(deployRoot, 'bin');
  await fs.mkdir(state, { recursive: true });
  await fs.mkdir(shared, { recursive: true, mode: 0o700 });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(state, 'site-hostname'), 'egoe-life.ru\n');
  await fs.writeFile(path.join(state, 'collection-approved'), 'egoe-life.ru');
  await fs.writeFile(path.join(state, 'email-delivery-approved'), 'egoe-life.ru', { mode: 0o600 });
  await fs.chmod(path.join(state, 'email-delivery-approved'), 0o600);

  const captureArgs = path.join(deployRoot, 'sendmail.args');
  const captureMessage = path.join(deployRoot, 'sendmail.message');
  const sendmail = path.join(bin, 'sendmail');
  await fs.writeFile(sendmail, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$EGOE_SENDMAIL_CAPTURE_ARGS"\ncat > "$EGOE_SENDMAIL_CAPTURE_MESSAGE"\n', { mode: 0o755 });
  await fs.chmod(sendmail, 0o755);
  const hangingDirectory = path.join(deployRoot, 'hang');
  await fs.mkdir(hangingDirectory);
  const hangingSendmail = path.join(hangingDirectory, 'sendmail');
  await fs.writeFile(hangingSendmail, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  await fs.chmod(hangingSendmail, 0o755);

  const config = `<?php
declare(strict_types=1);
return [
  'site_host' => 'www.egoe-life.ru',
  'allowed_hosts' => ['www.egoe-life.ru', 'egoe-life.ru'],
  'collection_enabled' => true,
  'consent_version' => '2026-09-04',
  'ip_hash_key' => '${'ab'.repeat(32)}',
  'minimum_elapsed_ms' => 0,
  'rate_limit' => ['max_requests' => 100, 'window_seconds' => 600],
  'retention_days' => 365,
  'consent_evidence_days' => 1095,
  'backup_retention_days' => 30,
  'email' => [
    'enabled' => true,
    'recipient' => 'zakaz@egoe-life.ru',
    'sender' => 'zakaz@egoe-life.ru',
    'sender_name' => 'EGOE — сайт',
    'sendmail_path' => ${phpString(sendmail)},
    'timeout_seconds' => 10,
  ],
  'relay' => [
    'enabled' => false,
    'url' => '',
    'mode' => 'signal',
    'allow_signal' => false,
    'allow_technical' => false,
    'allow_full' => false,
    'cross_border_confirmed' => false,
    'timeout_seconds' => 3,
    'ca_file' => '',
    'url_sha256' => '',
    'require_json_ok' => true,
  ],
];
`;
  const configPath = path.join(shared, 'config.php');
  await fs.writeFile(configPath, config, { mode: 0o600 });
  await fs.chmod(configPath, 0o600);

  const result = spawnSync(PHP, ['tools/email-delivery-harness.php'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      EGOE_DEPLOY_ROOT: deployRoot,
      EGOE_SENDMAIL_CAPTURE_ARGS: captureArgs,
      EGOE_SENDMAIL_CAPTURE_MESSAGE: captureMessage,
      EGOE_HANGING_SENDMAIL: hangingSendmail
    }
  });
  assert.equal(result.signal, null, result.stderr || result.stdout);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    schemaVersion: 2,
    emailAttempts: 2,
    primaryDeliveries: 1
  });

  const approvalMarker = path.join(state, 'email-delivery-approved');
  await fs.rm(approvalMarker);
  assert.equal(settingsProbe(deployRoot).stdout, 'off', 'missing marker must fail closed');
  await fs.writeFile(approvalMarker, 'wrong-site', { mode: 0o600 });
  await fs.chmod(approvalMarker, 0o600);
  assert.equal(settingsProbe(deployRoot).stdout, 'off', 'malformed marker must fail closed');
  await fs.writeFile(approvalMarker, 'egoe-life.ru');
  await fs.chmod(approvalMarker, 0o644);
  assert.equal(settingsProbe(deployRoot).stdout, 'off', 'public marker permissions must fail closed');
  await fs.chmod(approvalMarker, 0o600);
  assert.equal(settingsProbe(deployRoot).stdout, 'on', 'valid private marker must enable email');

  await fs.writeFile(configPath, config.replace("'recipient' => 'zakaz@egoe-life.ru'", "'recipient' => 'other@egoe-life.ru'"));
  await fs.chmod(configPath, 0o600);
  assert.match(settingsProbe(deployRoot).stdout, /^error:Email recipient must be the approved order mailbox$/);
  await fs.writeFile(configPath, config.replace("'sender_name' => 'EGOE — сайт'", "'sender_name' => 'Other'"));
  await fs.chmod(configPath, 0o600);
  assert.match(settingsProbe(deployRoot).stdout, /^error:Email sender_name must match the approved identity$/);
});
