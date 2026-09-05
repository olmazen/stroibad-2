/* EGOE — подтверждаемая отправка заявок в собственный same-origin API */
(function (root) {
  'use strict';

  var moduleStartedAt = Date.now();
  var FORM_SELECTOR = 'form[onsubmit*="EGOE_LEADS"], form[onsubmit*="submitLead"], form#kpForm';
  var STATUS_ENDPOINT = '/api/leads/status/';
  var JOURNEY_STORAGE_KEY = 'egoe_lead_journey_v1';
  var JOURNEY_LIMIT = 20;
  var collectionState = productionEndpoint() ? 'pending' : 'disabled';
  var collectionPromise = null;
  var journeyMemory = [];
  var journeyMemoryDay = '';

  function productionEndpoint() {
    var hostname = root.location && String(root.location.hostname || '').toLowerCase();
    return hostname === 'egoe-life.ru' || hostname === 'www.egoe-life.ru' ? '/api/leads/' : '';
  }

  var DEFAULTS = {
    provider: 'api',
    endpoint: productionEndpoint(),
    timeoutMs: 15000,
    uploadTimeoutMs: 120000,
    attachmentsEnabled: false,
    maxFileBytes: 10 * 1024 * 1024,
    allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'dwg', 'dxf', 'doc', 'docx', 'xls', 'xlsx', 'zip'],
    consentVersion: '2026-09-04'
  };

  var inFlight = typeof WeakMap === 'function' ? new WeakMap() : null;

  function config() {
    var custom = root.LEAD_CFG || {};
    var result = {};
    Object.keys(DEFAULTS).forEach(function (key) { result[key] = DEFAULTS[key]; });
    Object.keys(custom).forEach(function (key) { result[key] = custom[key]; });
    return result;
  }

  function report(error) {
    if (root.EGOE_RUNTIME && typeof root.EGOE_RUNTIME.report === 'function') {
      root.EGOE_RUNTIME.report('lead-delivery', error);
      return;
    }
    try { console.error('[EGOE leads]', error); } catch (_) {}
  }

  function emit(status, detail) {
    var payload = {
      status: status,
      formId: String(detail.formId || 'unknown'),
      leadId: String(detail.leadId || '')
    };
    try {
      if (root.dispatchEvent && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('egoe:lead-status', { detail: payload }));
      }
    } catch (_) {}
  }

  function collectionEnabled() {
    return collectionState === 'enabled';
  }

  function gateMessage(form) {
    if (!form || typeof form.querySelector !== 'function' || !root.document || typeof root.document.createElement !== 'function') return null;
    var existing = form.querySelector('.lead-collection-gate');
    if (existing) return existing;
    var box = root.document.createElement('div');
    box.className = 'lead-collection-gate';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.appendChild(root.document.createTextNode('Онлайн-форма временно не принимает данные. Позвоните '));
    var phone = root.document.createElement('a');
    phone.href = 'tel:+79272295828';
    phone.textContent = '8 (927) 229-58-28';
    box.appendChild(phone);
    box.appendChild(root.document.createTextNode(' или напишите в '));
    var whatsapp = root.document.createElement('a');
    whatsapp.href = 'https://wa.me/79272295828';
    whatsapp.target = '_blank';
    whatsapp.rel = 'noopener';
    whatsapp.textContent = 'WhatsApp';
    box.appendChild(whatsapp);
    box.appendChild(root.document.createTextNode('.'));
    if (typeof form.appendChild === 'function') form.appendChild(box);
    return box;
  }

  function lockForm(form) {
    if (!form) return;
    if (typeof form.setAttribute === 'function') form.setAttribute('aria-disabled', 'true');
    if (typeof form.querySelectorAll === 'function') {
      Array.prototype.forEach.call(form.querySelectorAll('input, textarea, select, button'), function (control) {
        if (!control.disabled) {
          control.disabled = true;
          if (control.dataset) control.dataset.collectionGate = '1';
          else if (typeof control.setAttribute === 'function') control.setAttribute('data-collection-gate', '1');
        }
      });
    }
    var message = gateMessage(form);
    if (message) message.hidden = false;
  }

  function unlockForm(form) {
    if (!form) return;
    if (typeof form.removeAttribute === 'function') form.removeAttribute('aria-disabled');
    if (typeof form.querySelectorAll === 'function') {
      Array.prototype.forEach.call(form.querySelectorAll('[data-collection-gate="1"]'), function (control) {
        control.disabled = false;
        if (control.dataset) delete control.dataset.collectionGate;
        if (typeof control.removeAttribute === 'function') control.removeAttribute('data-collection-gate');
      });
    }
    if (typeof form.querySelector === 'function') {
      var message = form.querySelector('.lead-collection-gate');
      if (message) message.hidden = true;
    }
  }

  function leadForms() {
    if (!root.document || typeof root.document.querySelectorAll !== 'function') return [];
    return root.document.querySelectorAll(FORM_SELECTOR);
  }

  function lockAllForms() {
    Array.prototype.forEach.call(leadForms(), lockForm);
  }

  function unlockAllForms() {
    Array.prototype.forEach.call(leadForms(), unlockForm);
  }

  function verifyCollectionStatus() {
    if (collectionPromise) return collectionPromise;
    if (!productionEndpoint() || typeof root.fetch !== 'function') {
      collectionState = 'disabled';
      lockAllForms();
      collectionPromise = Promise.resolve(false);
      return collectionPromise;
    }
    collectionPromise = Promise.resolve().then(function () {
      return root.fetch(STATUS_ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
    }).then(function (response) {
      if (!response || response.ok !== true) return false;
      return response.json().then(function (data) {
        return !!data && Object.keys(data).length === 1 && data.enabled === true;
      }, function () { return false; });
    }, function () { return false; }).then(function (enabled) {
      collectionState = enabled ? 'enabled' : 'disabled';
      if (enabled) unlockAllForms(); else lockAllForms();
      return enabled;
    });
    return collectionPromise;
  }

  function makeError(code, message, cause) {
    var error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function requestId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
      if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
        var bytes = new Uint8Array(16);
        root.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.prototype.map.call(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
        return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
      }
    } catch (_) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      var value = Math.floor(Math.random() * 16);
      return (char === 'x' ? value : ((value & 3) | 8)).toString(16);
    });
  }

  function normalizePhone(value) {
    var original = String(value == null ? '' : value).trim();
    var digits = original.replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) digits = '7' + digits.slice(1);
    else if (digits.length === 10) digits = '7' + digits;
    return digits.length === 11 ? '+' + digits : original;
  }

  function validPhone(value) {
    var digits = String(value == null ? '' : value).replace(/\D/g, '');
    return digits.length === 10 || (digits.length === 11 && (digits[0] === '7' || digits[0] === '8'));
  }

  function cleanLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').replace(/\s*[—–-]\s*необязательно\s*$/i, '').trim();
  }

  function leadFields(form) {
    var out = {};
    var unnamed = 0;
    var nodes = form.querySelectorAll('input, textarea, select');
    Array.prototype.forEach.call(nodes, function (el) {
      var type = String(el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file' || el.hasAttribute('data-lead-consent')) return;
      var wrap = el.closest ? el.closest('.field') : null;
      var label = wrap && wrap.querySelector ? wrap.querySelector('label') : null;
      var key = cleanLabel((label && label.textContent) || el.getAttribute('placeholder') || el.getAttribute('aria-label'));
      if (!key) key = 'Поле ' + (++unnamed);
      var value = type === 'checkbox' ? (el.checked ? 'да' : '') : String(el.value || '').trim();
      if (!value) return;
      if (/тел|phone/i.test(key)) value = normalizePhone(value);
      out[key] = value;
    });
    return out;
  }

  function inferFormId(form, index) {
    if (form && form.dataset && form.dataset.leadForm) return form.dataset.leadForm;
    var pathname = root.location && root.location.pathname ? root.location.pathname : '/';
    var base = pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9/_-]+/gi, '-') || 'home';
    return base + ':request-' + (index + 1);
  }

  function pageContext() {
    return {
      url: root.location ? String(root.location.href || '') : '',
      title: root.document ? String(root.document.title || '') : '',
      referrer: root.document ? String(root.document.referrer || '') : ''
    };
  }

  function journeyDay(date) {
    var value = date || new Date();
    function two(number) { return String(number).padStart(2, '0'); }
    return value.getFullYear() + '-' + two(value.getMonth() + 1) + '-' + two(value.getDate());
  }

  function cleanJourneyTitle(value) {
    return String(value || '')
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  }

  function cleanJourneyPath(value) {
    var path = String(value || '');
    if (!path.startsWith('/') || path.startsWith('//') || path.indexOf('?') >= 0 || path.indexOf('#') >= 0) return '';
    path = '/' + path.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
    return path.length <= 500 ? path : '';
  }

  function journeyEntry(context, viewedAt) {
    try {
      var current = new URL(root.location && root.location.href || '');
      var page = new URL(String(context && context.url || current.href), current.href);
      if (page.origin !== current.origin) return null;
      var path = cleanJourneyPath(page.pathname || '/');
      if (!path) return null;
      return {
        path: path,
        title: cleanJourneyTitle(context && context.title),
        viewedAt: viewedAt || new Date().toISOString()
      };
    } catch (_) {
      return null;
    }
  }

  function safeStoredJourney(value, day) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var keys = Object.keys(value).sort();
    if (keys.join(',') !== 'path,title,viewedAt') return null;
    var path = cleanJourneyPath(value.path);
    var viewedAt = String(value.viewedAt || '');
    var viewedTime = Date.parse(viewedAt);
    if (!path
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(viewedAt)
      || !Number.isFinite(viewedTime)
      || journeyDay(new Date(viewedTime)) !== day
      || viewedTime < Date.now() - 86400000
      || viewedTime > Date.now() + 600000
    ) return null;
    return { path: path, title: cleanJourneyTitle(value.title), viewedAt: viewedAt };
  }

  function readJourney(day) {
    var entries = journeyMemoryDay === day ? journeyMemory.slice() : [];
    try {
      if (root.sessionStorage && typeof root.sessionStorage.getItem === 'function') {
        var parsed = JSON.parse(root.sessionStorage.getItem(JOURNEY_STORAGE_KEY) || 'null');
        if (parsed && parsed.day === day && Array.isArray(parsed.entries)) {
          entries = parsed.entries.map(function (entry) { return safeStoredJourney(entry, day); }).filter(Boolean);
        }
      }
    } catch (_) {}
    var unique = [];
    entries.slice(-JOURNEY_LIMIT).forEach(function (entry) {
      unique = unique.filter(function (existing) { return existing.path !== entry.path; });
      unique.push(entry);
    });
    journeyMemoryDay = day;
    journeyMemory = unique.slice(-JOURNEY_LIMIT);
    return journeyMemory.slice();
  }

  function writeJourney(day, entries) {
    journeyMemoryDay = day;
    journeyMemory = entries.slice(-JOURNEY_LIMIT);
    try {
      if (root.sessionStorage && typeof root.sessionStorage.setItem === 'function') {
        root.sessionStorage.setItem(JOURNEY_STORAGE_KEY, JSON.stringify({ day: day, entries: journeyMemory }));
      }
    } catch (_) {}
  }

  function recordJourney(context) {
    var day = journeyDay();
    var entries = readJourney(day);
    var entry = journeyEntry(context || pageContext());
    if (!entry) return entries;
    entries = entries.filter(function (existing) { return existing.path !== entry.path; });
    entries.push(entry);
    entries = entries.slice(-JOURNEY_LIMIT);
    writeJourney(day, entries);
    return entries.map(function (item) {
      return { path: item.path, title: item.title, viewedAt: item.viewedAt };
    });
  }

  function fileExtension(file) {
    var match = String(file && file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function validateAttachment(file, customConfig) {
    if (!file) return { ok: true, file: null };
    var cfg = customConfig || config();
    if (!Number.isFinite(file.size) || file.size < 0) {
      return { ok: false, code: 'FILE_INVALID', message: 'Не удалось прочитать файл.' };
    }
    if (file.size > cfg.maxFileBytes) {
      return { ok: false, code: 'FILE_TOO_LARGE', message: 'Файл больше 10 МБ. Выберите файл поменьше.' };
    }
    var extension = fileExtension(file);
    if (!extension || cfg.allowedExtensions.indexOf(extension) === -1) {
      return { ok: false, code: 'FILE_TYPE', message: 'Этот формат не поддерживается. Выберите PDF, изображение, чертёж, документ или ZIP.' };
    }
    return { ok: true, file: file };
  }

  function attachmentTransportReady(cfg) {
    return DEFAULTS.attachmentsEnabled === true && cfg.attachmentsEnabled === true && cfg.provider === 'api';
  }

  function buildEnvelope(fields, tag, options, cfg) {
    var context = options.context || pageContext();
    var createdAt = options.createdAt || new Date().toISOString();
    var consentAccepted = options.consentAccepted === true;
    var consentUrl = options.consentUrl || '';
    if (!consentAccepted && options.formId === 'cart:quote' && root.document) {
      var quoteConsent = root.document.querySelector('#kpForm [data-lead-consent]');
      consentAccepted = !!(quoteConsent && quoteConsent.checked);
      consentUrl = quoteConsent && quoteConsent.dataset ? quoteConsent.dataset.consentUrl || '' : '';
    }
    var normalizedFields = {};
    Object.keys(fields || {}).forEach(function (key) {
      normalizedFields[key] = /тел|phone/i.test(key) ? normalizePhone(fields[key]) : fields[key];
    });
    return {
      schemaVersion: 1,
      leadId: options.leadId || requestId(),
      formId: options.formId || 'programmatic',
      tag: tag || 'форма',
      createdAt: createdAt,
      consent: {
        accepted: consentAccepted,
        version: cfg.consentVersion,
        acceptedAt: createdAt,
        documentUrl: consentUrl
      },
      page: context,
      journey: recordJourney(context),
      spamCheck: {
        website: String(options.honeypot || ''),
        elapsedMs: Math.max(0, Number(options.elapsedMs) || (Date.now() - moduleStartedAt))
      },
      fields: normalizedFields
    };
  }

  function requestBody(envelope, attachment, cfg) {
    var body = new root.FormData();
    body.append('payload', JSON.stringify(envelope));
    if (attachment) body.append('attachment', attachment, attachment.name);
    return body;
  }

  function endpointFor(cfg) {
    if (cfg.provider !== 'api') throw makeError('LEAD_CONFIG', 'Unknown lead provider: ' + String(cfg.provider));
    if (!cfg.endpoint) throw makeError('LEAD_CONFIG', 'Lead endpoint is not configured');
    if (!/^\/api\/leads\/?$/.test(String(cfg.endpoint))) {
      throw makeError('LEAD_CONFIG', 'Lead endpoint must stay on the current site origin');
    }
    return cfg.endpoint;
  }

  function confirmedRequest(url, options, timeoutMs, cfg, leadId) {
    var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    if (controller) options.signal = controller.signal;
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(makeError('LEAD_TIMEOUT', 'Lead request timed out'));
      }, timeoutMs);
    });
    var request = Promise.resolve().then(function () {
      return root.fetch(url, options);
    }).then(function (response) {
      return parseConfirmedResponse(response, cfg, leadId);
    });
    return Promise.race([request, timeout]).finally(function () { clearTimeout(timer); });
  }

  function parseConfirmedResponse(response, cfg, fallbackLeadId) {
    if (!response || !response.ok) {
      if (response && response.status === 503 && typeof response.json === 'function') {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (data && data.code === 'COLLECTION_DISABLED') {
            collectionState = 'disabled';
            collectionPromise = Promise.resolve(false);
            lockAllForms();
            throw makeError('COLLECTION_DISABLED', 'Онлайн-форма временно не принимает данные. Позвоните нам или напишите в WhatsApp.');
          }
          throw makeError('LEAD_HTTP', 'Lead endpoint returned HTTP ' + response.status);
        });
      }
      throw makeError('LEAD_HTTP', 'Lead endpoint returned HTTP ' + (response ? response.status : 'unknown'));
    }
    return response.json().catch(function (error) {
      throw makeError('LEAD_RESPONSE', 'Lead endpoint returned invalid JSON', error);
    }).then(function (data) {
      var accepted = data && data.ok === true && typeof data.leadId === 'string' && data.leadId === fallbackLeadId;
      if (!accepted) throw makeError('LEAD_REJECTED', data && data.message ? String(data.message) : 'Lead endpoint did not confirm acceptance');
      return { ok: true, leadId: fallbackLeadId };
    });
  }

  function sendVerified(fields, tag, options) {
    var opts = options || {};
    var cfg = config();
    var attachmentCheck = validateAttachment(opts.attachment, cfg);
    if (!attachmentCheck.ok) return Promise.reject(makeError(attachmentCheck.code, attachmentCheck.message));
    if (attachmentCheck.file && !attachmentTransportReady(cfg)) {
      return Promise.reject(makeError('FILE_TRANSPORT_PENDING', 'Вложения будут доступны после подключения проверяемого канала.'));
    }
    var envelope;
    var url;
    var body;
    try {
      envelope = buildEnvelope(fields, tag, opts, cfg);
      if (envelope.spamCheck.website) {
        emit('success', { formId: envelope.formId, leadId: envelope.leadId });
        return Promise.resolve({ ok: true, leadId: envelope.leadId, filtered: true });
      }
      if (!envelope.consent.accepted) throw makeError('CONSENT_REQUIRED', 'Personal data consent is required');
      url = endpointFor(cfg);
      body = requestBody(envelope, attachmentCheck.file, cfg);
    } catch (error) {
      report(error);
      emit('error', { formId: opts.formId, leadId: opts.leadId });
      return Promise.reject(error);
    }

    var requestTimeoutMs = attachmentCheck.file ? Math.max(cfg.timeoutMs, cfg.uploadTimeoutMs) : cfg.timeoutMs;
    return confirmedRequest(url, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: body
    }, requestTimeoutMs, cfg, envelope.leadId).then(function (result) {
      emit('success', { formId: envelope.formId, leadId: result.leadId });
      return result;
    }).catch(function (error) {
      report(error);
      emit('error', { formId: envelope.formId, leadId: envelope.leadId });
      throw error;
    });
  }

  function send(fields, tag, options) {
    var opts = options || {};
    if (collectionState === 'disabled') {
      var disabledError = makeError('COLLECTION_DISABLED', 'Онлайн-форма временно не принимает данные. Позвоните нам или напишите в WhatsApp.');
      report(disabledError);
      emit('error', { formId: opts.formId, leadId: opts.leadId });
      return Promise.reject(disabledError);
    }
    return verifyCollectionStatus().then(function (enabled) {
      if (!enabled) {
        var error = makeError('COLLECTION_DISABLED', 'Онлайн-форма временно не принимает данные. Позвоните нам или напишите в WhatsApp.');
        report(error);
        emit('error', { formId: opts.formId, leadId: opts.leadId });
        throw error;
      }
      return sendVerified(fields, tag, opts);
    });
  }

  function resultBox(form) {
    return form.querySelector('.form-result') || (form.parentNode && form.parentNode.querySelector && form.parentNode.querySelector('.form-result'));
  }

  function clearResult(form) {
    var box = resultBox(form);
    if (!box) return;
    box.style.display = 'none';
    box.classList.remove('form-error');
    box.classList.add('form-ok');
  }

  function renderResult(form, status, leadId) {
    var box = resultBox(form);
    if (!box && root.document) {
      box = root.document.createElement('div');
      box.className = 'form-result';
      form.parentNode.insertBefore(box, form.nextSibling);
    }
    if (!box) return;
    box.textContent = '';
    box.setAttribute('role', status === 'error' ? 'alert' : 'status');
    box.setAttribute('aria-live', status === 'error' ? 'assertive' : 'polite');
    box.classList.toggle('form-ok', status === 'success');
    box.classList.toggle('form-error', status === 'error');
    var title = root.document.createElement('b');
    var message = root.document.createElement('span');
    title.textContent = status === 'success' ? 'Заявка отправлена' : 'Не удалось подтвердить отправку';
    message.textContent = status === 'success'
      ? 'Мы получили обращение и свяжемся с вами в течение рабочего дня.'
      : 'Данные остались в форме. Повторите отправку или свяжитесь с нами по телефону.';
    box.appendChild(title);
    box.appendChild(message);
    if (status === 'success' && leadId) {
      var number = root.document.createElement('small');
      number.textContent = 'Номер обращения: ' + leadId;
      box.appendChild(number);
    }
    if (status === 'error') {
      var phone = root.document.createElement('a');
      phone.href = 'tel:+79272295828';
      phone.textContent = '8 (927) 229-58-28';
      box.appendChild(phone);
    }
    box.style.display = 'block';
  }

  function setSending(form, sending) {
    var button = form.querySelector('button[type="submit"]');
    form.setAttribute('aria-busy', sending ? 'true' : 'false');
    if (!button) return;
    if (!button.dataset.leadLabel) button.dataset.leadLabel = button.textContent;
    button.disabled = sending || !collectionEnabled();
    button.textContent = sending ? 'Отправляем…' : button.dataset.leadLabel;
  }

  function attachmentFrom(form) {
    if (form.__attachment) return form.__attachment;
    var input = form.querySelector('input[type="file"][name="attachment"]');
    return input && input.files ? input.files[0] : null;
  }

  function phoneInput(form) {
    return form.querySelector('input[type="tel"]');
  }

  function submitForm(form) {
    if (!form || (inFlight && inFlight.has(form))) return false;
    if (!collectionEnabled()) {
      lockForm(form);
      return false;
    }
    var phone = phoneInput(form);
    if (phone && !validPhone(phone.value)) {
      phone.setCustomValidity('Введите телефон из 10 или 11 цифр.');
      if (phone.reportValidity) phone.reportValidity();
      phone.focus();
      return false;
    }
    if (phone) phone.setCustomValidity('');

    var consent = form.querySelector('[data-lead-consent]');
    if (!consent || !consent.checked) {
      if (consent) {
        consent.setCustomValidity('Подтвердите согласие на обработку персональных данных.');
        if (consent.reportValidity) consent.reportValidity();
        consent.focus();
      }
      return false;
    }
    consent.setCustomValidity('');

    if (form.__attachmentError) {
      var invalidDrop = form.querySelector('.filedrop');
      if (invalidDrop) invalidDrop.focus();
      return false;
    }

    var cfg = config();
    var attachment = attachmentFrom(form);
    var checked = validateAttachment(attachment, cfg);
    if (!checked.ok) {
      renderResult(form, 'error');
      return false;
    }

    clearResult(form);
    setSending(form, true);
    var requestState = form.__leadRequest;
    if (!requestState) {
      var leadId = form.dataset.leadId || requestId();
      form.dataset.leadId = leadId;
      requestState = {
        fields: leadFields(form),
        tag: form.dataset.leadTag || 'форма',
        options: {
          leadId: leadId,
          formId: form.dataset.leadForm || 'page:request',
          attachment: checked.file,
          honeypot: (form.querySelector('input[name="_honey"]') || {}).value || '',
          elapsedMs: Date.now() - (Number(form.dataset.leadStartedAt) || Date.now()),
          createdAt: new Date().toISOString(),
          context: pageContext(),
          consentAccepted: true,
          consentUrl: consent.dataset.consentUrl || ''
        }
      };
      form.__leadRequest = requestState;
    }
    var task = send(requestState.fields, requestState.tag, requestState.options).then(function (result) {
      form.__leadRequest = null;
      form.style.display = 'none';
      renderResult(form, 'success', result.leadId);
      return result;
    }).catch(function () {
      renderResult(form, 'error');
      return null;
    }).finally(function () {
      setSending(form, false);
      if (inFlight) inFlight.delete(form);
      if (form.__leadDirty) {
        form.__leadDirty = false;
        form.__leadRequest = null;
        delete form.dataset.leadId;
      }
    });
    if (inFlight) inFlight.set(form, task);
    return false;
  }

  function absoluteHref(value) {
    try { return new URL(String(value || ''), root.location && root.location.href || '').href; } catch (_) { return String(value || ''); }
  }

  function routeFromRuntime(route) {
    var script = root.document.querySelector('script[src*="assets/js/leads.js"]');
    var source = script && script.getAttribute ? script.getAttribute('src') : '';
    var marker = 'assets/js/leads.js';
    var at = String(source || '').indexOf(marker);
    return at >= 0 ? source.slice(0, at) + route.replace(/^\/+/, '') : route;
  }

  function legalHref(fragment, route) {
    var link = root.document.querySelector('.foot-legal a[href*="' + fragment + '"], a[href*="' + fragment + '"]');
    return absoluteHref(link ? link.getAttribute('href') : routeFromRuntime(route));
  }

  function consentUi(form) {
    if (form.querySelector('[data-lead-consent]')) return;
    var old = form.querySelector('p.consent');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var wrap = root.document.createElement('label');
    wrap.className = 'lead-consent-check';
    var input = root.document.createElement('input');
    input.type = 'checkbox';
    input.required = true;
    input.setAttribute('data-lead-consent', '');
    input.dataset.consentUrl = legalHref('/consent/', 'consent/');
    var copy = root.document.createElement('span');
    copy.appendChild(root.document.createTextNode('Я даю '));
    var consentLink = root.document.createElement('a');
    consentLink.href = input.dataset.consentUrl;
    consentLink.textContent = 'согласие на обработку персональных данных';
    copy.appendChild(consentLink);
    copy.appendChild(root.document.createTextNode(' и ознакомлен(а) с '));
    var policyLink = root.document.createElement('a');
    policyLink.href = legalHref('/privacy/', 'privacy/');
    policyLink.textContent = 'Политикой';
    copy.appendChild(policyLink);
    wrap.appendChild(input);
    wrap.appendChild(copy);
    var submit = form.querySelector('button[type="submit"], .btn[type="submit"], button.btn-block');
    if (submit) form.insertBefore(wrap, submit); else form.appendChild(wrap);
    input.addEventListener('change', function () { input.setCustomValidity(''); });
  }

  function fileUi(form) {
    if (form.querySelector('.lead-file')) return;
    var cfg = config();
    if (!attachmentTransportReady(cfg)) return;
    var wrap = root.document.createElement('div');
    wrap.className = 'field lead-file';
    var label = root.document.createElement('label');
    label.textContent = 'Прикрепить файл (чертёж, ТЗ, план) — необязательно';
    var drop = root.document.createElement('div');
    drop.className = 'filedrop';
    drop.tabIndex = 0;
    drop.setAttribute('role', 'button');
    drop.setAttribute('aria-label', 'Прикрепить файл');
    var input = root.document.createElement('input');
    input.type = 'file';
    input.name = 'attachment';
    input.accept = cfg.allowedExtensions.map(function (ext) { return '.' + ext; }).join(',');
    input.hidden = true;
    var text = root.document.createElement('span');
    text.className = 'filedrop-txt';
    var main = root.document.createElement('b');
    var note = root.document.createElement('small');
    text.appendChild(main);
    text.appendChild(note);
    drop.appendChild(input);
    drop.appendChild(text);
    wrap.appendChild(label);
    wrap.appendChild(drop);
    var submit = form.querySelector('button[type="submit"], .btn[type="submit"], button.btn-block');
    if (submit) form.insertBefore(wrap, submit); else form.appendChild(wrap);

    function empty() {
      input.value = '';
      form.__attachment = null;
      form.__attachmentError = null;
      drop.classList.remove('has', 'err');
      drop.setAttribute('aria-invalid', 'false');
      drop.setAttribute('aria-label', 'Прикрепить файл');
      main.textContent = 'Перетащите файл сюда или нажмите';
      note.textContent = 'до 10 МБ · PDF, JPG, PNG, WEBP, DWG, DXF, DOC, XLS, ZIP';
    }

    function setFile(file) {
      if (!file) { empty(); return; }
      form.__attachment = null;
      form.__attachmentError = null;
      var checked = validateAttachment(file, cfg);
      if (!checked.ok) {
        input.value = '';
        form.__attachmentError = checked;
        drop.classList.add('err');
        drop.classList.remove('has');
        drop.setAttribute('aria-invalid', 'true');
        drop.setAttribute('aria-label', checked.message);
        main.textContent = checked.message;
        note.textContent = file && file.name ? file.name : 'Выберите другой файл';
        return;
      }
      form.__attachment = checked.file;
      drop.classList.remove('err');
      drop.classList.add('has');
      drop.setAttribute('aria-invalid', 'false');
      drop.setAttribute('aria-label', 'Файл прикреплён: ' + checked.file.name + '. Нажмите, чтобы убрать');
      main.textContent = checked.file.name;
      note.textContent = Math.max(1, Math.round(checked.file.size / 1024)) + ' КБ · прикреплён · нажмите, чтобы убрать';
    }

    empty();
    drop.addEventListener('click', function (event) {
      if (event.target === input) return;
      if (drop.classList.contains('has')) { empty(); return; }
      input.click();
    });
    drop.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (drop.classList.contains('has')) empty(); else input.click();
    });
    input.addEventListener('change', function () { setFile(input.files && input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (name) {
      drop.addEventListener(name, function (event) { event.preventDefault(); drop.classList.add('drag'); });
    });
    ['dragleave', 'dragend', 'drop'].forEach(function (name) {
      drop.addEventListener(name, function (event) { event.preventDefault(); drop.classList.remove('drag'); });
    });
    drop.addEventListener('drop', function (event) {
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) setFile(file);
    });
  }

  function prepareForms() {
    var forms = leadForms();
    Array.prototype.forEach.call(forms, function (form, index) {
      form.dataset.leadForm = form.dataset.leadForm || inferFormId(form, index);
      form.dataset.leadTag = form.dataset.leadTag || (root.document.title || 'форма');
      form.dataset.leadStartedAt = form.dataset.leadStartedAt || String(Date.now());
      if (!form.querySelector('input[name="_honey"]')) {
        var honey = root.document.createElement('input');
        honey.type = 'text';
        honey.name = '_honey';
        honey.tabIndex = -1;
        honey.autocomplete = 'off';
        honey.setAttribute('aria-hidden', 'true');
        honey.className = 'lead-honey';
        form.appendChild(honey);
      }
      var phone = phoneInput(form);
      if (phone) phone.addEventListener('input', function () { phone.setCustomValidity(''); });
      if (typeof form.addEventListener === 'function') {
        var resetRetry = function () {
          if (inFlight && inFlight.has(form)) {
            form.__leadDirty = true;
            return;
          }
          form.__leadRequest = null;
          delete form.dataset.leadId;
        };
        form.addEventListener('input', resetRetry);
        form.addEventListener('change', resetRetry);
      }
      var box = resultBox(form);
      if (box) { box.setAttribute('aria-live', 'polite'); box.setAttribute('role', 'status'); }
      consentUi(form);
      fileUi(form);
      if (!collectionEnabled()) lockForm(form);
    });
  }

  var api = {
    config: config,
    collect: leadFields,
    normalizePhone: normalizePhone,
    validPhone: validPhone,
    requestId: requestId,
    validateAttachment: validateAttachment,
    attachmentTransportReady: attachmentTransportReady,
    collectionEnabled: collectionEnabled,
    verifyCollectionStatus: verifyCollectionStatus,
    send: send,
    submitForm: submitForm,
    prepareForms: prepareForms
  };
  root.EGOE_LEADS = api;
  root.__sendLead = send;
  root.submitLead = submitForm;

  // Fail closed synchronously; only the same-origin server status can unlock controls.
  lockAllForms();
  verifyCollectionStatus();

  function initialize() {
    try {
      root.localStorage.removeItem('sp_leads_v1');
      root.localStorage.removeItem('sp_kp_head_v1');
    } catch (_) {}
    recordJourney(pageContext());
    prepareForms();
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
