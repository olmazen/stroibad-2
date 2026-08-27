import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHP = process.env.EGOE_PHP_BIN || 'php';

function run(file, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
}

function failureText(error) {
  return `${error?.stdout || ''}\n${error?.stderr || ''}`;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function uuid() { return crypto.randomUUID(); }

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function lead(overrides = {}) {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 1,
    leadId: uuid(),
    formId: 'test:request',
    tag: 'Тестовая форма',
    createdAt: timestamp,
    consent: {
      accepted: true,
      version: '2026-08-27',
      acceptedAt: timestamp,
      documentUrl: 'https://www.egoe-life.ru/consent/'
    },
    page: {
      url: 'https://www.egoe-life.ru/test/?campaign=ignored',
      title: 'Тест',
      referrer: 'https://www.egoe-life.ru/source/?email=secret@example.com#fragment'
    },
    spamCheck: { website: '', elapsedMs: 1500 },
    fields: { Имя: 'Анна', Телефон: '8 (927) 123-45-67' },
    ...overrides
  };
}

function settings(overrides = {}) {
  const base = {
    site_host: 'www.egoe-life.ru',
    allowed_hosts: ['www.egoe-life.ru', 'egoe-life.ru'],
    collection_enabled: false,
    consent_version: '2026-08-27',
    ip_hash_key: '0123456789abcdef'.repeat(4),
    minimum_elapsed_ms: 600,
    rate_limit: { max_requests: 20, window_seconds: 600 },
    retention_days: 365,
    consent_evidence_days: 1095,
    backup_retention_days: 30,
    relay: {
      enabled: false,
      url: '',
      mode: 'signal',
      allow_signal: false,
      allow_technical: false,
      allow_full: false,
      cross_border_confirmed: false,
      timeout_seconds: 2,
      ca_file: '',
      url_sha256: '',
      require_json_ok: true
    }
  };
  return { ...base, ...overrides, relay: { ...base.relay, ...(overrides.relay || {}) } };
}

function activeSettings(overrides = {}) {
  return settings({ collection_enabled: true, ...overrides });
}

async function writeConfig(deployRoot, value) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  const body = `<?php\ndeclare(strict_types=1);\nreturn json_decode(base64_decode('${encoded}'), true, 512, JSON_THROW_ON_ERROR);\n`;
  const target = path.join(deployRoot, 'shared/leads/config.php');
  await fs.writeFile(target, body, { mode: 0o600 });
  await fs.chmod(target, 0o600);
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`PHP server exited early with ${child.exitCode}`);
    try {
      const response = await httpRequest(url, { headers: { Host: 'www.egoe-life.ru' } });
      if (response.status === 405) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('PHP test server did not start');
}

function httpRequest(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

test('real PHP endpoint and CLI persist, validate, deduplicate, rate-limit and retain safely', async (t) => {
  execFileSync(PHP, ['-r', "exit(PHP_VERSION_ID >= 80200 && extension_loaded('pdo_sqlite') && extension_loaded('sqlite3') && method_exists('SQLite3', 'backup') && extension_loaded('mbstring') && extension_loaded('curl') ? 0 : 1);"], { stdio: 'ignore' });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-leads-'));
  t.after(async () => fs.rm(temporary, { recursive: true, force: true }));
  const deployRoot = path.join(temporary, 'deploy');
  const release = path.join(deployRoot, `releases/${'a'.repeat(40)}`);
  await fs.mkdir(path.join(deployRoot, 'state'), { recursive: true });
  await fs.mkdir(path.join(deployRoot, 'shared'), { recursive: true });
  await fs.mkdir(release, { recursive: true });
  await fs.writeFile(path.join(deployRoot, 'state/site-hostname'), 'egoe-life.ru\n');
  await fs.cp(path.join(ROOT, 'api'), path.join(release, 'api'), { recursive: true });
  const cli = path.join(release, 'api/leads/cli/leads.php');
  const env = { ...process.env, EGOE_DEPLOY_ROOT: deployRoot };

  const initialized = await run(PHP, [cli, 'init'], { env });
  assert.match(initialized.stdout, /INITIALIZED schema=2 collection=off relay=off/);
  await writeConfig(deployRoot, settings());
  const health = JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout);
  assert.deepEqual(health, { ok: true, schemaVersion: 2, collectionEnabled: false, relayEnabled: false });
  assert.equal((await fs.stat(path.join(deployRoot, 'shared/leads'))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(deployRoot, 'shared/leads/config.php'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(deployRoot, 'shared/leads/leads.sqlite3'))).mode & 0o777, 0o600);
  await writeConfig(deployRoot, settings({ backup_retention_days: 31 }));
  await assert.rejects(run(PHP, [cli, 'health'], { env }), (error) => String(error.stderr).includes('exactly 30'));
  await writeConfig(deployRoot, settings({ retention_days: 366 }));
  await assert.rejects(run(PHP, [cli, 'health'], { env }), (error) => String(error.stderr).includes('between 1 and 365'));
  await writeConfig(deployRoot, settings({ consent_evidence_days: 1096 }));
  await assert.rejects(run(PHP, [cli, 'health'], { env }), (error) => String(error.stderr).includes('between 1 and 1095'));
  await writeConfig(deployRoot, settings({ retention_days: 30, consent_evidence_days: 90 }));
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).ok, true, 'shorter retention must remain configurable');

  const approvedRelayUrl = 'https://example.invalid/relay';
  const approvedSignalRelay = {
    enabled: true,
    url: approvedRelayUrl,
    url_sha256: sha256(approvedRelayUrl),
    mode: 'signal',
    allow_signal: true,
    cross_border_confirmed: true
  };
  await writeConfig(deployRoot, settings({ relay: approvedSignalRelay }));
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).relayEnabled, false, 'config alone must not enable relay');
  const relayApprovalMarker = path.join(deployRoot, 'state/relay-approved');
  const relaySymlinkTarget = path.join(deployRoot, 'state/not-a-relay-approval');
  await fs.writeFile(relaySymlinkTarget, 'egoe-life.ru');
  await fs.symlink(relaySymlinkTarget, relayApprovalMarker);
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).relayEnabled, false, 'symlinked relay approval marker must fail closed');
  await fs.unlink(relayApprovalMarker);
  await fs.writeFile(relayApprovalMarker, 'egoe-life.ru\n');
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).relayEnabled, false, 'relay marker bytes must match exactly');
  await fs.writeFile(relayApprovalMarker, 'egoe-life.ru');
  await fs.chmod(relayApprovalMarker, 0o666);
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).relayEnabled, false, 'group/world-writable relay marker must fail closed');
  await fs.chmod(relayApprovalMarker, 0o644);
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).relayEnabled, false, 'relay marker must use exact private mode 0600');
  await fs.chmod(relayApprovalMarker, 0o600);
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).relayEnabled, true, 'private relay marker must enable approved config');
  const relayOwnerMismatchScript = `namespace Egoe\\Leads { function lstat(string $path): array|false { $metadata=\\lstat($path); if (is_array($metadata) && basename($path)==='relay-approved') $metadata['uid']=(int)$metadata['uid']+1; return $metadata; } } namespace { require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $settings=Egoe\\Leads\\Settings::load(getenv('EGOE_DEPLOY_ROOT')); echo $settings['relay']['enabled'] ? 'enabled' : 'disabled'; }`;
  assert.equal((await run(PHP, ['-r', relayOwnerMismatchScript], { env })).stdout, 'disabled', 'relay marker owner mismatch must fail closed');
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).relayEnabled, true, 'a private mode-0600 relay marker must be accepted');

  await writeConfig(deployRoot, settings({ relay: {
    enabled: true,
    url: approvedRelayUrl,
    url_sha256: sha256(approvedRelayUrl),
    mode: 'signal'
  } }));
  await assert.rejects(run(PHP, [cli, 'health'], { env }), (error) => String(error.stderr).includes('cross-border approval'));
  await writeConfig(deployRoot, settings({ relay: {
    enabled: true,
    url: approvedRelayUrl,
    url_sha256: sha256(approvedRelayUrl),
    mode: 'signal',
    cross_border_confirmed: true
  } }));
  await assert.rejects(run(PHP, [cli, 'health'], { env }), (error) => String(error.stderr).includes('allow_signal'));
  await writeConfig(deployRoot, settings({ relay: { ...approvedSignalRelay, url_sha256: sha256(`${approvedRelayUrl}/wrong`) } }));
  await assert.rejects(run(PHP, [cli, 'health'], { env }), (error) => String(error.stderr).includes('approved SHA-256'));
  await writeConfig(deployRoot, settings({ relay: { ...approvedSignalRelay, require_json_ok: 'yes' } }));
  await assert.rejects(run(PHP, [cli, 'health'], { env }), (error) => String(error.stderr).includes('require_json_ok'));
  await writeConfig(deployRoot, settings());

  const port = await freePort();
  const server = spawn(PHP, ['-S', `127.0.0.1:${port}`, '-t', release, path.join(release, 'api/leads/index.php')], {
    cwd: release,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverErrors = '';
  server.stderr.on('data', (chunk) => { serverErrors += chunk; });
  t.after(() => { if (server.exitCode === null) server.kill('SIGTERM'); });
  const endpoint = `http://127.0.0.1:${port}/api/leads/`;
  const statusEndpoint = `http://127.0.0.1:${port}/api/leads/status/`;
  await waitForServer(endpoint, server);
  const endpointContract = await httpRequest(endpoint, { headers: { Host: 'www.egoe-life.ru' } });
  assert.equal(endpointContract.status, 405);
  assert.match(String(endpointContract.headers['cache-control']), /no-store/);
  assert.equal(endpointContract.headers['x-content-type-options'], 'nosniff');
  for (const unsafePath of [
    '/api/leads/index.php',
    '/api/leads/%69ndex.php',
    '/api/leads/index.php/anything',
    '/api/leads/status/anything',
    '/api/leads/anything'
  ]) {
    const rejected = await httpRequest(`http://127.0.0.1:${port}${unsafePath}`, { headers: { Host: 'www.egoe-life.ru' } });
    assert.equal(rejected.status, 404, `${unsafePath} must not reach either endpoint`);
    assert.equal(JSON.parse(rejected.text).code, 'NOT_FOUND');
  }
  const rejectedPostPath = await httpRequest(`http://127.0.0.1:${port}/api/leads/anything`, {
    method: 'POST',
    headers: { Host: 'www.egoe-life.ru' }
  });
  assert.equal(rejectedPostPath.status, 404);
  assert.equal(JSON.parse(rejectedPostPath.text).code, 'NOT_FOUND');

  async function post(payload, extraHeaders = {}) {
    const boundary = `----egoe-test-${crypto.randomBytes(12).toString('hex')}`;
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--\r\n`,
      'utf8'
    );
    const response = await httpRequest(endpoint, {
      method: 'POST',
      headers: {
        Host: 'www.egoe-life.ru',
        Origin: 'https://www.egoe-life.ru',
        Referer: 'https://www.egoe-life.ru/test/',
        Accept: 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.byteLength),
        ...extraHeaders
      },
      body
    });
    return { response, json: JSON.parse(response.text) };
  }

  const zeroCountScript = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $p=Egoe\\Leads\\Database::connect(getenv('EGOE_DEPLOY_ROOT')); echo json_encode(['leads'=>(int)$p->query('SELECT count(*) FROM leads')->fetchColumn(),'evidence'=>(int)$p->query('SELECT count(*) FROM consent_evidence')->fetchColumn(),'outbox'=>(int)$p->query('SELECT count(*) FROM outbox')->fetchColumn(),'rates'=>(int)$p->query('SELECT count(*) FROM rate_limits')->fetchColumn()]);`;
  async function status(host = 'www.egoe-life.ru') {
    const response = await httpRequest(statusEndpoint, { headers: { Host: host, Accept: 'application/json' } });
    return { response, json: JSON.parse(response.text) };
  }

  let gate = await status();
  assert.equal(gate.response.status, 200);
  assert.deepEqual(gate.json, { enabled: false });
  assert.match(String(gate.response.headers['cache-control']), /no-store/);
  let blocked = await post(lead());
  assert.equal(blocked.response.status, 503);
  assert.equal(blocked.json.code, 'COLLECTION_DISABLED');
  assert.deepEqual(JSON.parse((await run(PHP, ['-r', zeroCountScript], { env })).stdout), { leads: 0, evidence: 0, outbox: 0, rates: 0 });

  await writeConfig(deployRoot, activeSettings());
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).collectionEnabled, false, 'config alone must not enable collection');
  assert.equal((await status()).json.enabled, false);
  const approvalMarker = path.join(deployRoot, 'state/collection-approved');
  const symlinkTarget = path.join(deployRoot, 'state/not-an-approval');
  await fs.writeFile(symlinkTarget, 'egoe-life.ru');
  await fs.symlink(symlinkTarget, approvalMarker);
  assert.equal((await status()).json.enabled, false, 'symlinked approval marker must fail closed');
  await fs.unlink(approvalMarker);
  await fs.writeFile(approvalMarker, 'egoe-life.ru extra\n');
  assert.equal((await status()).json.enabled, false, 'malformed approval marker must fail closed');
  await fs.writeFile(approvalMarker, 'egoe-life.ru\n');
  assert.equal((await status()).json.enabled, false, 'approval marker bytes must match exactly');
  await fs.writeFile(approvalMarker, 'egoe-life.ru');
  await fs.chmod(path.join(deployRoot, 'state'), 0o777);
  assert.equal((await status()).json.enabled, false, 'group/world-writable state directory must fail closed');
  await fs.chmod(path.join(deployRoot, 'state'), 0o755);
  await fs.chmod(approvalMarker, 0o666);
  assert.equal((await status()).json.enabled, false, 'group/world-writable approval marker must fail closed');
  await fs.chmod(approvalMarker, 0o644);
  gate = await status();
  assert.deepEqual(gate.json, { enabled: true });
  assert.equal((await fs.stat(path.join(deployRoot, 'state'))).mode & 0o777, 0o755);
  assert.equal((await fs.stat(approvalMarker)).mode & 0o777, 0o644);

  const ownerMismatchScript = `namespace Egoe\\Leads { function lstat(string $path): array|false { $metadata=\\lstat($path); if (is_array($metadata) && basename($path)==='collection-approved') $metadata['uid']=(int)$metadata['uid']+1; return $metadata; } } namespace { require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $settings=Egoe\\Leads\\Settings::load(getenv('EGOE_DEPLOY_ROOT')); echo $settings['collection_enabled'] ? 'enabled' : 'disabled'; }`;
  assert.equal((await run(PHP, ['-r', ownerMismatchScript], { env })).stdout, 'disabled', 'owner mismatch must fail closed');

  await fs.chmod(approvalMarker, 0o600);
  assert.equal((await status()).json.enabled, true, 'a private mode-0600 marker must be accepted');
  await fs.chmod(approvalMarker, 0o644);
  assert.equal(JSON.parse((await run(PHP, [cli, 'health'], { env })).stdout).collectionEnabled, true);
  const rejectedStatusHost = await status('evil.example');
  assert.equal(rejectedStatusHost.response.status, 403);
  assert.equal(rejectedStatusHost.json.code, 'HOST_REJECTED');

  const first = lead();
  let result = await post(first);
  assert.equal(result.response.status, 201, serverErrors);
  assert.deepEqual(result.json, { ok: true, leadId: first.leadId, duplicate: false });
  const evidenceScript = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $p=Egoe\\Leads\\Database::connect(getenv('EGOE_DEPLOY_ROOT')); $q=$p->prepare('SELECT payload_hash,form_id,page_path,consent_version,consent_accepted_at,consent_document_url,received_at FROM consent_evidence WHERE lead_id=?'); $q->execute(['${first.leadId}']); echo json_encode($q->fetch());`;
  const firstEvidence = JSON.parse((await run(PHP, ['-r', evidenceScript], { env })).stdout);
  assert.equal(firstEvidence.form_id, 'test:request');
  assert.equal(firstEvidence.page_path, '/test/');
  assert.equal(firstEvidence.consent_version, '2026-08-27');
  assert.equal(firstEvidence.consent_accepted_at, first.consent.acceptedAt);
  assert.equal(firstEvidence.consent_document_url, '/consent/');
  assert.match(firstEvidence.payload_hash, /^[0-9a-f]{64}$/);
  assert.match(firstEvidence.received_at, /^\d{4}-\d{2}-\d{2}T/);

  await new Promise((resolve) => setTimeout(resolve, 10));
  const recentTarget = lead({
    formId: 'test:recent',
    page: { url: 'https://www.egoe-life.ru/recent/?private=drop', title: 'Recent', referrer: '' },
    fields: { Имя: 'Секретное имя', Телефон: '+7 927 555-44-33' }
  });
  result = await post(recentTarget);
  assert.equal(result.response.status, 201);
  const recent = JSON.parse((await run(PHP, [cli, 'recent', '2'], { env })).stdout);
  assert.equal(recent.length, 2);
  assert.deepEqual(Object.keys(recent[0]).sort(), ['form_id', 'lead_id', 'page_path', 'received_at'].sort());
  assert.equal(recent[0].lead_id, recentTarget.leadId);
  assert.equal(recent[0].form_id, 'test:recent');
  assert.equal(recent[0].page_path, '/recent/');
  assert.equal(JSON.stringify(recent).includes('Секретное имя'), false);
  assert.equal(JSON.stringify(recent).includes('79275554433'), false);
  const recentDefault = JSON.parse((await run(PHP, [cli, 'recent'], { env })).stdout);
  assert.equal(recentDefault[0].lead_id, recentTarget.leadId, 'recent must default to a newest-first list');
  assert.equal(JSON.parse((await run(PHP, [cli, 'recent', '100'], { env })).stdout).length, 2);
  await assert.rejects(run(PHP, [cli, 'recent', '101'], { env }), (error) => failureText(error).includes('from 1 to 100'));
  const recentCleanup = await run(PHP, [cli, 'delete', recentTarget.leadId, '--with-evidence'], { env });
  assert.match(recentCleanup.stdout, /lead=1 evidence=1/);

  const newTimestamp = new Date().toISOString();
  const volatileRetry = {
    ...first,
    createdAt: newTimestamp,
    consent: { ...first.consent, acceptedAt: newTimestamp },
    spamCheck: { ...first.spamCheck, elapsedMs: 9000 }
  };
  result = await post(volatileRetry);
  assert.equal(result.response.status, 200);
  assert.equal(result.json.duplicate, true);

  result = await post({ ...volatileRetry, fields: { ...first.fields, Телефон: '+7 927 000-00-00' } });
  assert.equal(result.response.status, 409);
  assert.equal(result.json.code, 'IDEMPOTENCY_CONFLICT');

  const noConsent = lead();
  noConsent.consent = { ...noConsent.consent, accepted: false };
  result = await post(noConsent);
  assert.equal(result.response.status, 422);
  assert.equal(result.json.code, 'CONSENT_REQUIRED');

  const noPhone = lead({ fields: { Имя: 'Анна', Email: 'anna@example.com' } });
  result = await post(noPhone);
  assert.equal(result.response.status, 422);
  assert.equal(result.json.code, 'CONTACT_REQUIRED');

  const emptyPhone = lead({ fields: { Имя: 'Анна', Телефон: '', Компания: '' } });
  result = await post(emptyPhone);
  assert.equal(result.response.status, 422);
  assert.equal(result.json.code, 'CONTACT_REQUIRED');

  const badTimestamp = lead({ createdAt: new Date(Date.now() - 90000000).toISOString() });
  badTimestamp.consent.acceptedAt = badTimestamp.createdAt;
  result = await post(badTimestamp);
  assert.equal(result.response.status, 422);
  assert.equal(result.json.code, 'TIMESTAMP_INVALID');

  const futureConsent = lead({ createdAt: new Date(Date.now() + 9 * 60000).toISOString() });
  futureConsent.consent.acceptedAt = new Date(Date.now() + 14 * 60000).toISOString();
  result = await post(futureConsent);
  assert.equal(result.response.status, 422);
  assert.equal(result.json.code, 'CONSENT_TIMESTAMP_INVALID');

  const informalTimestamp = lead({ createdAt: 'now' });
  informalTimestamp.consent.acceptedAt = 'now';
  result = await post(informalTimestamp);
  assert.equal(result.response.status, 422);
  assert.equal(result.json.code, 'TIMESTAMP_INVALID');

  const honey = lead();
  honey.spamCheck.website = 'https://spam.invalid/';
  result = await post(honey);
  assert.equal(result.response.status, 200);
  assert.equal(result.json.filtered, true);

  result = await post(lead(), { Host: 'evil.example' });
  assert.equal(result.response.status, 403);
  assert.equal(result.json.code, 'HOST_REJECTED');

  const viewed = JSON.parse((await run(PHP, [cli, 'view', first.leadId], { env })).stdout);
  assert.equal(viewed.fields.Телефон, '+79271234567');
  assert.equal(viewed.page.path, '/test/');
  assert.equal(viewed.page.referrer, '/source/');
  assert.equal(JSON.stringify(viewed).includes('secret@example.com'), false);

  const queryScript = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $p=Egoe\\Leads\\Database::connect(getenv('EGOE_DEPLOY_ROOT')); echo json_encode(['leads'=>(int)$p->query('SELECT count(*) FROM leads')->fetchColumn(),'evidence'=>(int)$p->query('SELECT count(*) FROM consent_evidence')->fetchColumn(),'outbox'=>(int)$p->query('SELECT count(*) FROM outbox')->fetchColumn()]);`;
  let counts = JSON.parse((await run(PHP, ['-r', queryScript], { env })).stdout);
  assert.deepEqual(counts, { leads: 1, evidence: 1, outbox: 0 }, 'relay=off must create no outbox/network work');

  await writeConfig(deployRoot, activeSettings({ rate_limit: { max_requests: 2, window_seconds: 600 } }));
  const clearRate = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; Egoe\\Leads\\Database::connect(getenv('EGOE_DEPLOY_ROOT'))->exec('DELETE FROM rate_limits');`;
  await run(PHP, ['-r', clearRate], { env });
  assert.equal((await post(lead())).response.status, 201);
  assert.equal((await post(lead())).response.status, 201);
  result = await post(lead());
  assert.equal(result.response.status, 429);
  assert.equal(result.json.code, 'RATE_LIMITED');

  const relayPort = await freePort();
  const tlsDirectory = path.join(deployRoot, 'shared/leads/tls');
  await fs.mkdir(tlsDirectory, { recursive: true, mode: 0o700 });
  const relayKey = path.join(tlsDirectory, 'relay-test.key');
  const relayCertificate = path.join(tlsDirectory, 'relay-test.crt');
  await run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', relayKey, '-out', relayCertificate,
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'
  ]);
  const relayUrl = `https://127.0.0.1:${relayPort}/relay`;
  const technicalSettings = activeSettings({
    relay: {
      enabled: true,
      url: relayUrl,
      url_sha256: sha256(relayUrl),
      mode: 'technical',
      allow_technical: true,
      cross_border_confirmed: true,
      timeout_seconds: 1,
      ca_file: relayCertificate
    }
  });
  await writeConfig(deployRoot, technicalSettings);
  await run(PHP, ['-r', clearRate], { env });
  const relayLead = lead({ formId: 'test:relay', page: { url: 'https://www.egoe-life.ru/relay/?secret=drop', title: 'Relay', referrer: '' } });
  result = await post(relayLead);
  assert.equal(result.response.status, 201, 'relay outage must not reverse the SQLite commit');

  const receivedRelayBodies = [];
  let relayResponseBody = '{"ok":true}';
  const relayServer = https.createServer({
    key: await fs.readFile(relayKey),
    cert: await fs.readFile(relayCertificate)
  }, (request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      receivedRelayBodies.push(body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(relayResponseBody);
    });
  });
  await new Promise((resolve, reject) => relayServer.once('error', reject).listen(relayPort, '127.0.0.1', resolve));
  t.after(() => { if (relayServer.listening) relayServer.close(); });
  const makeDue = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $p=Egoe\\Leads\\Database::connect(getenv('EGOE_DEPLOY_ROOT')); $p->exec("UPDATE outbox SET next_attempt_at='2000-01-01T00:00:00.000Z'");`;
  await run(PHP, ['-r', makeDue], { env });
  const retried = JSON.parse((await run(PHP, [cli, 'retry', '20'], { env })).stdout);
  assert.deepEqual(retried, { sent: 1, failed: 0 });
  assert.equal(receivedRelayBodies.length, 1);
  const relayed = JSON.parse(receivedRelayBodies[0]);
  assert.deepEqual(Object.keys(relayed).sort(), ['ID заявки', 'Время', 'Страница', 'Форма', '_subject'].sort());
  assert.equal(relayed['ID заявки'], relayLead.leadId);
  assert.equal(relayed.Страница, '/relay/');
  assert.equal(JSON.stringify(relayed).includes('Анна'), false);
  assert.equal(JSON.stringify(relayed).includes('7927'), false);
  assert.equal(JSON.stringify(relayed).includes('fields'), false);

  const fullSettings = activeSettings({
    relay: {
      enabled: true,
      url: relayUrl,
      url_sha256: sha256(relayUrl),
      mode: 'full',
      allow_full: true,
      cross_border_confirmed: true,
      timeout_seconds: 1,
      ca_file: relayCertificate
    }
  });
  await writeConfig(deployRoot, fullSettings);
  await run(PHP, ['-r', clearRate], { env });
  const quoteFields = {
    Имя: 'Екатерина',
    Телефон: '8 (927) 229-58-28',
    'E-mail': 'example@egoe-life.ru',
    Компания: '',
    Позиции: '• Скамейка стальная «Дуга» (RAL 7016) — 3 шт × 22 270 = 66 810 ₽',
    Итого: '66 810 ₽',
    '№ КП': 'КП-2026-0827-123456'
  };
  const quoteLead = lead({
    formId: 'cart:quote',
    tag: 'КП',
    page: { url: 'https://www.egoe-life.ru/cart/?secret=drop', title: 'Корзина', referrer: '' },
    fields: quoteFields
  });
  result = await post(quoteLead);
  assert.equal(result.response.status, 201, 'an optional empty company must not reject a quote');
  assert.equal(receivedRelayBodies.length, 2);
  const fullRelayed = JSON.parse(receivedRelayBodies[1]);
  assert.deepEqual(Object.keys(fullRelayed), ['_subject', '_source', ...Object.keys(quoteFields)]);
  assert.equal(fullRelayed._subject, 'Заявка с сайта EGOE — КП');
  assert.equal(fullRelayed._source, '/cart/');
  assert.equal(fullRelayed.Телефон, '+79272295828');
  assert.equal(fullRelayed.Компания, '');
  assert.equal(fullRelayed.Позиции, quoteFields.Позиции);
  assert.equal(fullRelayed.Итого, quoteFields.Итого);
  assert.equal(fullRelayed['№ КП'], quoteFields['№ КП']);
  assert.equal(Object.hasOwn(fullRelayed, 'Данные'), false, 'legacy relay fields must be top-level');
  assert.equal(Object.hasOwn(fullRelayed, 'ID заявки'), false, 'full relay must preserve the legacy visible template');

  relayResponseBody = '{"ok":false}';
  const rejectedRelayLead = lead({
    formId: 'test:relay-response',
    fields: { Имя: 'Проверка ответа', Телефон: '+7 927 111-22-33' }
  });
  result = await post(rejectedRelayLead);
  assert.equal(result.response.status, 201, 'relay response failure must not reverse the SQLite commit');
  const outboxStatusScript = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $p=Egoe\\Leads\\Database::connect(getenv('EGOE_DEPLOY_ROOT')); $q=$p->prepare('SELECT status FROM outbox WHERE lead_id=?'); $q->execute(['${rejectedRelayLead.leadId}']); echo $q->fetchColumn();`;
  assert.equal((await run(PHP, ['-r', outboxStatusScript], { env })).stdout, 'failed', 'JSON ok=false must be treated as a failed delivery');

  await writeConfig(deployRoot, activeSettings({
    relay: {
      ...fullSettings.relay,
      require_json_ok: false
    }
  }));
  await run(PHP, ['-r', makeDue], { env });
  const retriedWithoutJsonContract = JSON.parse((await run(PHP, [cli, 'retry', '20'], { env })).stdout);
  assert.deepEqual(retriedWithoutJsonContract, { sent: 1, failed: 0 });
  assert.equal((await run(PHP, ['-r', outboxStatusScript], { env })).stdout, 'sent', '2xx may be accepted only when response validation is explicitly disabled');
  await new Promise((resolve) => relayServer.close(resolve));
  await writeConfig(deployRoot, activeSettings());

  const mutateOld = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $p=Egoe\\Leads\\Database::connect(getenv('EGOE_DEPLOY_ROOT')); $id='${first.leadId}'; $p->prepare("UPDATE leads SET received_at=datetime('now','-400 days') WHERE lead_id=?")->execute([$id]); $p->prepare("UPDATE consent_evidence SET received_at=datetime('now','-1000 days') WHERE lead_id=?")->execute([$id]);`;
  await run(PHP, ['-r', mutateOld], { env });
  const backupDirectory = path.join(deployRoot, 'shared/leads/backups');
  await fs.mkdir(backupDirectory, { recursive: true });
  const staleBackup = path.join(backupDirectory, 'leads-20200101-000000-deadbeef.sqlite3');
  const unrelated = path.join(backupDirectory, 'keep-me.sqlite3');
  await fs.writeFile(staleBackup, 'old');
  await fs.writeFile(unrelated, 'old');
  const staleTime = new Date(Date.now() - 31 * 86400000);
  await fs.utimes(staleBackup, staleTime, staleTime);
  await fs.utimes(unrelated, staleTime, staleTime);

  const pruneScript = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; echo Egoe\\Leads\\BackupRetention::prune($argv[1], time());`;
  const globFailureScript = `namespace Egoe\\Leads { function glob(string $pattern): array|false { return false; } } namespace { require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; Egoe\\Leads\\BackupRetention::prune($argv[1], time()); }`;
  await assert.rejects(
    run(PHP, ['-r', globFailureScript, backupDirectory], { env }),
    (error) => failureText(error).includes('Unable to enumerate lead backups'),
    'a glob failure must make backup pruning nonzero'
  );
  await assert.rejects(
    run(PHP, ['-r', pruneScript, path.join(deployRoot, 'shared/leads/missing-backups')], { env }),
    (error) => failureText(error).includes('unavailable or unsafe'),
    'an unreadable/missing backup directory must fail closed'
  );
  const unlinkFailureDirectory = path.join(deployRoot, 'shared/leads/unlink-failure');
  await fs.mkdir(unlinkFailureDirectory, { mode: 0o700 });
  const undeletableBackup = path.join(unlinkFailureDirectory, 'leads-20200101-000000-cafebabe.sqlite3');
  await fs.writeFile(undeletableBackup, 'old', { mode: 0o600 });
  await fs.utimes(undeletableBackup, staleTime, staleTime);
  await fs.chmod(unlinkFailureDirectory, 0o500);
  try {
    await assert.rejects(
      run(PHP, ['-r', pruneScript, unlinkFailureDirectory], { env }),
      (error) => failureText(error).includes('Unable to delete expired lead backup'),
      'an unlink failure must make backup pruning nonzero'
    );
  } finally {
    await fs.chmod(unlinkFailureDirectory, 0o700);
  }

  await run(PHP, [cli, 'retention'], { env });
  await assert.rejects(fs.access(staleBackup));
  await fs.access(unrelated);
  const generatedBackups = (await fs.readdir(backupDirectory)).filter((name) => /^leads-\d{8}-\d{6}-[0-9a-f]{8}\.sqlite3$/.test(name));
  assert.ok(generatedBackups.length >= 1);
  assert.equal((await fs.stat(path.join(backupDirectory, generatedBackups.at(-1)))).mode & 0o777, 0o600);
  assert.doesNotMatch(
    await fs.readFile(cli, 'utf8'),
    /VACUUM\s+INTO/i,
    'backup must remain compatible with REG.RU SQLite 3.26'
  );
  const lifecycleLog = path.join(deployRoot, 'shared/leads/lifecycle.log');
  assert.match(await fs.readFile(lifecycleLog, 'utf8'), /DELETED leads=\d+ evidence=\d+ backups=\d+/);
  assert.equal((await fs.stat(lifecycleLog)).mode & 0o077, 0);
  counts = JSON.parse((await run(PHP, ['-r', queryScript], { env })).stdout);
  assert.equal(counts.evidence >= 1, true, '365-day lead deletion must retain 3-year consent evidence');
  await assert.rejects(run(PHP, [cli, 'view', first.leadId], { env }));
  const evidenceCount = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $p=Egoe\\Leads\\Database::connect(getenv('EGOE_DEPLOY_ROOT')); $q=$p->prepare('SELECT count(*) FROM consent_evidence WHERE lead_id=?'); $q->execute(['${first.leadId}']); echo $q->fetchColumn();`;
  assert.equal((await run(PHP, ['-r', evidenceCount], { env })).stdout, '1');
  const expireEvidence = `require '${path.join(release, 'api/leads/lib/LeadBackend.php').replaceAll("'", "\\'")}'; $p=Egoe\\Leads\\Database::connect(getenv('EGOE_DEPLOY_ROOT')); $p->prepare("UPDATE consent_evidence SET received_at=datetime('now','-1100 days') WHERE lead_id=?")->execute(['${first.leadId}']);`;
  await run(PHP, ['-r', expireEvidence], { env });
  await run(PHP, [cli, 'retention'], { env });
  assert.equal((await run(PHP, ['-r', evidenceCount], { env })).stdout, '0');

  const deleteTarget = lead();
  await writeConfig(deployRoot, activeSettings());
  await run(PHP, ['-r', clearRate], { env });
  assert.equal((await post(deleteTarget)).response.status, 201);
  const deleted = await run(PHP, [cli, 'delete', deleteTarget.leadId, '--with-evidence'], { env });
  assert.match(deleted.stdout, /lead=1 evidence=1 evidenceRetained=false/);

  const retainedEvidenceTarget = lead();
  await run(PHP, ['-r', clearRate], { env });
  assert.equal((await post(retainedEvidenceTarget)).response.status, 201);
  const retained = await run(PHP, [cli, 'delete', retainedEvidenceTarget.leadId], { env });
  assert.match(retained.stdout, /lead=1 evidence=0 evidenceRetained=true/);
  const retainedEvidenceCount = evidenceCount.replace(first.leadId, retainedEvidenceTarget.leadId);
  assert.equal((await run(PHP, ['-r', retainedEvidenceCount], { env })).stdout, '1');
  const erasedEvidence = await run(PHP, [cli, 'delete', retainedEvidenceTarget.leadId, '--with-evidence'], { env });
  assert.match(erasedEvidence.stdout, /lead=0 evidence=1 evidenceRetained=false/);
});
