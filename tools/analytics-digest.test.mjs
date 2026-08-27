import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHP = process.env.EGOE_PHP_BIN || 'php';
const CLI = path.join(ROOT, 'api/leads/cli/daily-report.php');
const RUNNER = path.join(ROOT, 'ops/analytics/run-daily.sh');
const FIXTURES = path.join(ROOT, 'ops/analytics/fixtures');
const REPORT_DATE = '2026-08-26';
const MOCK_TOKEN = 'test-oauth-token-never-print';

function run(file, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd: ROOT, encoding: 'utf8', ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function failureText(error) {
  return `${error?.stdout || ''}\n${error?.stderr || ''}`;
}

function settings(overrides = {}) {
  const defaults = {
    timezone: 'Europe/Moscow',
    leads: {
      source: 'json',
      sqlite_path: '',
      json_path: path.join(FIXTURES, 'leads.json')
    },
    privacy: { minimum_reportable_count: 1 },
    yandex_webmaster: {
      enabled: false,
      oauth_token_env: 'TEST_YANDEX_WEBMASTER_TOKEN',
      oauth_token: '',
      api_base_url: 'https://api.webmaster.yandex.net/v4',
      site_urls: ['https://www.egoe-life.ru/', 'https://egoe-life.ru/'],
      host_id: '',
      timeout_seconds: 3
    },
    delivery: {
      enabled: false,
      url: '',
      url_sha256: '',
      receipts_dir: '',
      timeout_seconds: 3
    }
  };
  return {
    ...defaults,
    ...overrides,
    leads: { ...defaults.leads, ...(overrides.leads || {}) },
    privacy: { ...defaults.privacy, ...(overrides.privacy || {}) },
    yandex_webmaster: { ...defaults.yandex_webmaster, ...(overrides.yandex_webmaster || {}) },
    delivery: { ...defaults.delivery, ...(overrides.delivery || {}) }
  };
}

async function writeConfig(directory, value, mode = 0o600) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  const body = `<?php\ndeclare(strict_types=1);\nreturn json_decode(base64_decode('${encoded}'), true, 512, JSON_THROW_ON_ERROR);\n`;
  const target = path.join(directory, `config-${crypto.randomUUID()}.php`);
  await fs.writeFile(target, body, { mode });
  await fs.chmod(target, mode);
  return target;
}

async function runReport(config, extraArgs = [], env = {}) {
  return run(PHP, [CLI, '--config', config, '--date', REPORT_DATE, ...extraArgs], {
    env: { ...process.env, ...env }
  });
}

async function loadFixture(name) {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, name), 'utf8'));
}

async function startWebmasterMock(t, { failSummary = false } = {}) {
  const fixtureByPath = new Map([
    ['/v4/user', await loadFixture('yandex-user.json')],
    ['/v4/user/123456789/hosts', await loadFixture('yandex-hosts.json')],
    [
      '/v4/user/123456789/hosts/https%3Awww.egoe-life.ru%3A443/summary',
      await loadFixture('yandex-summary.json')
    ],
    [
      '/v4/user/123456789/hosts/https%3Awww.egoe-life.ru%3A443/search-queries/all/history',
      await loadFixture('yandex-search-history.json')
    ]
  ]);
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({
      path: url.pathname,
      query: url.searchParams,
      authorization: request.headers.authorization
    });
    if (request.headers.authorization !== `OAuth ${MOCK_TOKEN}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end('{"error":"unauthorized"}');
      return;
    }
    if (failSummary && url.pathname.endsWith('/summary')) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end('{"error":"temporary"}');
      return;
    }
    const fixture = fixtureByPath.get(url.pathname);
    if (!fixture) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"not_found"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(fixture));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v4`, requests };
}

async function startDeliveryMock(t, responseBody = { ok: true }, status = 200) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ method: request.method, headers: request.headers, body });
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(responseBody));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/daily`, requests };
}

test('PHP 8.2 runtime provides the production extensions', async () => {
  await run(PHP, [
    '-r',
    "exit(PHP_VERSION_ID >= 80200 && extension_loaded('sqlite3') && extension_loaded('curl') ? 0 : 1);"
  ]);
});

test('site contract deploys only the hidden analytics runtime, never ops fixtures or config', async () => {
  const contract = JSON.parse(await fs.readFile(path.join(ROOT, 'config/site-contract.json'), 'utf8'));
  const runtime = ['api/leads/lib/DailyAnalytics.php', 'api/leads/cli/daily-report.php'];
  for (const file of runtime) {
    assert.ok(contract.build.allowedPhpFiles.includes(file));
    assert.ok(contract.requiredFiles.includes(file));
  }
  assert.equal(contract.build.publicDirectories.includes('ops'), false);
  assert.equal(contract.build.allowedPhpFiles.some((file) => file.startsWith('ops/analytics/')), false);
  const htaccess = await fs.readFile(path.join(ROOT, '.htaccess'), 'utf8');
  assert.match(htaccess, /RewriteRule \^api\/leads\/\(\?:cli\|lib\)\(\?:\/\|\$\) - \[R=404,L,NC\]/);
});

test('JSON report uses Moscow day boundaries, exact internal KPIs, and stays flat', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-json-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const config = await writeConfig(temporary, settings());
  const { stdout, stderr } = await runReport(config, ['--no-yandex']);
  const report = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(report.schema, 'egoe.daily-analytics.v1');
  assert.equal(report.report_id, `egoe-${REPORT_DATE}`);
  assert.equal(report.report_timezone, 'Europe/Moscow');
  assert.equal(report.lead_source, 'json');
  assert.equal(report.count_policy, 'exact');
  assert.equal(report.accepted_leads_proxy, '6');
  assert.equal(report.leads_total, '6');
  assert.equal(report.kp_requests, '2');
  assert.equal(report.regular_requests, '4');
  assert.equal(Object.hasOwn(report, 'other_requests'), false);
  assert.equal(report.previous_day_leads, '1');
  assert.equal(report.leads_delta_vs_previous, 5);
  assert.equal(report.leads_change_percent, 500);
  assert.equal(report.kp_pipeline_rub, 186810);
  assert.equal(report.kp_pipeline_status, 'ok');
  assert.equal(report.top_form_sources, 'обычные: 4; КП: 2');
  assert.equal(report.top_page_sources, 'корзина/КП: 2; контакты: 2; каталог: 1');
  assert.equal(report.yandex_status, 'disabled');
  assert.ok(Object.values(report).every((value) => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
  assert.doesNotMatch(stdout, /TEST-SECRET-MUST-NOT-LEAK|received_at|form_id/);
  assert.match(report['Сообщение'], /Принятые заявки \(proxy, не продажи\): 6/);
  assert.match(report['Сообщение'], /Остальные формы \(не КП\): 4/);
  assert.match(report['Сообщение'], /pipeline: 186 810 ₽/);
});

test('small-cell suppression remains an optional policy', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-suppression-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const config = await writeConfig(temporary, settings({ privacy: { minimum_reportable_count: 5 } }));
  const report = JSON.parse((await runReport(config, ['--no-yandex'])).stdout);

  assert.equal(report.accepted_leads_proxy, '6');
  assert.equal(report.kp_requests, '<5');
  assert.equal(report.regular_requests, '<5');
  assert.equal(report.previous_day_leads, '<5');
  assert.equal(report.leads_delta_vs_previous, null);
  assert.equal(report.kp_pipeline_rub, null);
  assert.equal(report.kp_pipeline_status, 'suppressed');
  assert.match(report.top_form_sources, /обычные: <5/);
});

test('lead-only digest remains available when optional Yandex OAuth is missing', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-no-oauth-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const config = await writeConfig(temporary, settings({
    yandex_webmaster: { enabled: true }
  }));
  const report = JSON.parse((await runReport(config, [], { TEST_YANDEX_WEBMASTER_TOKEN: '' })).stdout);

  assert.equal(report.accepted_leads_proxy, '6');
  assert.equal(report.kp_pipeline_rub, 186810);
  assert.equal(report.yandex_status, 'error');
  assert.equal(report.yandex_summary_error, 'yandex_token_missing');
  assert.equal(report.yandex_search_error, 'yandex_token_missing');
});

test('SQLite source is opened read-only and yields the same aggregate', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-sqlite-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const database = path.join(temporary, 'leads.sqlite3');
  const fixture = path.join(FIXTURES, 'leads.json');
  const createDatabase = String.raw`
    $rows=json_decode(file_get_contents($argv[2]), true, 32, JSON_THROW_ON_ERROR)['leads'];
    $db=new SQLite3($argv[1]);
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('CREATE TABLE leads (lead_id TEXT PRIMARY KEY, received_at TEXT NOT NULL, form_id TEXT NOT NULL, page_path TEXT NOT NULL, payload_json TEXT NOT NULL)');
    $db->exec("CREATE TABLE outbox (id INTEGER PRIMARY KEY, status TEXT NOT NULL, sent_at TEXT)");
    $stmt=$db->prepare('INSERT INTO leads (lead_id, received_at, form_id, page_path, payload_json) VALUES (:id, :received, :form, :page, :payload)');
    foreach ($rows as $index=>$row) {
      $stmt->bindValue(':id', sprintf('00000000-0000-4000-8000-%012d', $index), SQLITE3_TEXT);
      $stmt->bindValue(':received', $row['received_at'], SQLITE3_TEXT);
      $stmt->bindValue(':form', $row['form_id'], SQLITE3_TEXT);
      $stmt->bindValue(':page', $row['page_path'] ?? '/', SQLITE3_TEXT);
      $stmt->bindValue(':payload', json_encode(['fields'=>['Итого'=>$row['quote_total_rub'] ?? null]], JSON_UNESCAPED_UNICODE), SQLITE3_TEXT);
      $stmt->execute();
    }
    $db->exec("INSERT INTO outbox (status,sent_at) VALUES ('sent','2026-08-26T10:00:00.000Z'),('sent','2026-08-26T12:00:00.000Z'),('failed',NULL),('pending',NULL)");
    $db->close();
    chmod($argv[1], 0600);
  `;
  await run(PHP, ['-r', createDatabase, database, fixture]);
  const before = await fs.readFile(database);
  const config = await writeConfig(temporary, settings({
    leads: { source: 'sqlite', sqlite_path: database, json_path: '' }
  }));
  const report = JSON.parse((await runReport(config, ['--no-yandex'])).stdout);
  const after = await fs.readFile(database);

  assert.equal(report.lead_source, 'sqlite');
  assert.equal(report.leads_total, '6');
  assert.equal(report.kp_requests, '2');
  assert.equal(report.kp_pipeline_rub, 186810);
  assert.equal(report.outbox_status, 'attention');
  assert.equal(report.outbox_sent, 2);
  assert.equal(report.outbox_failed, 1);
  assert.equal(report.outbox_pending, 1);
  assert.deepEqual(after, before, 'daily summary must not mutate the SQLite database');
  await assert.rejects(fs.access(`${database}-journal`));
});

test('Yandex Webmaster uses OAuth, discovers the verified canonical host, and requests repeated indicators', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-yandex-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const mock = await startWebmasterMock(t);
  const config = await writeConfig(temporary, settings({
    yandex_webmaster: { enabled: true, api_base_url: mock.baseUrl }
  }));
  const { stdout, stderr } = await runReport(config, [], {
    EGOE_ANALYTICS_TESTING: '1',
    TEST_YANDEX_WEBMASTER_TOKEN: MOCK_TOKEN
  });
  const report = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(report.yandex_status, 'ok');
  assert.equal(report.yandex_host_url, 'https://www.egoe-life.ru/');
  assert.equal(report.yandex_sqi, 120);
  assert.equal(report.yandex_searchable_pages, 306);
  assert.equal(report.yandex_excluded_pages, 14);
  assert.equal(report.yandex_problems_critical, 1);
  assert.equal(report.yandex_impressions, 125);
  assert.equal(report.yandex_clicks, 10);
  assert.equal(report.yandex_ctr_percent, 8);
  assert.equal(report.yandex_avg_show_position, 7.25);
  assert.equal(report.yandex_data_date, REPORT_DATE);
  assert.equal(mock.requests.length, 4);
  assert.ok(mock.requests.every((request) => request.authorization === `OAuth ${MOCK_TOKEN}`));
  const search = mock.requests.find((request) => request.path.endsWith('/search-queries/all/history'));
  assert.deepEqual(search.query.getAll('query_indicator'), [
    'TOTAL_SHOWS',
    'TOTAL_CLICKS',
    'AVG_SHOW_POSITION'
  ]);
  assert.equal(search.query.get('device_type_indicator'), 'ALL');
  assert.equal(search.query.get('date_from'), REPORT_DATE);
  assert.equal(search.query.get('date_to'), REPORT_DATE);
  assert.doesNotMatch(`${stdout}\n${stderr}`, new RegExp(MOCK_TOKEN));
});

test('a Yandex summary outage degrades to partial without losing the local lead report', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-partial-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const mock = await startWebmasterMock(t, { failSummary: true });
  const config = await writeConfig(temporary, settings({
    yandex_webmaster: { enabled: true, api_base_url: mock.baseUrl }
  }));
  const report = JSON.parse((await runReport(config, [], {
    EGOE_ANALYTICS_TESTING: '1',
    TEST_YANDEX_WEBMASTER_TOKEN: MOCK_TOKEN
  })).stdout);

  assert.equal(report.leads_total, '6');
  assert.equal(report.yandex_status, 'partial');
  assert.equal(report.yandex_summary_status, 'error');
  assert.equal(report.yandex_summary_error, 'yandex_http_503');
  assert.equal(report.yandex_search_status, 'ok');
  assert.equal(report.yandex_impressions, 125);
});

test('send mode posts exactly two presentation fields and records an idempotent private receipt', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-send-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const receipts = path.join(temporary, 'receipts');
  await fs.mkdir(receipts, { mode: 0o700 });
  await fs.chmod(receipts, 0o700);
  const mock = await startDeliveryMock(t);
  const config = await writeConfig(temporary, settings({
    delivery: {
      enabled: true,
      url: mock.url,
      url_sha256: crypto.createHash('sha256').update(mock.url).digest('hex'),
      receipts_dir: receipts
    }
  }));
  const environment = { EGOE_ANALYTICS_TESTING: '1' };
  const first = JSON.parse((await runReport(config, ['--no-yandex', '--send'], environment)).stdout);

  assert.equal(first.delivery_status, 'sent');
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].method, 'POST');
  assert.equal(mock.requests[0].headers['idempotency-key'], `egoe-${REPORT_DATE}`);
  const delivered = JSON.parse(mock.requests[0].body);
  assert.deepEqual(Object.keys(delivered), ['_subject', 'Сообщение']);
  assert.equal(delivered._subject, first._subject);
  assert.equal(delivered.Сообщение, first.Сообщение);
  assert.doesNotMatch(mock.requests[0].body, /accepted_leads_proxy|kp_pipeline_rub|outbox_failed|TEST-SECRET/);

  const receipt = path.join(receipts, `sent-${REPORT_DATE}.json`);
  const receiptBody = JSON.parse(await fs.readFile(receipt, 'utf8'));
  assert.equal((await fs.stat(receipt)).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(receiptBody), ['schema', 'report_id', 'payload_sha256', 'sent_at']);
  assert.doesNotMatch(JSON.stringify(receiptBody), /Сообщение|Заявки|http/);

  const second = JSON.parse((await runReport(config, ['--no-yandex', '--send'], environment)).stdout);
  assert.equal(second.delivery_status, 'already_sent');
  assert.equal(mock.requests.length, 1, 'a matching receipt must prevent duplicate delivery');
});

test('send mode requires an explicit ok response and leaves no false receipt', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-send-fail-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const receipts = path.join(temporary, 'receipts');
  await fs.mkdir(receipts, { mode: 0o700 });
  await fs.chmod(receipts, 0o700);
  const mock = await startDeliveryMock(t, { ok: false });
  const config = await writeConfig(temporary, settings({
    delivery: {
      enabled: true,
      url: mock.url,
      url_sha256: crypto.createHash('sha256').update(mock.url).digest('hex'),
      receipts_dir: receipts
    }
  }));

  await assert.rejects(runReport(config, ['--no-yandex', '--send'], { EGOE_ANALYTICS_TESTING: '1' }), (error) => {
    assert.match(failureText(error), /ERROR \[delivery_response_rejected\]/);
    return true;
  });
  assert.equal(mock.requests.length, 1);
  assert.deepEqual(await fs.readdir(receipts), []);
});

test('send mode rejects redirects and unsafe receipt targets without false success', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-send-safe-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const receipts = path.join(temporary, 'receipts');
  await fs.mkdir(receipts, { mode: 0o700 });
  await fs.chmod(receipts, 0o700);
  const redirect = await startDeliveryMock(t, { ok: true }, 302);
  let config = await writeConfig(temporary, settings({
    delivery: {
      enabled: true,
      url: redirect.url,
      url_sha256: crypto.createHash('sha256').update(redirect.url).digest('hex'),
      receipts_dir: receipts
    }
  }));
  const environment = { EGOE_ANALYTICS_TESTING: '1' };
  await assert.rejects(runReport(config, ['--no-yandex', '--send'], environment), (error) => {
    assert.match(failureText(error), /ERROR \[delivery_failed\]/);
    return true;
  });
  assert.deepEqual(await fs.readdir(receipts), []);

  const target = path.join(temporary, 'must-not-change');
  await fs.writeFile(target, 'safe');
  await fs.symlink(target, path.join(receipts, `sent-${REPORT_DATE}.json`));
  const ok = await startDeliveryMock(t);
  config = await writeConfig(temporary, settings({
    delivery: {
      enabled: true,
      url: ok.url,
      url_sha256: crypto.createHash('sha256').update(ok.url).digest('hex'),
      receipts_dir: receipts
    }
  }));
  await assert.rejects(runReport(config, ['--no-yandex', '--send'], environment), (error) => {
    assert.match(failureText(error), /ERROR \[delivery_receipt_invalid\]/);
    return true;
  });
  assert.equal(ok.requests.length, 0);
  assert.equal(await fs.readFile(target, 'utf8'), 'safe');
});

test('unsafe configuration fails closed and does not expose secrets', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-unsafe-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const config = await writeConfig(temporary, settings({
    yandex_webmaster: {
      enabled: true,
      oauth_token: MOCK_TOKEN,
      api_base_url: 'https://attacker.example/v4'
    }
  }));
  await assert.rejects(runReport(config), (error) => {
    const text = failureText(error);
    assert.match(text, /ERROR \[yandex_api_base_invalid\]/);
    assert.doesNotMatch(text, new RegExp(MOCK_TOKEN));
    return true;
  });
});

test('group-readable configuration is rejected before collection', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-mode-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const config = await writeConfig(temporary, settings(), 0o640);
  await assert.rejects(runReport(config), (error) => {
    assert.match(failureText(error), /ERROR \[config_permissions\]/);
    return true;
  });
});

test('cron runner publishes one private validated aggregate atomically', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'egoe-analytics-runner-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const config = await writeConfig(temporary, settings());
  const outbox = path.join(temporary, 'outbox');
  const environment = {
    ...process.env,
    EGOE_ANALYTICS_PHP_BIN: PHP,
    EGOE_ANALYTICS_CLI: CLI,
    EGOE_ANALYTICS_CONFIG: config,
    EGOE_ANALYTICS_OUTBOX: outbox
  };
  const first = await run(RUNNER, [], { env: environment });
  const target = first.stdout.trim();
  const payload = JSON.parse(await fs.readFile(target, 'utf8'));

  assert.equal(first.stderr, '');
  assert.equal(path.dirname(target), outbox);
  assert.equal(path.basename(target), `daily-report-${payload.report_date}.json`);
  assert.equal(payload.schema, 'egoe.daily-analytics.v1');
  assert.equal((await fs.stat(outbox)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(outbox), [path.basename(target)]);

  const second = await run(RUNNER, [], { env: environment });
  assert.equal(second.stdout.trim(), target);
  assert.deepEqual(await fs.readdir(outbox), [path.basename(target)]);
});
