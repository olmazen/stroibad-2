#!/usr/bin/env node
/**
 * Removes the obsolete “Расчёт по ТЗ” popup from published HTML.
 * Existing calls to action become ordinary links to the contacts page.
 *
 * Usage:
 *   node tools/remove-calculation-modal.mjs --check
 *   node tools/remove-calculation-modal.mjs --write
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs, out);
    else if (entry.name.endsWith('.html')) out.push(abs);
  }
  return out;
}

function contactHref(file) {
  const relDir = path.relative(ROOT, path.dirname(file));
  const depth = relDir ? relDir.split(path.sep).length : 0;
  return `${'../'.repeat(depth)}contacts/`;
}

function cleanAttrs(raw) {
  return raw
    .replace(/\s+onclick="openModal\(\)"/gi, '')
    .replace(/\s+type="button"/gi, '')
    .trim();
}

function removeModalBlock(html, file) {
  const start = html.search(/<div class="modal-wrap" id="modal">/i);
  if (start < 0) return { html, removed: false };
  const tags = /<div\b[^>]*>|<\/div\s*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))) {
    if (/^<div\b/i.test(match[0])) depth++;
    else depth--;
    if (depth === 0) {
      const left = html.slice(0, start).replace(/[ \t]+$/g, '');
      const right = html.slice(tags.lastIndex).replace(/^\s*\n?/, '\n');
      return { html: left + right, removed: true };
    }
  }
  // One legacy category page ended inside a malformed modal. The popup is the
  // final block there, so dropping the broken tail is safer than retaining
  // invalid markup. The caller restores the common closing tags/script.
  return { html: html.slice(0, start).trimEnd(), removed: true, malformed: true };
}

const stats = { html: 0, changed: 0, modals: 0, malformedModalTails: 0, buttons: 0, cards: 0, contactLinks: 0 };
for (const file of await walk(ROOT)) {
  let html = await fs.readFile(file, 'utf8');
  stats.html++;
  const before = html;
  const href = contactHref(file);

  const modal = removeModalBlock(html, file);
  html = modal.html;
  if (modal.removed) stats.modals++;
  if (modal.malformed) {
    stats.malformedModalTails++;
    html += `\n<script src="${'../'.repeat(path.relative(ROOT, path.dirname(file)).split(path.sep).filter(Boolean).length)}assets/js/site.js?v=egoe59"></script>\n</body>\n</html>\n`;
  }

  html = html.replace(/<button\b([^>]*)\bonclick="openModal\(\)"([^>]*)>([\s\S]*?)<\/button>/gi, (_m, a, b, label) => {
    stats.buttons++;
    const attrs = cleanAttrs(`${a} ${b}`);
    const nextLabel = /^(?:\s*)Расчёт по ТЗ(?:\s*)$/i.test(label) ? 'Обсудить проект' : label;
    return `<a${attrs ? ` ${attrs}` : ''} href="${href}">${nextLabel}</a>`;
  });

  // A few non-product catalogue cards opened the same popup. Keep them navigable.
  html = html.replace(/onclick="openModal\(\)"/gi, () => {
    stats.cards++;
    return `onclick="window.location.href='${href}'"`;
  });

  html = html.replace(/<a href="#">WhatsApp<\/a>/gi, () => {
    stats.contactLinks++;
    return '<a href="https://wa.me/79272295828" target="_blank" rel="noopener">WhatsApp</a>';
  });
  html = html.replace(/<a href="#">(?:Telegram|MAX)<\/a>/gi, () => {
    stats.contactLinks++;
    return '';
  });

  if (html !== before) {
    stats.changed++;
    if (WRITE) await fs.writeFile(file, html);
  }
}

console.log(JSON.stringify({ mode: WRITE ? 'write' : 'check', ...stats }, null, 2));
if (!WRITE && stats.changed) process.exitCode = 1;
