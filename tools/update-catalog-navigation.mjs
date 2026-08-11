#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function htmlFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(absolute);
  }
  return files;
}

function addMafBodyClass(html) {
  if (/<body\b[^>]*\bclass="[^"]*\bmaf-page\b/.test(html)) return html;
  if (/<body\s*>/.test(html)) return html.replace('<body>', '<body class="maf-page">');
  return html.replace(/<body\b([^>]*)\bclass="([^"]*)"([^>]*)>/, '<body$1class="$2 maf-page"$3>');
}

function rewrite(html, relative) {
  let next = html;

  // Главный пункт ведёт на общий каталог; ссылка «МАФ» в выпадающем меню остаётся отдельной.
  next = next.replace(
    /(<a href=")((?:\.\.\/)*)(?:maf\/)(">Каталог<\/a>)/g,
    '$1$2catalog/$3',
  );

  // Контейнерные площадки не показываем только в коротком выпадающем меню.
  // Сам раздел остаётся в каталоге, поиске, sitemap, footer и хлебных крошках.
  next = next.replace(
    /\s*<a class="dd-item" href="[^"]*metallokonstrukcii\/konteynernye-ploshchadki\/">[\s\S]*?<\/a>/g,
    '',
  );

  // Меняем версию после правки общего CSS, чтобы старый месячный кеш не скрывал результат.
  next = next.replace(/assets\/css\/style\.css\?v=[^"']+/g, 'assets/css/style.css?v=egoe55');

  if (relative === 'maf/index.html' || relative.startsWith('maf/')) {
    next = addMafBodyClass(next);
  }

  return next;
}

let changed = 0;
for (const file of await htmlFiles(root)) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const before = await readFile(file, 'utf8');
  const after = rewrite(before, relative);
  if (after === before) continue;
  await writeFile(file, after);
  changed += 1;
}

console.log(`Updated ${changed} HTML files.`);
