import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = JSON.parse(await fs.readFile(path.join(ROOT, 'config/site-contract.json'), 'utf8'));
const LEADS = CONTRACT.leadDelivery;

class FakeFormData {
  constructor() { this.entries = []; }
  append(name, value, filename) { this.entries.push([name, value, filename]); }
  get(name) { return this.entries.find((entry) => entry[0] === name)?.[1] ?? null; }
}

function browser(source, overrides = {}) {
  const events = [];
  const domReady = [];
  class FakeCustomEvent {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
  }
  const document = overrides.document || {
    readyState: 'loading',
    title: 'Тестовая страница',
    referrer: '',
    addEventListener(type, listener) { if (type === 'DOMContentLoaded') domReady.push(listener); }
  };
  const root = {
    document,
    location: { href: 'https://www.egoe-life.ru/test/', pathname: '/test/' },
    CustomEvent: FakeCustomEvent,
    dispatchEvent(event) { events.push(event); },
    FormData: FakeFormData,
    AbortController,
    crypto: { randomUUID: () => 'generated-lead-id' },
    fetch: overrides.fetch || (() => Promise.reject(new Error('Unexpected fetch'))),
    LEAD_CFG: { email: 'test@example.com', tgRelay: '', timeoutMs: 50 },
    ...overrides.window
  };
  const context = {
    window: root,
    console: { error() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Error,
    Date,
    Math,
    Number,
    Object,
    Array,
    String,
    WeakMap
  };
  vm.runInNewContext(source, context, { filename: LEADS.script });
  return { root, api: root.EGOE_LEADS, events, domReady };
}

async function leadSource() {
  return fs.readFile(path.join(ROOT, LEADS.script), 'utf8');
}

async function walkHtml(dir = ROOT, rel = '') {
  const skipped = new Set(['.git', '.private', 'dist', 'node_modules']);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isDirectory() && skipped.has(entry.name)) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walkHtml(child, childRel));
    else if (entry.isFile() && entry.name.endsWith('.html')) result.push(childRel);
  }
  return result.sort();
}

test('confirmed text submission carries context, normalized phone, and FormSubmit source URL', async () => {
  const requests = [];
  const source = await leadSource();
  const { api, events } = browser(source, {
    fetch(url, options) {
      requests.push({ url, options });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: 'true' }) });
    }
  });
  const result = await api.send({ 'Имя': 'Анна', 'Телефон': '8 927 123-45-67' }, 'форма', {
    leadId: 'lead-123',
    formId: 'test:request',
    context: { url: 'https://www.egoe-life.ru/test/', title: 'Тест', referrer: '' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.leadId, 'lead-123');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://formsubmit.co/ajax/test%40example.com');
  assert.equal(requests[0].options.headers.Accept, 'application/json');
  assert.equal(requests[0].options.headers['Content-Type'], undefined, 'browser must set the multipart boundary');
  assert.equal(requests[0].options.body.get('Телефон'), '+79271234567');
  assert.equal(requests[0].options.body.get('ID заявки'), 'lead-123');
  assert.equal(requests[0].options.body.get('Страница'), 'https://www.egoe-life.ru/test/');
  assert.equal(requests[0].options.body.get('Заголовок страницы'), 'Тест');
  assert.equal(requests[0].options.body.get('Версия согласия'), LEADS.consentVersion);
  assert.equal(requests[0].options.body.get('_url'), 'https://www.egoe-life.ru/test/');
  assert.equal(events.at(-1)?.type, 'egoe:lead-status');
  assert.equal(events.at(-1)?.detail.status, 'success');
  assert.equal(events.at(-1)?.detail.formId, 'test:request');
  assert.equal(events.at(-1)?.detail.leadId, 'lead-123');
  assert.equal(JSON.stringify(events.at(-1)?.detail).includes('7927'), false, 'public status event leaked contact data');
});

test('controlled API transport carries one validated multipart attachment', async () => {
  const requests = [];
  const source = await leadSource();
  const { api } = browser(source, {
    fetch(url, options) {
      requests.push({ url, options });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, leadId: 'api-lead-1' }) });
    },
    window: {
      LEAD_CFG: {
        provider: 'api', endpoint: '/api/leads', attachmentsEnabled: true,
        tgRelay: '', timeoutMs: 50, uploadTimeoutMs: 100
      }
    }
  });
  const file = { name: 'plan.pdf', size: 1024, type: 'application/pdf' };
  const result = await api.send({ 'Телефон': '8 927 123-45-67' }, 'форма', {
    leadId: 'api-lead-1', formId: 'test:api-upload', attachment: file
  });

  assert.equal(result.leadId, 'api-lead-1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/leads');
  assert.equal(requests[0].options.headers['Content-Type'], undefined, 'browser must set the multipart boundary');
  assert.equal(requests[0].options.body.get('attachment'), file);
  const payload = JSON.parse(requests[0].options.body.get('payload'));
  assert.equal(payload.fields['Телефон'], '+79271234567');
});

test('network, HTTP, invalid JSON, rejection, and timeout never become success', async (t) => {
  const source = await leadSource();
  const cases = [
    ['network', () => Promise.reject(new Error('offline')), undefined],
    ['synchronous fetch failure', () => { throw new Error('sync failure'); }, undefined],
    ['HTTP 500', () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }), 'LEAD_HTTP'],
    ['invalid JSON', () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('html')) }), 'LEAD_RESPONSE'],
    ['provider rejection', () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: false, message: 'no' }) }), 'LEAD_REJECTED']
  ];
  for (const [name, fetch, code] of cases) {
    await t.test(name, async () => {
      const { api, events } = browser(source, { fetch });
      await assert.rejects(api.send({ Телефон: '+79270000000' }, 'форма', { leadId: name, formId: 'test:error' }), (error) => !code || error?.code === code);
      assert.equal(events.at(-1)?.detail.status, 'error');
    });
  }

  await t.test('timeout', async () => {
    const { api, root, events } = browser(source, { fetch: () => new Promise(() => {}) });
    root.LEAD_CFG.timeoutMs = 5;
    await assert.rejects(api.send({}, 'форма', { leadId: 'slow', formId: 'test:timeout' }), (error) => error?.code === 'LEAD_TIMEOUT');
    assert.equal(events.at(-1)?.detail.status, 'error');
  });

  await t.test('response body timeout', async () => {
    const { api, root, events } = browser(source, {
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) })
    });
    root.LEAD_CFG.timeoutMs = 5;
    await assert.rejects(api.send({}, 'форма', { leadId: 'slow-json', formId: 'test:body-timeout' }), (error) => error?.code === 'LEAD_TIMEOUT');
    assert.equal(events.at(-1)?.detail.status, 'error');
  });
});

test('file validation enforces the documented allowlist and ten-megabyte limit', async () => {
  const source = await leadSource();
  const { api } = browser(source);
  assert.equal(api.validateAttachment({ name: 'plan.PDF', size: 1 }).ok, true);
  assert.equal(api.validateAttachment({ name: 'virus.exe', size: 1 }).code, 'FILE_TYPE');
  assert.equal(api.validateAttachment({ name: 'plan.pdf', size: LEADS.maxFileBytes + 1 }).code, 'FILE_TOO_LARGE');
  assert.equal(api.validPhone('+7 (927) 123-45-67'), true);
  assert.equal(api.validPhone('123'), false);
  assert.equal(api.normalizePhone('8 (927) 123-45-67'), '+79271234567');
});

test('attachments stay disabled on the transitional provider and use the longer API timeout', async () => {
  const source = await leadSource();
  const file = { name: 'plan.pdf', size: 1024, type: 'application/pdf' };
  let requests = 0;
  const disabled = browser(source, { fetch() { requests += 1; } });
  await assert.rejects(disabled.api.send({}, 'форма', { attachment: file }), (error) => error?.code === 'FILE_TRANSPORT_PENDING');
  assert.equal(requests, 0);
  disabled.root.LEAD_CFG.attachmentsEnabled = true;
  await assert.rejects(disabled.api.send({}, 'форма', { attachment: file }), (error) => error?.code === 'FILE_TRANSPORT_PENDING');
  assert.equal(requests, 0, 'an opt-in must not enable files on the undocumented FormSubmit AJAX transport');

  const enabled = browser(source, {
    fetch() {
      return new Promise((resolve) => setTimeout(function () {
        resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, leadId: 'upload-slow' }) });
      }, 20));
    },
    window: {
      LEAD_CFG: {
        provider: 'api', endpoint: '/api/leads', attachmentsEnabled: true,
        tgRelay: '', timeoutMs: 5, uploadTimeoutMs: 50
      }
    }
  });
  const result = await enabled.api.send({}, 'форма', { leadId: 'upload-slow', attachment: file });
  assert.equal(result.ok, true);
});

test('honeypot submissions are acknowledged without reaching either transport', async () => {
  const source = await leadSource();
  let requests = 0;
  const { api, events } = browser(source, {
    fetch() { requests += 1; return Promise.reject(new Error('must not run')); },
    window: { LEAD_CFG: { email: 'test@example.com', tgRelay: '/relay', timeoutMs: 50 } }
  });
  const result = await api.send({}, 'форма', { leadId: 'bot', formId: 'test:honey', honeypot: 'https://spam.test' });
  assert.equal(result.filtered, true);
  assert.equal(requests, 0);
  assert.equal(events.at(-1)?.detail.status, 'success');
});

test('secondary relay failure never reverses a confirmed primary result', async () => {
  const source = await leadSource();
  let calls = 0;
  const { api, events } = browser(source, {
    fetch(url) {
      calls += 1;
      if (String(url).includes('formsubmit')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      }
      throw new Error('relay failed synchronously');
    },
    window: { LEAD_CFG: { email: 'test@example.com', tgRelay: '/relay', timeoutMs: 50 } }
  });
  const result = await api.send({}, 'форма', { leadId: 'relay-safe', formId: 'test:relay' });
  await Promise.resolve();
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(events.at(-1)?.detail.status, 'success');
});

test('unknown providers fail closed and API mode never runs the browser relay', async () => {
  const source = await leadSource();
  let calls = 0;
  const unknown = browser(source, {
    fetch() { calls += 1; },
    window: { LEAD_CFG: { provider: 'typo', email: 'test@example.com', tgRelay: '/relay', timeoutMs: 50 } }
  });
  await assert.rejects(unknown.api.send({}, 'форма', {}), (error) => error?.code === 'LEAD_CONFIG');
  assert.equal(calls, 0);

  const apiMode = browser(source, {
    fetch() {
      calls += 1;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, leadId: 'api-only' }) });
    },
    window: { LEAD_CFG: { provider: 'api', endpoint: '/api/leads', tgRelay: '/relay', timeoutMs: 50 } }
  });
  await apiMode.api.send({}, 'форма', { leadId: 'api-only' });
  await Promise.resolve();
  assert.equal(calls, 1, 'API mode leaked a second request to the browser relay');
});

test('a second click cannot create a second in-flight request', async () => {
  const source = await leadSource();
  let resolveRequest;
  let requests = 0;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });

  class ClassList {
    add() {}
    remove() {}
    toggle() {}
  }
  function element(tag = 'div') {
    return {
      tag,
      textContent: '',
      style: {},
      dataset: {},
      classList: new ClassList(),
      children: [],
      setAttribute() {},
      appendChild(child) { this.children.push(child); return child; }
    };
  }
  const box = element();
  const button = element('button');
  button.textContent = 'Отправить заявку';
  const label = element('label');
  label.textContent = 'Телефон';
  const wrap = { querySelector: () => label };
  const phone = {
    type: 'tel', value: '+7 927 123-45-67', checked: false,
    closest: () => wrap,
    getAttribute: () => '',
    setCustomValidity() {}, reportValidity() {}, focus() {}
  };
  const form = {
    dataset: { leadForm: 'test:double', leadTag: 'форма' },
    style: {},
    parentNode: { querySelector: () => box },
    setAttribute() {},
    querySelector(selector) {
      if (selector === 'input[type="tel"]') return phone;
      if (selector === 'button[type="submit"]') return button;
      if (selector === '.form-result') return box;
      if (selector === 'input[type="file"][name="attachment"]') return null;
      return null;
    },
    querySelectorAll: () => [phone]
  };
  const document = {
    readyState: 'loading', title: 'Тест', referrer: '',
    addEventListener() {},
    createElement: (tag) => element(tag)
  };
  const { api } = browser(source, {
    document,
    fetch() {
      requests += 1;
      return pending;
    }
  });

  assert.equal(api.submitForm(form), false);
  assert.equal(api.submitForm(form), false);
  await Promise.resolve();
  assert.equal(requests, 1);
  resolveRequest({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(form.style.display, 'none');
  assert.equal(button.disabled, false);
});

test('all public lead forms use the isolated module and legacy false-success paths stay removed', async () => {
  const htmlFiles = await walkHtml();
  const pages = await Promise.all(htmlFiles.map(async (rel) => ({
    rel,
    html: await fs.readFile(path.join(ROOT, rel), 'utf8')
  })));
  const formCount = pages.reduce((sum, { html }) => sum + (html.match(/onsubmit=["']return submitLead\(this\)/g) || []).length, 0);
  assert.equal(formCount, LEADS.standardForms);
  const quoteCount = pages.reduce((sum, { html }) => sum + (html.match(/<form\b[^>]*id=["']kpForm["']/g) || []).length, 0);
  assert.equal(quoteCount, LEADS.quoteForms);
  const allLeadRefs = pages.filter(({ html }) => html.includes('assets/js/leads.js'));
  assert.equal(allLeadRefs.length, CONTRACT.siteShell.expectedPages);
  for (const { rel, html } of allLeadRefs) {
    const siteAt = html.indexOf('assets/js/site.js');
    const leadsAt = html.indexOf('assets/js/leads.js');
    assert.ok(siteAt >= 0 && leadsAt > siteAt, `${rel}: leads.js must load after the runtime bootstrap`);
  }

  const publicFileInputs = pages.filter(({ html }) => /<input\b[^>]*type=["']file["']/i.test(html));
  assert.deepEqual(publicFileInputs.map(({ rel }) => rel), ['tools/dogovor/index.html']);
  const site = await fs.readFile(path.join(ROOT, 'assets/js/site.js'), 'utf8');
  const kp = await fs.readFile(path.join(ROOT, 'assets/js/kp.js'), 'utf8');
  const leads = await leadSource();
  const cart = await fs.readFile(path.join(ROOT, 'cart/index.html'), 'utf8');
  assert.doesNotMatch(site, /formsubmit\.co|window\.LEAD_CFG\s*=|localStorage\.setItem\(['"]sp_leads_v1/);
  assert.doesNotMatch(cart, /копию пришл[её]м|КП.*пришл[её]м на почту/i);
  for (const key of LEADS.forbiddenLocalStorageKeys) {
    const pattern = new RegExp(`(?:localStorage|sessionStorage)\\.setItem\\(\\s*['"]${key}['"]`);
    assert.doesNotMatch(site, pattern, `${key} returned to site.js browser storage`);
    assert.doesNotMatch(kp, pattern, `${key} returned to kp.js browser storage`);
    assert.doesNotMatch(leads, pattern, `${key} returned to leads.js browser storage`);
  }
  assert.match(site, /postMessage\(\{ kpHead: currentKpHead \}/);
  assert.match(site, /e\.source === dFrame\.contentWindow/);
  assert.match(site, /leadId: leadId,[\s\S]*formId: 'cart:quote'/);
  assert.match(site, /form\.dataset\.quoteNumber/);
  assert.match(site, /EGOE_LEADS\.validPhone\(phone\)/);
  assert.match(kp, /e\.data\.kpHead/);
  assert.match(kp, /trustedHeadSource/);
  assert.match(cart, /id="kpdLeadStatus"[^>]*aria-live="polite"/);
  assert.match(leads, new RegExp(`consentVersion:\\s*['"]${LEADS.consentVersion}['"]`));
  assert.match(leads, /localStorage\.removeItem\('sp_leads_v1'\)/);
  assert.match(leads, /localStorage\.removeItem\('sp_kp_head_v1'\)/);
  assert.equal(LEADS.attachmentsEnabled, false);
  assert.match(leads, /cfg\.attachmentsEnabled === true && cfg\.provider === 'api'/);
  assert.match(leads, /if \(event\.target === input\) return;/);
  assert.doesNotMatch(leads, /innerHTML\s*=\s*(?:checked\.file|file)\.name/);
});
