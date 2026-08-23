import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = JSON.parse(await fs.readFile(path.join(ROOT, 'config/site-contract.json'), 'utf8'));
const LEADS = CONTRACT.leadDelivery;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const leadFetch = overrides.fetch || (() => Promise.reject(new Error('Unexpected lead fetch')));
  const root = {
    document,
    location: {
      hostname: 'www.egoe-life.ru',
      href: 'https://www.egoe-life.ru/test/?campaign=1',
      pathname: '/test/'
    },
    CustomEvent: FakeCustomEvent,
    dispatchEvent(event) { events.push(event); },
    FormData: FakeFormData,
    AbortController,
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    fetch(url, request) {
      if (url === '/api/leads/status/') {
        if (overrides.statusFetch) return overrides.statusFetch(url, request);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ enabled: true }) });
      }
      return leadFetch(url, request);
    },
    localStorage: { removeItem() {} },
    ...overrides.window
  };
  const context = {
    window: root,
    URL,
    Uint8Array,
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

function options(overrides = {}) {
  return {
    leadId: '11111111-1111-4111-8111-111111111111',
    formId: 'test:request',
    elapsedMs: 1500,
    consentAccepted: true,
    consentUrl: 'https://www.egoe-life.ru/consent/',
    ...overrides
  };
}

test('same-origin API receives one confirmed multipart envelope with consent and normalized phone', async () => {
  const requests = [];
  const source = await leadSource();
  const { api, events } = browser(source, {
    fetch(url, request) {
      requests.push({ url, request });
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ ok: true, leadId: options().leadId })
      });
    }
  });
  const result = await api.send({ Имя: 'Анна', Телефон: '8 927 123-45-67' }, 'форма', options());
  assert.equal(result.ok, true);
  assert.equal(result.leadId, options().leadId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/leads/');
  assert.equal(requests[0].request.credentials, 'same-origin');
  assert.equal(requests[0].request.headers.Accept, 'application/json');
  assert.equal(requests[0].request.headers['Content-Type'], undefined, 'browser must set multipart boundary');
  const payload = JSON.parse(requests[0].request.body.get('payload'));
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.leadId, options().leadId);
  assert.equal(payload.fields.Телефон, '+79271234567');
  assert.equal(payload.consent.accepted, true);
  assert.equal(payload.consent.version, LEADS.consentVersion);
  assert.equal(payload.consent.documentUrl, 'https://www.egoe-life.ru/consent/');
  assert.equal(events.at(-1)?.detail.status, 'success');
  assert.equal(JSON.stringify(events.at(-1)?.detail).includes('7927'), false);
});

test('consent is mandatory before any request', async () => {
  const source = await leadSource();
  let requests = 0;
  const { api, events } = browser(source, { fetch() { requests += 1; } });
  await assert.rejects(api.send({ Телефон: '+79270000000' }, 'форма', options({ consentAccepted: false })), (error) => error.code === 'CONSENT_REQUIRED');
  assert.equal(requests, 0);
  assert.equal(events.at(-1)?.detail.status, 'error');
});

test('HTTP, invalid JSON, rejection and timeout never become success', async (t) => {
  const source = await leadSource();
  const cases = [
    ['network', () => Promise.reject(new Error('offline')), undefined],
    ['HTTP', () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }), 'LEAD_HTTP'],
    ['invalid JSON', () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('html')) }), 'LEAD_RESPONSE'],
    ['rejection', () => Promise.resolve({ ok: true, status: 422, json: () => Promise.resolve({ ok: false }) }), 'LEAD_REJECTED'],
    ['mismatched ID', () => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ ok: true, leadId: '22222222-2222-4222-8222-222222222222' }) }), 'LEAD_REJECTED']
  ];
  for (const [name, fetch, code] of cases) {
    await t.test(name, async () => {
      const { api, events } = browser(source, { fetch });
      await assert.rejects(api.send({ Телефон: '+79270000000' }, 'форма', options()), (error) => !code || error.code === code);
      assert.equal(events.at(-1)?.detail.status, 'error');
    });
  }
  const timeout = browser(source, {
    fetch: () => new Promise(() => {}),
    window: { LEAD_CFG: { provider: 'api', endpoint: '/api/leads/', timeoutMs: 5 } }
  });
  await assert.rejects(timeout.api.send({ Телефон: '+79270000000' }, 'форма', options()), (error) => error.code === 'LEAD_TIMEOUT');
});

test('attachments remain fail-closed and cannot be enabled from browser config', async () => {
  const source = await leadSource();
  const file = { name: 'plan.pdf', size: 1024, type: 'application/pdf' };
  let requests = 0;
  const { api } = browser(source, {
    fetch() { requests += 1; },
    window: { LEAD_CFG: { provider: 'api', endpoint: '/api/leads/', attachmentsEnabled: true } }
  });
  assert.equal(api.validateAttachment(file).ok, true);
  assert.equal(api.validateAttachment({ name: 'virus.exe', size: 1 }).code, 'FILE_TYPE');
  assert.equal(api.validateAttachment({ name: 'plan.pdf', size: LEADS.maxFileBytes + 1 }).code, 'FILE_TOO_LARGE');
  await assert.rejects(api.send({ Телефон: '+79270000000' }, 'форма', options({ attachment: file })), (error) => error.code === 'FILE_TRANSPORT_PENDING');
  assert.equal(requests, 0);
  assert.equal(api.attachmentTransportReady(api.config()), false);
});

test('honeypot is acknowledged locally, and browser never calls a secondary relay', async () => {
  const source = await leadSource();
  let requests = 0;
  const honey = browser(source, { fetch() { requests += 1; } });
  const filtered = await honey.api.send({ Телефон: '+79270000000' }, 'форма', options({ honeypot: 'spam' }));
  assert.equal(filtered.filtered, true);
  assert.equal(requests, 0);

  const apiOnly = browser(source, {
    fetch() {
      requests += 1;
      return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ ok: true, leadId: options().leadId }) });
    },
    window: { LEAD_CFG: { provider: 'api', endpoint: '/api/leads/', tgRelay: 'https://example.invalid/relay' } }
  });
  await apiOnly.api.send({ Телефон: '+79270000000' }, 'форма', options());
  assert.equal(requests, 1, 'API mode leaked a browser relay request');
});

test('provider and endpoint are locked to the same-origin API path', async () => {
  const source = await leadSource();
  let requests = 0;
  for (const config of [
    { provider: 'typo', endpoint: '/api/leads/' },
    { provider: 'api', endpoint: 'https://attacker.invalid/' },
    { provider: 'api', endpoint: '/api/other/' }
  ]) {
    const { api } = browser(source, { fetch() { requests += 1; }, window: { LEAD_CFG: config } });
    await assert.rejects(api.send({ Телефон: '+79270000000' }, 'форма', options()), (error) => error.code === 'LEAD_CONFIG');
  }
  assert.equal(requests, 0);
});

test('public GitHub Pages preview cannot send real leads', async () => {
  const source = await leadSource();
  let requests = 0;
  const { api } = browser(source, {
    fetch() { requests += 1; },
    window: {
      location: {
        hostname: 'olmazen.github.io',
        href: 'https://olmazen.github.io/stroibad-2/',
        pathname: '/stroibad-2/'
      }
    }
  });
  await assert.rejects(
    api.send({ Телефон: '+79270000000' }, 'форма', options()),
    (error) => error.code === 'COLLECTION_DISABLED'
  );
  assert.equal(requests, 0);
});

test('forms stay fail-closed until the exact same-origin status enables collection', async () => {
  const source = await leadSource();
  var resolveStatus;
  var message = null;
  const control = {
    disabled: false,
    dataset: {},
    removeAttribute(name) { if (name === 'data-collection-gate') delete this.dataset.collectionGate; }
  };
  const form = {
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild(node) { message = node; },
    querySelector(selector) { return selector === '.lead-collection-gate' ? message : null; },
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select, button') return [control];
      if (selector === '[data-collection-gate="1"]') return control.dataset.collectionGate === '1' ? [control] : [];
      return [];
    }
  };
  function node() {
    return {
      children: [], hidden: false, className: '',
      setAttribute() {},
      appendChild(child) { this.children.push(child); }
    };
  }
  const document = {
    readyState: 'loading', title: 'Тест', referrer: '',
    addEventListener() {},
    createElement: node,
    createTextNode(text) { return { textContent: text }; },
    querySelectorAll() { return [form]; }
  };
  const statusRequests = [];
  const enabled = browser(source, {
    document,
    statusFetch(url, request) {
      statusRequests.push({ url, request });
      return new Promise((resolve) => { resolveStatus = resolve; });
    }
  });
  assert.equal(control.disabled, true, 'control must be disabled synchronously before status resolves');
  assert.equal(form.attributes['aria-disabled'], 'true');
  assert.equal(message.hidden, false);
  assert.match(JSON.stringify(message), /79272295828|WhatsApp/);
  await Promise.resolve();
  resolveStatus({ ok: true, status: 200, json: () => Promise.resolve({ enabled: true }) });
  assert.equal(await enabled.api.verifyCollectionStatus(), true);
  assert.equal(enabled.api.collectionEnabled(), true);
  assert.equal(control.disabled, false);
  assert.equal(message.hidden, true);
  assert.equal(statusRequests.length, 1);
  assert.equal(statusRequests[0].url, '/api/leads/status/');
  assert.equal(statusRequests[0].request.credentials, 'same-origin');

  const disabledControl = { disabled: false, dataset: {} };
  const disabledForm = {
    dataset: {}, setAttribute() {}, appendChild() {},
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === 'input, textarea, select, button' ? [disabledControl] : []; }
  };
  const disabledDocument = { readyState: 'loading', title: '', referrer: '', addEventListener() {}, querySelectorAll() { return [disabledForm]; } };
  let leadRequests = 0;
  const disabled = browser(source, {
    document: disabledDocument,
    statusFetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ enabled: false }) }),
    fetch() { leadRequests += 1; }
  });
  assert.equal(await disabled.api.verifyCollectionStatus(), false);
  assert.equal(disabledControl.disabled, true);
  await assert.rejects(disabled.api.send({ Телефон: '+79270000000' }, 'форма', options()), (error) => error.code === 'COLLECTION_DISABLED');
  assert.equal(leadRequests, 0);

  const extra = browser(source, {
    statusFetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ enabled: true, extra: true }) })
  });
  assert.equal(await extra.api.verifyCollectionStatus(), false, 'unexpected status fields must fail closed');

  let revokedPosts = 0;
  const revoked = browser(source, {
    fetch: () => {
      revokedPosts += 1;
      return Promise.resolve({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ ok: false, code: 'COLLECTION_DISABLED' })
      });
    }
  });
  await assert.rejects(revoked.api.send({ Телефон: '+79270000000' }, 'форма', options()), (error) => error.code === 'COLLECTION_DISABLED');
  assert.equal(revoked.api.collectionEnabled(), false, 'a server-side revocation must relock the page');
  await assert.rejects(revoked.api.send({ Телефон: '+79270000000' }, 'форма', options()), (error) => error.code === 'COLLECTION_DISABLED');
  assert.equal(revokedPosts, 1, 'revocation must prevent every later POST without a reload');
});

test('UUID fallback remains RFC4122-compatible without crypto.randomUUID', async () => {
  const source = await leadSource();
  let cursor = 0;
  const bytes = browser(source, {
    window: {
      crypto: {
        getRandomValues(value) {
          for (let index = 0; index < value.length; index += 1) value[index] = (cursor += 17) & 255;
          return value;
        }
      }
    }
  });
  assert.match(bytes.api.requestId(), UUID);
  const mathOnly = browser(source, { window: { crypto: {} } });
  assert.match(mathOnly.api.requestId(), UUID);
});

test('user edits clear retry identity, while source keeps an immutable retry envelope', async () => {
  const source = await leadSource();
  const listeners = {};
  const phone = { addEventListener() {}, setCustomValidity() {} };
  const consent = { checked: true, dataset: { consentUrl: 'https://www.egoe-life.ru/consent/' }, addEventListener() {} };
  const form = {
    dataset: { leadId: options().leadId, leadForm: 'test:form', leadTag: 'Тест', leadStartedAt: String(Date.now() - 1000) },
    __leadRequest: { immutable: true },
    addEventListener(type, listener) { listeners[type] = listener; },
    appendChild() {},
    querySelector(selector) {
      if (selector === 'input[name="_honey"]') return {};
      if (selector === 'input[type="tel"]') return phone;
      if (selector === '[data-lead-consent]') return consent;
      if (selector === '.lead-file') return {};
      return null;
    }
  };
  const document = {
    readyState: 'loading', title: 'Тест', referrer: '', addEventListener() {},
    querySelectorAll() { return [form]; }
  };
  const { api } = browser(source, { document });
  api.prepareForms();
  listeners.input();
  assert.equal(form.__leadRequest, null);
  assert.equal(form.dataset.leadId, undefined);
  assert.match(source, /createdAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(source, /var requestState = form\.__leadRequest/);
});

test('public forms use the isolated module and legacy false-success/PII storage paths stay removed', async () => {
  const htmlFiles = await walkHtml();
  const pages = await Promise.all(htmlFiles.map(async (rel) => ({ rel, html: await fs.readFile(path.join(ROOT, rel), 'utf8') })));
  const formCount = pages.reduce((sum, { html }) => sum + (html.match(/onsubmit=["']return window\.EGOE_LEADS \? window\.EGOE_LEADS\.submitForm\(this\) : false/g) || []).length, 0);
  assert.equal(formCount, LEADS.standardForms);
  assert.equal(pages.reduce((sum, { html }) => sum + (html.match(/onsubmit=["']return submitLead\(this\)/g) || []).length, 0), 0);
  const quoteCount = pages.reduce((sum, { html }) => sum + (html.match(/<form\b[^>]*id=["']kpForm["']/g) || []).length, 0);
  assert.equal(quoteCount, LEADS.quoteForms);
  const allLeadRefs = pages.filter(({ html }) => html.includes('assets/js/leads.js'));
  assert.equal(allLeadRefs.length, CONTRACT.siteShell.expectedPages);
  for (const { rel, html } of allLeadRefs) {
    const siteAt = html.indexOf('assets/js/site.js');
    const leadsAt = html.indexOf('assets/js/leads.js');
    assert.ok(siteAt >= 0 && leadsAt > siteAt, `${rel}: leads.js must load after site.js`);
  }

  const site = await fs.readFile(path.join(ROOT, 'assets/js/site.js'), 'utf8');
  const kp = await fs.readFile(path.join(ROOT, 'assets/js/kp.js'), 'utf8');
  const leads = await leadSource();
  const cart = await fs.readFile(path.join(ROOT, 'cart/index.html'), 'utf8');
  const kpPage = await fs.readFile(path.join(ROOT, 'kp/index.html'), 'utf8');
  const mafPublisher = await fs.readFile(path.join(ROOT, 'tools/publish-maf-category.mjs'), 'utf8');
  assert.doesNotMatch(site, /formsubmit\.co|window\.LEAD_CFG\s*=|localStorage\.setItem\(['"]sp_leads_v1/);
  assert.doesNotMatch(leads, /formsubmit\.co|tgRelay|google\.script|script\.google/);
  assert.match(leads, /\/api\/leads\//);
  assert.match(leads, /\/api\/leads\/status\//);
  assert.match(leads, /collectionEnabled/);
  assert.match(leads, /https:\/\/wa\.me\/79272295828/);
  assert.doesNotMatch(cart, /копию пришл[её]м|КП.*пришл[её]м на почту/i);
  for (const key of LEADS.forbiddenLocalStorageKeys) {
    const pattern = new RegExp(`(?:localStorage|sessionStorage)\\.setItem\\(\\s*['"]${key}['"]`);
    assert.doesNotMatch(site, pattern);
    assert.doesNotMatch(kp, pattern);
    assert.doesNotMatch(leads, pattern);
  }
  assert.match(site, /kpHead: currentKpHead, kpInstance:/);
  assert.match(site, /e\.source === dFrame\.contentWindow/);
  assert.match(site, /var requestState = form\.__leadRequest/);
  assert.match(site, /createdAt: new Date\(\)\.toISOString\(\)/);
  assert.match(site, /resetQuoteLeadRequest/);
  assert.match(site, /egoe:cart-change/);
  assert.match(site, /form\.__leadDirty/);
  assert.match(site, /EGOE_LEADS\.collectionEnabled/);
  const quoteSubmitStart = site.indexOf("form.addEventListener('submit', function (e) {", site.indexOf('function resetQuoteLeadRequest'));
  const quoteSubmitEnd = site.indexOf('\n    });\n  })();', quoteSubmitStart);
  assert.ok(quoteSubmitStart >= 0 && quoteSubmitEnd > quoteSubmitStart, 'cart quote submit handler must remain inspectable');
  const quoteSubmit = site.slice(quoteSubmitStart, quoteSubmitEnd);
  const consentAcceptedAt = quoteSubmit.indexOf("quoteConsent.setCustomValidity('');");
  assert.ok(consentAcceptedAt > 0, 'cart quote must require an explicit consent checkbox');
  const uncheckedPath = quoteSubmit.slice(0, consentAcceptedAt);
  assert.match(uncheckedPath, /form\.querySelector\('\[data-lead-consent\]'\)/);
  assert.match(uncheckedPath, /if \(!quoteConsent \|\| !quoteConsent\.checked\)/);
  assert.match(uncheckedPath, /quoteConsent\.setCustomValidity\(/);
  assert.match(uncheckedPath, /quoteConsent\.reportValidity\(\)/);
  assert.match(uncheckedPath, /quoteConsent\.focus\(\)/);
  assert.match(uncheckedPath, /return;/);
  assert.doesNotMatch(uncheckedPath, /window\.__sendLead\(|openDrawer\(|currentKpHead\s*=/,
    'unchecked consent must neither send the lead nor construct/open the quote');
  assert.ok(quoteSubmit.indexOf('window.__sendLead(', consentAcceptedAt) > consentAcceptedAt);
  assert.ok(quoteSubmit.indexOf('openDrawer();', consentAcceptedAt) > consentAcceptedAt);
  assert.ok(quoteSubmit.indexOf('currentKpHead =', consentAcceptedAt) > consentAcceptedAt);
  assert.match(kp, /trustedHeadSource/);
  assert.match(kp, /postParent\(\{ kpReady: true \}\)/);
  assert.match(cart, /id="kpdLeadStatus"[^>]*aria-live="polite"/);
  assert.match(cart, /id="kpdPdf"[^>]*disabled/);
  assert.match(kpPage, /id="kpPrintBtn"[^>]*disabled/);
  assert.match(kpPage, /assets\/js\/kp\.js\?v=[a-f0-9]{12}/);
  assert.match(mafPublisher, /return window\.EGOE_LEADS \? window\.EGOE_LEADS\.submitForm\(this\) : false/);
  assert.doesNotMatch(mafPublisher, /return submitLead\(this\)/);
  assert.match(leads, new RegExp(`consentVersion:\\s*['"]${LEADS.consentVersion}['"]`));
  assert.match(leads, /localStorage\.removeItem\('sp_leads_v1'\)/);
  assert.equal(LEADS.attachmentsEnabled, false);
  assert.match(leads, /DEFAULTS\.attachmentsEnabled === true/);
  assert.match(leads, /form\.__leadDirty/);
  assert.doesNotMatch(leads, /innerHTML\s*=\s*(?:checked\.file|file)\.name/);
  assert.doesNotMatch(site, /отправили на почту|пришл[её]м КП/i);
});
