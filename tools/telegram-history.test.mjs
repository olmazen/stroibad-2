import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import https from 'node:https';
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

async function writePhpConfig(target, value) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  const body = `<?php\ndeclare(strict_types=1);\nreturn json_decode(base64_decode('${encoded}'), true, 512, JSON_THROW_ON_ERROR);\n`;
  await fs.writeFile(target, body, { mode: 0o600 });
  await fs.chmod(target, 0o600);
}

test('Telegram history callback edits one bot message and enforces chat/user/button allowlists', async (t) => {
  execFileSync(PHP, ['-r', "exit(PHP_VERSION_ID >= 80200 && extension_loaded('pdo_sqlite') && extension_loaded('mbstring') && extension_loaded('curl') ? 0 : 1);"], { stdio: 'ignore' });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-telegram-history-'));
  t.after(async () => fs.rm(temporary, { recursive: true, force: true }));
  const deployRoot = path.join(temporary, 'deploy');
  await fs.mkdir(path.join(deployRoot, 'state'), { recursive: true, mode: 0o755 });
  await fs.mkdir(path.join(deployRoot, 'shared'), { recursive: true, mode: 0o755 });
  await fs.chmod(deployRoot, 0o755);
  await fs.chmod(path.join(deployRoot, 'state'), 0o755);
  await fs.writeFile(path.join(deployRoot, 'state/site-hostname'), 'egoe-life.ru\n', { mode: 0o600 });
  await fs.writeFile(path.join(deployRoot, 'state/telegram-history-approved'), 'egoe-life.ru', { mode: 0o600 });
  await fs.chmod(path.join(deployRoot, 'state/telegram-history-approved'), 0o600);

  const cli = path.join(ROOT, 'api/leads/cli/leads.php');
  const env = { ...process.env, EGOE_DEPLOY_ROOT: deployRoot };
  await run(PHP, [cli, 'init'], { env });
  const leadConfigPath = path.join(deployRoot, 'shared/leads/config.php');
  const leadSettings = {
    site_host: 'www.egoe-life.ru',
    allowed_hosts: ['www.egoe-life.ru', 'egoe-life.ru'],
    collection_enabled: false,
    consent_version: '2026-08-27',
    ip_hash_key: '0123456789abcdef'.repeat(4),
    minimum_elapsed_ms: 600,
    rate_limit: { max_requests: 5, window_seconds: 600 },
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
      timeout_seconds: 3,
      ca_file: '',
      url_sha256: '',
      require_json_ok: true
    }
  };
  await writePhpConfig(leadConfigPath, leadSettings);
  const telegramDirectory = path.join(deployRoot, 'shared/telegram');
  await fs.mkdir(telegramDirectory, { mode: 0o700 });
  await fs.chmod(telegramDirectory, 0o700);
  await writePhpConfig(path.join(telegramDirectory, 'config.php'), {
    enabled: true,
    bot_token: `123456789:${'A'.repeat(35)}`,
    webhook_secret: 's'.repeat(48),
    allowed_chat_ids: ['-1001234567890'],
    allowed_user_ids: ['777000111'],
    timeout_seconds: 3,
    max_history_entries: 10
  });

  const harness = path.join(ROOT, 'tools/telegram-history-harness.php');
  const result = JSON.parse((await run(PHP, [harness], { env })).stdout);
  assert.equal(result.historyCallbackBytes, 40, 'callback data must stay below Telegram 64-byte limit');

  assert.deepEqual(result.history.map((call) => call.method), ['editMessageText', 'answerCallbackQuery']);
  const historyEdit = result.history[0].parameters;
  assert.equal(historyEdit.chat_id, '-1001234567890');
  assert.equal(historyEdit.message_id, 55);
  assert.match(historyEdit.text, /📚 История клиента/);
  assert.match(historyEdit.text, /Обращений: 2/);
  assert.match(historyEdit.text, /Известная сумма: 35 000 ₽/);
  assert.match(historyEdit.text, /\/catalog\/.*→.*\/cart\//s);
  assert.equal(historyEdit.text.includes('Customer@example.com'), false);
  assert.equal(historyEdit.text.includes('7927'), false);
  assert.equal(historyEdit.reply_markup.inline_keyboard[0][0].callback_data, 'cl1:22222222-2222-4222-8222-222222222222');

  assert.deepEqual(result.lead.map((call) => call.method), ['editMessageText', 'answerCallbackQuery']);
  const leadEdit = result.lead[0].parameters;
  assert.match(leadEdit.text, /🔔 Заявка с сайта EGOE/);
  assert.match(leadEdit.text, /Телефон: \+7 927 123-45-67/);
  assert.match(leadEdit.text, /^Компания:$/m, 'empty legacy fields must survive the back navigation');
  assert.equal(leadEdit.text.includes('https://www.egoe-life.ru/'), false, 'back navigation must not reveal the page URL');
  assert.equal(leadEdit.reply_markup.inline_keyboard[0][0].url, 'https://wa.me/79271234567');
  assert.equal(leadEdit.reply_markup.inline_keyboard[1][0].callback_data, 'ch1:22222222-2222-4222-8222-222222222222');

  assert.deepEqual(result.unauthorized.map((call) => call.method), ['answerCallbackQuery']);
  assert.equal(result.unauthorized[0].parameters.show_alert, true);
  assert.deepEqual(result.forged.map((call) => call.method), ['answerCallbackQuery']);
  assert.equal(result.forged[0].parameters.show_alert, true);
  assert.deepEqual(
    result.alreadyModified.map((call) => call.method),
    ['editMessageText', 'answerCallbackQuery'],
    'a safely repeated Telegram update must still clear the callback spinner'
  );
});

test('direct Telegram sender uses the SQLite outbox, real HTTPS and one atomic claim', async (t) => {
  execFileSync(PHP, ['-r', "exit(PHP_VERSION_ID >= 80200 && extension_loaded('pdo_sqlite') && extension_loaded('mbstring') && extension_loaded('curl') ? 0 : 1);"], { stdio: 'ignore' });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-telegram-delivery-'));
  t.after(async () => fs.rm(temporary, { recursive: true, force: true }));
  const deployRoot = path.join(temporary, 'deploy');
  await fs.mkdir(path.join(deployRoot, 'state'), { recursive: true, mode: 0o755 });
  await fs.mkdir(path.join(deployRoot, 'shared'), { recursive: true, mode: 0o755 });
  await fs.chmod(deployRoot, 0o755);
  await fs.chmod(path.join(deployRoot, 'state'), 0o755);
  await fs.writeFile(path.join(deployRoot, 'state/site-hostname'), 'egoe-life.ru\n', { mode: 0o600 });
  await fs.writeFile(path.join(deployRoot, 'state/collection-approved'), 'egoe-life.ru', { mode: 0o600 });
  await fs.writeFile(path.join(deployRoot, 'state/telegram-history-approved'), 'egoe-life.ru', { mode: 0o600 });
  await fs.chmod(path.join(deployRoot, 'state/telegram-history-approved'), 0o600);

  const env = { ...process.env, EGOE_DEPLOY_ROOT: deployRoot };
  const leadCli = path.join(ROOT, 'api/leads/cli/leads.php');
  const telegramCli = path.join(ROOT, 'api/telegram/cli/telegram.php');
  await run(PHP, [leadCli, 'init'], { env });
  const leadConfigPath = path.join(deployRoot, 'shared/leads/config.php');
  const leadSettings = {
    site_host: 'www.egoe-life.ru',
    allowed_hosts: ['www.egoe-life.ru', 'egoe-life.ru'],
    collection_enabled: true,
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
      timeout_seconds: 3,
      ca_file: '',
      url_sha256: '',
      require_json_ok: true
    }
  };
  await writePhpConfig(leadConfigPath, leadSettings);
  const telegramDirectory = path.join(deployRoot, 'shared/telegram');
  await fs.mkdir(telegramDirectory, { mode: 0o700 });
  await fs.chmod(telegramDirectory, 0o700);
  const botToken = `123456789:${'A'.repeat(35)}`;
  await writePhpConfig(path.join(telegramDirectory, 'config.php'), {
    enabled: true,
    send_leads: true,
    bot_token: botToken,
    webhook_secret: 's'.repeat(48),
    delivery_chat_id: '-1001234567890',
    allowed_chat_ids: ['-1001234567890'],
    allowed_user_ids: ['777000111'],
    timeout_seconds: 3,
    max_history_entries: 10
  });

  const gatedHealth = JSON.parse((await run(PHP, [telegramCli, 'health'], { env })).stdout);
  assert.equal(gatedHealth.historyEnabled, true);
  assert.equal(gatedHealth.deliveryEnabled, false, 'config alone must not enable direct delivery');
  const deliveryMarker = path.join(deployRoot, 'state/telegram-delivery-approved');
  await fs.writeFile(deliveryMarker, 'egoe-life.ru\n', { mode: 0o600 });
  assert.equal(
    JSON.parse((await run(PHP, [telegramCli, 'health'], { env })).stdout).deliveryEnabled,
    false,
    'delivery marker bytes must match exactly'
  );
  await fs.writeFile(deliveryMarker, 'egoe-life.ru');
  await fs.chmod(deliveryMarker, 0o640);
  assert.equal(
    JSON.parse((await run(PHP, [telegramCli, 'health'], { env })).stdout).deliveryEnabled,
    false,
    'delivery marker must use exact private mode 0600'
  );
  await fs.chmod(deliveryMarker, 0o600);
  const activeHealth = JSON.parse((await run(PHP, [telegramCli, 'health'], { env })).stdout);
  assert.equal(activeHealth.deliveryEnabled, true);

  const relayUrl = 'https://example.invalid/relay';
  await writePhpConfig(leadConfigPath, {
    ...leadSettings,
    relay: {
      ...leadSettings.relay,
      enabled: true,
      url: relayUrl,
      mode: 'signal',
      allow_signal: true,
      cross_border_confirmed: true,
      url_sha256: crypto.createHash('sha256').update(relayUrl).digest('hex')
    }
  });
  const relayMarker = path.join(deployRoot, 'state/relay-approved');
  await fs.writeFile(relayMarker, 'egoe-life.ru', { mode: 0o600 });
  await fs.chmod(relayMarker, 0o600);
  await assert.rejects(run(PHP, [leadCli, 'health'], { env }), (error) => {
    assert.match(String(error.stderr), /Only one external lead transport may be enabled/);
    return true;
  });
  await fs.unlink(relayMarker);
  await writePhpConfig(leadConfigPath, leadSettings);

  const tlsDirectory = path.join(temporary, 'tls');
  await fs.mkdir(tlsDirectory, { mode: 0o700 });
  const tlsKey = path.join(tlsDirectory, 'telegram-test.key');
  const tlsCertificate = path.join(tlsDirectory, 'telegram-test.crt');
  await run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', tlsKey, '-out', tlsCertificate,
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'
  ]);
  const requests = [];
  let responseMode = 'success';
  let responseDelayMs = 0;
  const server = https.createServer({
    key: await fs.readFile(tlsKey),
    cert: await fs.readFile(tlsCertificate)
  }, (request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      const finish = () => {
        response.writeHead(responseMode === 'success' ? 200 : 500, { 'Content-Type': 'application/json' });
        response.end(responseMode === 'success'
          ? JSON.stringify({
              ok: true,
              result: {
                message_id: 901,
                chat: { id: -1001234567890, type: 'supergroup' }
              }
            })
          : JSON.stringify({ ok: false, error_code: 500, description: 'test failure' }));
      };
      if (responseDelayMs > 0) setTimeout(finish, responseDelayMs);
      else finish();
    });
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => { if (server.listening) server.close(); });
  const address = server.address();
  assert.equal(typeof address, 'object');
  const transportEnv = {
    ...env,
    EGOE_TELEGRAM_TEST_API_BASE: `https://127.0.0.1:${address.port}`,
    EGOE_TELEGRAM_TEST_CA: tlsCertificate
  };
  const harness = path.join(ROOT, 'tools/telegram-delivery-harness.php');
  const firstLead = '33333333-3333-4333-8333-333333333333';
  assert.deepEqual(JSON.parse((await run(PHP, [harness, 'seed', firstLead], { env: transportEnv })).stdout), {
    duplicate: false,
    outboxId: 1
  });

  responseDelayMs = 150;
  const concurrent = await Promise.all([
    run(PHP, [harness, 'retry'], { env: transportEnv }),
    run(PHP, [harness, 'retry'], { env: transportEnv })
  ]);
  responseDelayMs = 0;
  const concurrentResults = concurrent.map(({ stdout }) => JSON.parse(stdout));
  assert.equal(concurrentResults.reduce((sum, value) => sum + value.sent, 0), 1);
  assert.equal(concurrentResults.reduce((sum, value) => sum + value.failed, 0), 0);
  assert.equal(requests.length, 1, 'two retry workers must issue one sendMessage call');

  const sent = requests[0];
  assert.equal(sent.method, 'POST');
  assert.equal(sent.url, `/bot${botToken}/sendMessage`);
  assert.match(sent.headers['content-type'], /^application\/json/);
  const message = JSON.parse(sent.body);
  assert.equal(message.chat_id, '-1001234567890');
  assert.equal(message.text, [
    '🔔 Заявка с сайта EGOE',
    'Имя: Екатерина',
    'Телефон: +79272295828',
    'E-mail: direct.test@example.invalid',
    'Компания:',
    'Позиции: • Скамейка стальная «Дуга» (RAL 7016) — 3 шт × 22 270 = 66 810 ₽',
    'Итого: 66 810 ₽',
    '№ КП: КП-2026-0827-123456'
  ].join('\n'), 'the direct sender must preserve the approved lead format without a page URL');
  assert.equal(message.reply_markup.inline_keyboard[0][0].url, 'https://wa.me/79272295828');
  assert.equal(message.reply_markup.inline_keyboard[1][0].callback_data, `ch1:${firstLead}`);

  assert.deepEqual(JSON.parse((await run(PHP, [harness, 'seed', firstLead], { env: transportEnv })).stdout), {
    duplicate: true,
    outboxId: null
  });
  assert.deepEqual(JSON.parse((await run(PHP, [harness, 'retry'], { env: transportEnv })).stdout), { sent: 0, failed: 0 });
  assert.equal(requests.length, 1, 'duplicate form/retry must not resend a confirmed message');

  const secondLead = '44444444-4444-4444-8444-444444444444';
  await run(PHP, [harness, 'seed', secondLead], { env: transportEnv });
  responseMode = 'failure';
  assert.deepEqual(JSON.parse((await run(PHP, [harness, 'retry'], { env: transportEnv })).stdout), { sent: 0, failed: 1 });
  await run(PHP, [harness, 'due'], { env: transportEnv });
  responseMode = 'success';
  assert.deepEqual(JSON.parse((await run(PHP, [harness, 'retry'], { env: transportEnv })).stdout), { sent: 1, failed: 0 });
  assert.deepEqual(JSON.parse((await run(PHP, [harness, 'retry'], { env: transportEnv })).stdout), { sent: 0, failed: 0 });
  assert.equal(requests.length, 3, 'a definitive failure is retried once and a sent row is never retried');
  const statuses = JSON.parse((await run(PHP, [harness, 'status'], { env: transportEnv })).stdout);
  assert.deepEqual(statuses.map(({ mode, status, attempts }) => ({ mode, status, attempts })), [
    { mode: 'telegram', status: 'sent', attempts: 1 },
    { mode: 'telegram', status: 'sent', attempts: 2 }
  ]);
});
