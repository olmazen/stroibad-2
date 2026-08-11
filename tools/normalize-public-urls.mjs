import fs from 'node:fs/promises';
import path from 'node:path';
import { relativePath, walkFiles } from './seo-utils.mjs';

const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const check = args.has('--check');
const root = path.resolve('.');
const htmlFiles = await walkFiles(root, (file) => file.endsWith('.html'));
const hrefPattern = /(<a\b[^>]*?\bhref\s*=\s*)(["'])([^"']*)(\2)/gi;
const terminalIndexPattern = /^(.*\/)index\.html([?#].*)?$/i;
const rootIndexPattern = /^(?:\.\/)?index\.html([?#].*)?$/i;
let changedFiles = 0;
let replacements = 0;
const examples = [];

function normalizeHref(href) {
  const rootMatch = href.match(rootIndexPattern);
  if (rootMatch) return `./${rootMatch[1] ?? ''}`;

  const nestedMatch = href.match(terminalIndexPattern);
  if (!nestedMatch) return href;
  return `${nestedMatch[1]}${nestedMatch[2] ?? ''}`;
}

for (const file of htmlFiles) {
  const original = await fs.readFile(file, 'utf8');
  const updated = original.replace(hrefPattern, (match, prefix, quote, href) => {
    const normalized = normalizeHref(href);
    if (normalized === href) return match;

    replacements += 1;
    if (examples.length < 12) {
      examples.push({ file: relativePath(root, file), from: href, to: normalized });
    }
    return `${prefix}${quote}${normalized}${quote}`;
  });

  if (updated === original) continue;
  changedFiles += 1;
  if (write) await fs.writeFile(file, updated, 'utf8');
}

console.log(JSON.stringify({
  htmlPages: htmlFiles.length,
  changedFiles,
  replacements,
  written: write,
  examples,
}, null, 2));

if (check && replacements > 0) process.exitCode = 1;
