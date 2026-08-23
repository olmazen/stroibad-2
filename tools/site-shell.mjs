import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SHELL_DATA_PATH = path.join(ROOT, 'src', 'shared', 'site-shell.json');

export const HEADER_START = '<!-- EGOE:SITE_HEADER:START -->';
export const HEADER_END = '<!-- EGOE:SITE_HEADER:END -->';
export const FOOTER_START = '<!-- EGOE:SITE_FOOTER:START -->';
export const FOOTER_END = '<!-- EGOE:SITE_FOOTER:END -->';

const ICONS = {
  maf: '<svg viewBox="0 0 24 24"><path d="M3 11l2-3h14l2 3M3 11h18M5 11v6M19 11v6M3 17h3M18 17h3"/></svg>',
  fence: '<svg viewBox="0 0 24 24"><path d="M3 9h18M3 14h18M6 5v15M10 5v15M14 5v15M18 5v15"/></svg>',
  basket: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1"/><path d="M7 10h10M7 13.5h10"/></svg>',
  mailbox: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="1"/><path d="M4 12.5h16M9.5 8V6h5v2"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h4l2 5-3 2a12 12 0 005 5l2-3 5 2v4a2 2 0 01-2 2A17 17 0 014 5a2 2 0 012-2z"/></svg>',
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  hours: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
};

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Site shell ${label} must be an object`);
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Site shell ${label} must be a non-empty string`);
  }
  return value;
}

function requireList(value, label, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new Error(`Site shell ${label} must contain at least ${minimum} item(s)`);
  }
  return value;
}

function validateInternalRoute(value, label) {
  const route = requireText(value, label);
  if (/^[a-z][a-z\d+.-]*:/i.test(route) || route.includes('\\') || route.split('/').includes('..')) {
    throw new Error(`Site shell ${label} is not a safe public route: ${route}`);
  }
}

function validateExternalHref(value, label, allowedProtocols) {
  const href = requireText(value, label);
  const protocol = href.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  if (!protocol || !allowedProtocols.includes(protocol)) {
    throw new Error(`Site shell ${label} must use ${allowedProtocols.join(' or ')}: ${href}`);
  }
}

function validateLinkList(items, label) {
  const seenLabels = new Set();
  const seenRoutes = new Set();
  requireList(items, label).forEach((item, index) => {
    requireRecord(item, `${label}[${index}]`);
    const itemLabel = requireText(item.label, `${label}[${index}].label`);
    validateInternalRoute(item.href, `${label}[${index}].href`);
    if (seenLabels.has(itemLabel)) throw new Error(`Duplicate site shell label in ${label}: ${itemLabel}`);
    if (seenRoutes.has(item.href)) throw new Error(`Duplicate site shell route in ${label}: ${item.href}`);
    seenLabels.add(itemLabel);
    seenRoutes.add(item.href);
  });
}

function validateSiteShellData(data) {
  requireRecord(data.brand, 'brand');
  requireText(data.brand.name, 'brand.name');
  requireText(data.brand.tagline, 'brand.tagline');

  requireRecord(data.topbar, 'topbar');
  requireText(data.topbar.production, 'topbar.production');
  requireText(data.topbar.office, 'topbar.office');
  requireText(data.topbar.shipping, 'topbar.shipping');
  requireRecord(data.topbar.phone, 'topbar.phone');
  requireText(data.topbar.phone.label, 'topbar.phone.label');
  validateExternalHref(data.topbar.phone.href, 'topbar.phone.href', ['tel']);
  requireList(data.topbar.messengers, 'topbar.messengers').forEach((item, index) => {
    requireRecord(item, `topbar.messengers[${index}]`);
    requireText(item.label, `topbar.messengers[${index}].label`);
    if (item.disabled === true) {
      if (item.href !== '') throw new Error(`Disabled site shell messenger must have an empty href: ${item.label}`);
    } else {
      validateExternalHref(item.href, `topbar.messengers[${index}].href`, ['https']);
    }
  });

  requireRecord(data.catalog, 'catalog');
  requireText(data.catalog.label, 'catalog.label');
  validateInternalRoute(data.catalog.href, 'catalog.href');
  if (!Array.isArray(data.catalog.items) || data.catalog.items.length !== 4) {
    throw new Error('Site shell catalog.items must contain exactly four compact-menu items');
  }
  validateLinkList(data.catalog.items, 'catalog.items');
  data.catalog.items.forEach((item, index) => {
    requireText(item.description, `catalog.items[${index}].description`);
    const icon = requireText(item.icon, `catalog.items[${index}].icon`);
    if (!ICONS[icon]) throw new Error(`Unknown site shell icon: ${icon}`);
  });
  validateLinkList(data.primaryNavigation, 'primaryNavigation');
  requireRecord(data.headerCta, 'headerCta');
  requireText(data.headerCta.label, 'headerCta.label');
  validateInternalRoute(data.headerCta.href, 'headerCta.href');

  requireRecord(data.footer, 'footer');
  requireText(data.footer.about, 'footer.about');
  requireList(data.footer.badges, 'footer.badges').forEach((badge, index) => requireText(badge, `footer.badges[${index}]`));
  validateLinkList(data.footer.productLinks, 'footer.productLinks');
  validateLinkList(data.footer.clientLinks, 'footer.clientLinks');
  requireList(data.footer.contacts, 'footer.contacts').forEach((item, index) => {
    requireRecord(item, `footer.contacts[${index}]`);
    const type = requireText(item.type, `footer.contacts[${index}].type`);
    if (!ICONS[type]) throw new Error(`Unknown site shell icon: ${type}`);
    requireText(item.label, `footer.contacts[${index}].label`);
    if (item.href) validateExternalHref(item.href, `footer.contacts[${index}].href`, ['tel', 'mailto']);
  });
  requireText(data.footer.copyright, 'footer.copyright');
  validateLinkList(data.footer.legalLinks, 'footer.legalLinks');
  requireText(data.footer.disclaimer, 'footer.disclaimer');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

export async function loadSiteShellData(siteRoot = ROOT) {
  const dataPath = siteRoot === ROOT
    ? DEFAULT_SHELL_DATA_PATH
    : path.join(path.resolve(siteRoot), 'src', 'shared', 'site-shell.json');
  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  if (data.schemaVersion !== 1) throw new Error(`Unsupported site shell schema: ${data.schemaVersion}`);
  validateSiteShellData(data);
  return data;
}

export function rootPrefixFor(pageRel) {
  const normalized = pageRel.split(path.sep).join('/');
  const dir = path.posix.dirname(normalized);
  if (dir === '.') return '';
  return '../'.repeat(dir.split('/').length);
}

export function publicHref(pageRel, target) {
  if (/^(?:https?:|mailto:|tel:|#)/i.test(target)) return target;
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) throw new Error(`Unsupported site shell URL protocol: ${target}`);
  const prefix = rootPrefixFor(pageRel);
  if (!target) return prefix || './';
  const route = target.replace(/^\/+/, '');
  if (route.split('/').includes('..')) throw new Error(`Site shell route escapes the public root: ${target}`);
  return `${prefix}${route}`;
}

function link(pageRel, item, className = '') {
  const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
  return `<a${classAttr} href="${escapeHtml(publicHref(pageRel, item.href))}">${escapeHtml(item.label)}</a>`;
}

function messengerIcon(item) {
  if (item.icon !== 'max') return '';
  return '<svg class="messenger-icon messenger-icon-max" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path fill="#6E1AFF" fill-rule="evenodd" clip-rule="evenodd" d="M50.757 0.262C78.293 0.262 99.886 22.597 99.886 50.147S77.607 99.49 51.021 99.49c-9.435 0-14.007-1.328-21.371-6.543a1.28 1.28 0 0 0-1.629.193c-5.664 6.043-20.171 10.286-20.835 2.036 0-14.386-7.186-23.729-7.186-45.3C0 21.555 23.221.262 50.757.262Zm.772 24.55C38.464 24.126 28.264 33.197 26.014 47.383c-1.864 11.75 1.436 26.071 4.265 26.793 1.2.307 4.078-1.9 6.178-3.879.393-.371.993-.435 1.45-.15 3.272 2 6.972 3.5 11.05 3.715 13.414.7 25.3-9.8 26.007-23.215.7-13.414-10.021-25.142-23.435-25.843v.008Z"/></svg>';
}

function renderMessenger(item) {
  const content = `${messengerIcon(item)}<span>${escapeHtml(item.label)}</span>`;
  if (item.disabled === true) {
    return `<span class="messenger-link is-disabled" aria-disabled="true" title="Ссылка на MAX появится позже">${content}</span>`;
  }
  return `<a class="messenger-link" href="${escapeHtml(item.href)}" target="_blank" rel="noopener">${content}</a>`;
}

export function renderSiteHeader(data, pageRel) {
  const catalogActive = pageRel === 'catalog/index.html' ? ' class="active" aria-current="page"' : '';
  const messengerLinks = data.topbar.messengers
    .map(renderMessenger)
    .join('');
  const dropdown = data.catalog.items.map((item) => `
        <a class="dd-item" href="${escapeHtml(publicHref(pageRel, item.href))}"><span class="dd-ico">${ICONS[item.icon]}</span><span class="dd-tx"><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.description)}</small></span></a>`).join('');
  const primary = data.primaryNavigation.map((item) => `
    ${link(pageRel, item)}`).join('');

  return `${HEADER_START}
<div class="topbar">
  <div class="container">
    <div class="tb-l">
      <span><b>Производство:</b> ${escapeHtml(data.topbar.production)}</span>
      <span><b>Офис:</b> ${escapeHtml(data.topbar.office)}</span>
      <span class="amber">${escapeHtml(data.topbar.shipping)}</span>
    </div>
    <div class="tb-r">
      <a href="${escapeHtml(data.topbar.phone.href)}"><b>${escapeHtml(data.topbar.phone.label)}</b></a>
      ${messengerLinks}
    </div>
  </div>
</div>

<header id="siteHeader" data-site-header><div class="container hdr">
  <a class="logo" href="${escapeHtml(publicHref(pageRel, ''))}"><span class="logo-mark"></span><span class="logo-txt"><b>${escapeHtml(data.brand.name)}</b><span>${escapeHtml(data.brand.tagline)}</span></span></a>
  <nav class="main" id="nav" aria-label="Основная навигация">
    <div class="navitem">
      <a href="${escapeHtml(publicHref(pageRel, data.catalog.href))}"${catalogActive}>${escapeHtml(data.catalog.label)}</a>
      <div class="dropdown">${dropdown}
      </div>
    </div>${primary}
  </nav>
  <div class="hdr-actions"><a class="btn btn-primary btn-sm" href="${escapeHtml(publicHref(pageRel, data.headerCta.href))}">${escapeHtml(data.headerCta.label)}</a></div>
  <button class="burger" type="button" aria-label="Открыть меню" aria-controls="mnav" aria-expanded="false" onclick="toggleNav()"><span></span><span></span><span></span></button>
</div></header>
${HEADER_END}`;
}

function renderFooterColumn(pageRel, title, items) {
  return `      <div>
        <div class="foot-col-h">${escapeHtml(title)}</div>
${items.map((item) => `        ${link(pageRel, item)}`).join('\n')}
      </div>`;
}

function renderContact(item) {
  const content = item.href
    ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
    : `<span>${escapeHtml(item.label)}</span>`;
  return `        <div class="foot-ic">${ICONS[item.type]}${content}</div>`;
}

export function renderSiteFooter(data, pageRel) {
  const badges = data.footer.badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('');
  const messengerLinks = data.topbar.messengers.map(renderMessenger).join('');
  const legalLinks = data.footer.legalLinks
    .map((item) => `<a href="${escapeHtml(publicHref(pageRel, item.href))}">${escapeHtml(item.label)}</a>`)
    .join('');

  return `${FOOTER_START}
<footer data-site-footer><div class="container">
    <div class="foot-grid">
      <div class="foot-about">
        <a class="logo" href="${escapeHtml(publicHref(pageRel, ''))}" style="margin-bottom:6px"><span class="logo-mark"></span><span class="logo-txt"><b style="color:#fff">${escapeHtml(data.brand.name)}</b><span>${escapeHtml(data.brand.tagline)}</span></span></a>
        <p>${escapeHtml(data.footer.about)}</p>
        <div class="foot-badges">${badges}</div>
        <div class="foot-msgr" style="margin-top:18px">${messengerLinks}</div>
      </div>
${renderFooterColumn(pageRel, 'Продукция', data.footer.productLinks)}
${renderFooterColumn(pageRel, 'Клиентам', data.footer.clientLinks)}
      <div>
        <div class="foot-col-h">Контакты</div>
${data.footer.contacts.map(renderContact).join('\n')}
      </div>
    </div>
    <div class="foot-bot"><span>${escapeHtml(data.footer.copyright)}</span><span class="foot-legal">${legalLinks}</span><span>${escapeHtml(data.footer.disclaimer)}</span></div>
  </div>
</footer>
${FOOTER_END}`;
}
