#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_SOURCE_ROOT = '/Users/almazrafikov/Documents/Codex/2026-06-15/files-mentioned-by-the-user-view/outputs/hobbyka-export/site-nomenclature';
const DEFAULT_GENERATED_ROOT = join(DEFAULT_SOURCE_ROOT, 'outputs/generated-ai');
const DEFAULT_PYTHON = '/Users/almazrafikov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';

const VARIANTS = [
  ['main', 'Главное фото'],
  ['closeup', 'Деталь'],
  ['white', 'Белый фон'],
  ['angle', 'На объекте'],
];

const CATEGORY_CONFIG = {
  skameyki: {
    source: 'skameyki',
    target: 'skamejki',
    imgTarget: 'skamejki',
    label: 'Скамейки',
    singular: 'скамейку',
    productType: 'скамейка для благоустройства',
    relatedTitle: 'Другие модели скамеек',
    relatedLink: 'Все скамейки',
    indexHeadline: 'Выберите модель скамейки',
    title: 'Скамейки уличные от производителя — каталог и цены | СТАЛЬПРОМ',
    h1: 'Скамейки уличные',
    lead: 'Парковые, дворовые и модульные скамейки из металла и дерева для благоустройства ЖК, парков, скверов и общественных пространств.',
    metaDescription: 'Скамейки уличные от производителя: 57 моделей, металл и дерево, окраска RAL, поставка по России. Выберите модель и запросите расчёт партии.',
    ogTitle: 'Скамейки уличные от производителя',
    listName: 'Модели уличных скамеек',
    defaultSpecs: [['Материал', 'сталь, дерево'], ['Тип товара', 'Скамейка уличная'], ['Поставка', 'по России']],
    stripNames: [/^Скамейка стальная\s*/i, /^Скамейка\s*/i, /^Банкетка\s*/i],
  },
  lezhaki_dlya_plyazha_i_dachi: {
    source: 'lezhaki_dlya_plyazha_i_dachi',
    target: 'lezhaki',
    imgTarget: 'lezhaki',
    label: 'Лежаки',
    singular: 'лежак',
    productType: 'парковый лежак для благоустройства',
    relatedTitle: 'Другие модели лежаков',
    relatedLink: 'Все лежаки',
    indexHeadline: 'Выберите модель лежака',
    title: 'Лежаки парковые от производителя — каталог и цены | СТАЛЬПРОМ',
    h1: 'Лежаки парковые',
    lead: 'Парковые, пляжные и городские лежаки для благоустройства зон отдыха, набережных, ЖК, парков и общественных пространств.',
    metaDescription: 'Лежаки парковые от производителя: модели из стали и дерева, окраска RAL, поставка по России. Выберите модель и запросите расчёт партии.',
    ogTitle: 'Лежаки парковые от производителя',
    listName: 'Модели парковых лежаков',
    defaultSpecs: [['Материал', 'сталь, дерево'], ['Тип товара', 'Лежак парковый'], ['Поставка', 'по России']],
    stripNames: [/^Парковый лежак\s*/i, /^Лежак\s*/i],
  },
  pavilony_i_navesy: {
    source: 'pavilony_i_navesy',
    target: 'pavilony-i-navesy',
    imgTarget: 'pavilony-i-navesy',
    label: 'Павильоны и навесы',
    singular: 'павильон',
    productType: 'павильон или навес для благоустройства',
    relatedTitle: 'Другие павильоны и навесы',
    relatedLink: 'Все павильоны и навесы',
    indexHeadline: 'Выберите модель павильона или навеса',
    title: 'Павильоны, навесы и беседки от производителя | СТАЛЬПРОМ',
    h1: 'Павильоны и навесы',
    lead: 'Павильоны, навесы и беседки из металла и дерева для дворов ЖК, парков, зон отдыха и общественных пространств.',
    metaDescription: 'Павильоны, навесы и беседки от производителя: металл, дерево, окраска RAL, изготовление под объект и поставка по России.',
    ogTitle: 'Павильоны и навесы от производителя',
    listName: 'Модели павильонов и навесов',
    defaultSpecs: [['Материал', 'сталь, дерево'], ['Тип товара', 'Павильон или навес'], ['Поставка', 'по России']],
    stripNames: [/^Беседка\s*/i, /^Навес\s*/i, /^Павильон\s*/i],
  },
  urny: {
    source: 'urny',
    target: 'urny',
    imgTarget: 'urny',
    label: 'Урны',
    singular: 'урну',
    productType: 'уличная урна для благоустройства',
    relatedTitle: 'Другие модели урн',
    relatedLink: 'Все урны',
    indexHeadline: 'Выберите модель урны',
    title: 'Урны уличные от производителя — каталог и цены | СТАЛЬПРОМ',
    h1: 'Урны уличные',
    lead: 'Металлические уличные урны для парков, дворов ЖК, общественных пространств, набережных и коммерческих территорий.',
    metaDescription: 'Урны уличные от производителя: металлические модели, окраска RAL, комплектация под объект, поставка по России.',
    ogTitle: 'Урны уличные от производителя',
    listName: 'Модели уличных урн',
    defaultSpecs: [['Материал', 'сталь'], ['Тип товара', 'Урна уличная'], ['Поставка', 'по России']],
    stripNames: [/^Урна уличная\s*/i, /^Урна\s*/i],
  },
};

function argValue(name, fallback = '') {
  const exact = process.argv.find((a) => a === `--${name}`);
  if (exact) return 'true';
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : fallback;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function priceRub(value) {
  const n = Number(String(value ?? '').replace(/[^\d.,]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 'по запросу';
  return `от ${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

function lowPrice(value) {
  const n = Number(String(value ?? '').replace(/[^\d.,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
}

function slugify(value, fallback) {
  let slug = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/^\/product\//, '')
    .replace(/\/$/g, '')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) slug = String(fallback || 'product');
  return slug;
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.filter((r) => r.some((v) => String(v || '').trim())).map((r) => {
    const item = {};
    headers.forEach((h, i) => { item[h] = r[i] ?? ''; });
    return item;
  });
}

function readCsv(file) {
  return parseCsv(readFileSync(file, 'utf8'));
}

function chooseVariant(manifest, variant) {
  const results = (manifest.results || [])
    .filter((r) => r.variant === variant && r.file && existsSync(r.file))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return results.findLast((r) => r.selected) || results.at(-1) || null;
}

function convertImage(src, dest, format, quality, maxSide) {
  mkdirSync(dirname(dest), { recursive: true });
  if (format === 'png') {
    writeFileSync(dest, readFileSync(src));
    return;
  }
  const python = process.env.PUBLISH_PYTHON || (existsSync(DEFAULT_PYTHON) ? DEFAULT_PYTHON : 'python3');
  const code = `
from PIL import Image
import sys
src, dest, quality, max_side = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src)
if im.mode not in ('RGB', 'RGBA'):
    im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
if max(im.size) > max_side:
    im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
if dest.lower().endswith('.webp'):
    im.save(dest, 'WEBP', quality=quality, method=6)
else:
    im.save(dest)
`;
  const res = spawnSync(python, ['-c', code, src, dest, String(quality), String(maxSide)], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`Image convert failed: ${src}\n${res.stderr || res.stdout}`);
  }
}

function cleanDescription(product, fallbackType = 'изделие для благоустройства') {
  const raw = text(product.description_main || product.item_description || '');
  if (!raw) return `${fallbackType[0].toUpperCase()}${fallbackType.slice(1)} для общественных пространств. Производим под проект, подбираем цвет металла, материалы и комплектацию под объект.`;
  return raw.replace(/^Материалы:\s*/i, '').slice(0, 520);
}

function nav(prefix) {
  return `
<div class="topbar"><div class="container">
  <div class="tb-l"><span><b>Производство:</b> г. Балаково</span><span><b>Офис:</b> г. Москва</span><span class="amber">Отгрузка по всей России</span></div>
  <div class="tb-r"><a href="tel:+70000000000"><b>+7 (000) 000-00-00</b></a><a href="#">WhatsApp</a><a href="#">Telegram</a></div>
</div></div>
<header id="siteHeader"><div class="container hdr">
  <a class="logo" href="${prefix}index.html"><span class="logo-mark"></span><span class="logo-txt"><b>СТАЛЬПРОМ</b><span>Завод металлоконструкций</span></span></a>
  <nav class="main" id="nav">
    <div class="navitem"><a href="${prefix}maf/index.html">Каталог</a>
      <div class="dropdown">
        <a class="dd-item" href="${prefix}maf/index.html"><span class="dd-ico"><svg viewBox="0 0 24 24"><path d="M3 11l2-3h14l2 3M3 11h18M5 11v6M19 11v6M3 17h3M18 17h3"/></svg></span><span class="dd-tx"><b>Малые архитектурные формы</b><small>Скамейки, качели, урны, лежаки, навесы</small></span></a>
        <a class="dd-item" href="${prefix}ograzhdeniya/index.html"><span class="dd-ico"><svg viewBox="0 0 24 24"><path d="M3 9h18M3 14h18M6 5v15M10 5v15M14 5v15M18 5v15"/></svg></span><span class="dd-tx"><b>Ограждения</b><small>Секционные, газонные, перила</small></span></a>
        <a class="dd-item" href="${prefix}metallokonstrukcii/korziny-dlya-konditsionerov/index.html"><span class="dd-ico"><svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1"/><path d="M7 10h10M7 13.5h10"/></svg></span><span class="dd-tx"><b>Корзины для кондиционеров</b><small>На фасад, по размерам</small></span></a>
        <a class="dd-item" href="${prefix}metallokonstrukcii/konteynernye-ploshchadki/index.html"><span class="dd-ico"><svg viewBox="0 0 24 24"><path d="M5 9l1.5 10h11L19 9M3 9h18M9 6h6"/></svg></span><span class="dd-tx"><b>Контейнерные площадки</b><small>Для ТКО</small></span></a>
      </div>
    </div>
    <a href="${prefix}proizvodstvo/index.html">Производство</a>
    <a href="${prefix}zastrojshchikam/index.html">Застройщикам</a>
    <a href="${prefix}projects/index.html">Проекты</a>
    <a href="${prefix}about/index.html">О компании</a>
    <a href="${prefix}contacts/index.html">Контакты</a>
  </nav>
  <div class="hdr-actions"><button class="btn btn-primary btn-sm" onclick="openModal()">Расчёт по ТЗ</button></div>
  <div class="burger" onclick="toggleNav()"><span></span><span></span><span></span></div>
</div></header>`;
}

function footer(prefix) {
  return `
<footer>
  <div class="foot-cta"><div class="container">
    <div><div class="eyebrow">Завод-производитель · Балаково → по всей России</div><h2>Рассчитаем ваш объект за 1 рабочий день</h2></div>
    <div class="foot-cta-act"><button class="btn btn-primary" onclick="openModal()">Получить расчёт по ТЗ</button><a class="foot-cta-phone" href="tel:+70000000000">+7 (000) 000-00-00<small>звонок и расчёт бесплатно</small></a></div>
  </div></div>
  <div class="container">
    <div class="foot-grid">
      <div class="foot-about"><a class="logo" href="${prefix}index.html"><span class="logo-mark"></span><span class="logo-txt"><b style="color:#fff">СТАЛЬПРОМ</b><span>Завод металлоконструкций</span></span></a><p>Производство полного цикла в Балаково: лазерная резка, гибка на ЧПУ, сварка, порошковая окраска RAL и собственный цех деревообработки.</p><div class="foot-badges"><span>14 лет</span><span>800+ объектов</span><span>44-ФЗ · НДС</span></div></div>
      <div><div class="foot-col-h">Продукция</div><a href="${prefix}maf/skamejki/index.html">Скамейки</a><a href="${prefix}maf/kacheli/index.html">Качели</a><a href="${prefix}maf/urny/index.html">Урны</a><a href="${prefix}maf/lezhaki/index.html">Лежаки</a><a href="${prefix}maf/pavilony-i-navesy/index.html">Павильоны и навесы</a><a href="${prefix}maf/veloparkovki/index.html">Велопарковки</a><a href="${prefix}ograzhdeniya/index.html">Ограждения</a></div>
      <div><div class="foot-col-h">Клиентам</div><a href="${prefix}proizvodstvo/index.html">Производство полного цикла</a><a href="${prefix}zastrojshchikam/index.html">Застройщикам</a><a href="${prefix}44-fz/index.html">Работа по 44-ФЗ</a><a href="${prefix}projects/index.html">Проекты и кейсы</a><a href="${prefix}dostavka/index.html">Доставка и оплата</a></div>
      <div><div class="foot-col-h">Контакты</div><div class="foot-ic"><span>+7 (000) 000-00-00</span></div><div class="foot-ic"><span>info@stalprom.ru</span></div><div class="foot-ic"><span>Производство: г. Балаково</span></div><div class="foot-ic"><span>Пн–Пт 9:00–18:00</span></div></div>
    </div>
    <div class="foot-bot"><span>© 2026 СТАЛЬПРОМ. Завод металлоконструкций.</span><span>Информация на сайте не является публичной офертой</span></div>
  </div>
</footer>
<div class="modal-wrap" id="modal"><div class="modal" style="position:relative">
  <span class="modal-x" onclick="closeModal()">×</span>
  <div class="formpanel"><h3>Расчёт по ТЗ</h3><p>Оставьте контакты — перезвоним и поможем с расчётом.</p>
    <form onsubmit="return submitLead(this)"><div class="field"><label>Имя</label><input type="text" required></div><div class="field"><label>Телефон</label><input type="tel" required placeholder="+7"></div><button class="btn btn-primary btn-block" type="submit">Отправить</button><p class="consent">Нажимая кнопку, вы соглашаетесь с политикой обработки персональных данных.</p></form>
    <div class="form-result form-ok" style="display:none"><b>Заявка принята</b>Мы свяжемся с вами в течение рабочего дня.</div>
  </div>
</div></div>`;
}

function doc({ title, description, canonical, ogImage, cssPrefix, body, scriptPrefix }) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:locale" content="ru_RU">
<meta property="og:site_name" content="СТАЛЬПРОМ">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=PT+Sans:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${cssPrefix}assets/css/style.css?v=maf-ai-2">
</head>
<body>
${body}
<script src="${scriptPrefix}assets/js/site.js?v=gallery-2"></script>
</body>
</html>
`;
}

function card(cfg, product, prefix = '../../') {
  const img = `${prefix}assets/img/maf/${cfg.imgTarget}/${product.sku}/main.webp`;
  return `<a class="model-card reveal" href="${prefix}maf/${cfg.target}/${product.pageSlug}/index.html">
  <div style="position:relative"><span class="mc-badge">${esc(product.badge)}</span><div class="ph has-img r-43"><img src="${img}" alt="${esc(product.name)}" loading="lazy"><span class="ph-label">${esc(product.shortName)}</span></div></div>
  <div class="mc-b">
    <h3>${esc(product.name)}</h3>
    <div class="mc-sub">${esc(product.cardText)}</div>
    <ul class="mc-spec">${product.cardSpecs.map(([a, b]) => `<li><span>${esc(a)}</span><b>${esc(b)}</b></li>`).join('')}</ul>
    <div class="mc-foot"><div class="mc-price"><b>${esc(product.priceText)}</b><small>по комплектации и партии</small></div><span class="mc-go">Выбрать →</span></div>
  </div>
</a>`;
}

function renderIndex(cfg, products) {
  const prefix = '../../';
  const items = products.map((p, i) => `{"@type":"ListItem","position":${i + 1},"name":"${esc(p.name)}","url":"https://stalprom.ru/maf/${cfg.target}/${p.pageSlug}/"}`).join(',');
  const body = `${nav(prefix)}
<main>
<div class="shero">
  <div class="shero-bg"><div class="ph has-img r-169"><img src="${prefix}assets/img/maf/${cfg.imgTarget}/${products[0].sku}/main.webp" alt="${esc(products[0].name)}" loading="lazy"></div></div>
  <span class="shero-corner">${esc(cfg.label)} · каталог</span>
  <div class="container"><div class="shero-inner">
    <nav class="crumbs"><a href="${prefix}index.html">Главная</a> / <a href="${prefix}maf/index.html">МАФ</a> / <span>${esc(cfg.label)}</span></nav>
    <div class="eyebrow">Малые архитектурные формы</div>
    <h1>${esc(cfg.h1)} <em>от производителя</em></h1>
    <p class="lead">${esc(cfg.lead)}</p>
    <div class="shero-meta"><span><b>${products.length}</b> моделей</span><span>сталь + дерево</span><span>окраска <b>RAL</b></span><span>поставка по России</span></div>
  </div></div>
</div>
<section>
  <div class="container">
    <div class="reveal"><div class="dim"><span class="tick"></span>Модельный ряд</div></div>
    <div class="sec-head reveal" style="margin-top:24px"><div><h2>${esc(cfg.indexHeadline)}</h2></div><p class="lead-wide">Все позиции взяты из согласованной номенклатуры. Фото можно автоматически обновлять из AI-генератора: страницы и карточки подхватят новые кадры после публикации.</p></div>
    <div class="model-grid">${products.map((p) => card(cfg, p, prefix)).join('\n')}</div>
  </div>
</section>
<section class="dev" style="padding:72px 0"><div class="container"><div class="split">
  <div class="reveal"><div class="dim on-dark"><span class="tick"></span>Под объект</div><h2 style="margin:22px 0 16px;font-size:clamp(24px,3vw,36px)">Комплектуем территорию МАФ в едином стиле</h2><p style="color:#B5BAC0;font-size:16px;max-width:520px">Подбираем серию под дизайн-код территории: единый RAL, древесина, закладные, крепёж и поставка партиями под график благоустройства.</p><button class="btn btn-primary" style="margin-top:24px" onclick="openModal()">Запросить расчёт серии</button></div>
  <ul class="devlist reveal" style="--d:.1s"><li><span><b>${products.length} моделей.</b> Подбираем решение под двор, парк, ЖК или общественную территорию.</span></li><li><span><b>Единый RAL.</b> Металл окрашиваем в цвет проекта и соседних МАФ.</span></li><li><span><b>Проектная поставка.</b> Считаем партию, логистику, монтажные закладные и сроки.</span></li><li><span><b>Документы.</b> Работаем с НДС, готовим паспорта изделий и спецификации.</span></li></ul>
</div></div></section>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","name":"${esc(cfg.listName)}","itemListElement":[${items}]}</script>
</main>
${footer(prefix)}`;
  return doc({
    title: cfg.title,
    description: cfg.metaDescription,
    canonical: `https://stalprom.ru/maf/${cfg.target}/`,
    ogImage: `https://stalprom.ru/assets/img/maf/${cfg.imgTarget}/${products[0].sku}/main.webp`,
    cssPrefix: prefix,
    scriptPrefix: prefix,
    body,
  });
}

function renderProduct(cfg, product, allProducts) {
  const prefix = '../../../';
  const rel = `assets/img/maf/${cfg.imgTarget}/${product.sku}`;
  const others = allProducts.filter((p) => p.sku !== product.sku).slice(0, 3);
  const specRows = product.specs.length ? product.specs : cfg.defaultSpecs;
  const description = cleanDescription(product.raw, cfg.productType);
  const schemaPrice = lowPrice(product.raw.price);
  const schemaOffer = schemaPrice ? `"offers":{"@type":"AggregateOffer","priceCurrency":"RUB","lowPrice":"${schemaPrice}","availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"СТАЛЬПРОМ"}}` : `"offers":{"@type":"Offer","priceCurrency":"RUB","availability":"https://schema.org/InStock","seller":{"@type":"Organization","name":"СТАЛЬПРОМ"}}`;
  const body = `${nav(prefix)}
<main>
<div class="page-head"><div class="container">
  <nav class="crumbs"><a href="${prefix}index.html">Главная</a> / <a href="${prefix}maf/index.html">МАФ</a> / <a href="${prefix}maf/${cfg.target}/index.html">${esc(cfg.label)}</a> / <span>${esc(product.name)}</span></nav>
  <h1>${esc(product.name)}</h1>
  <p>${esc(product.cardText)}</p>
</div></div>
<section><div class="container"><div class="prodpage">
  <div class="gallery">
    <div class="ph has-img main r-43"><img src="${prefix}${rel}/main.webp" alt="${esc(product.name)}" loading="eager"><span class="ph-label">${esc(product.name)}</span></div>
    <div class="thumbs">
      <div class="ph has-img r-43"><img src="${prefix}${rel}/closeup.webp" alt="${esc(product.name)} — деталь" loading="lazy"><span class="ph-label">деталь</span></div>
      <div class="ph has-img contain r-43"><img src="${prefix}${rel}/white.webp" alt="${esc(product.name)} — белый фон" loading="lazy"><span class="ph-label">белый фон</span></div>
      <div class="ph has-img r-43"><img src="${prefix}${rel}/angle.webp" alt="${esc(product.name)} на объекте" loading="lazy"><span class="ph-label">на объекте</span></div>
    </div>
  </div>
  <div class="pp-info">
    <h1 style="font-size:30px">${esc(product.name)}</h1>
    <div class="pp-art">Артикул ${esc(product.sku)} · ${esc(cfg.productType)}</div>
    <div class="pp-price"><span class="big">${esc(product.priceText)}</span><span class="note">точная цена — по комплектации и партии</span></div>
    <div class="opt-row"><div class="lbl">Цвет металла (RAL)</div><div class="ral"><span class="ralc on" onclick="pickOption(this)" data-ral="#383E42" style="background:#383E42" title="RAL 7016"></span><span class="ralc" onclick="pickOption(this)" data-ral="#0A0A0C" style="background:#0A0A0C" title="RAL 9005"></span><span class="ralc" onclick="pickOption(this)" data-ral="#45322E" style="background:#45322E" title="RAL 8017"></span><span class="ralc" onclick="pickOption(this)" data-ral="#114232" style="background:#114232" title="RAL 6005"></span></div></div>
    <div class="opt-row"><div class="lbl">Количество</div><div class="qty"><button onclick="qtyStep(this,-1)">−</button><input type="text" value="1" inputmode="numeric"><button onclick="qtyStep(this,1)">+</button></div></div>
    <div class="pp-actions"><button class="btn btn-primary" onclick="openModal()">Запросить расчёт</button><a class="btn" href="tel:+70000000000">Позвонить</a></div>
    <div class="obj-note"><b>Заказ под объект</b><br>Подберём цвет RAL, древесину, крепление, логистику и серийную цену под проект благоустройства.</div>
  </div>
</div></div></section>
<section style="padding-top:0"><div class="container"><div class="split">
  <div><div class="sec-head"><div><h2>Характеристики</h2></div></div><table class="specs">${specRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>
  <div><div class="sec-head"><div><h2>Описание</h2></div></div><div class="prose"><p>${esc(description)}</p><p>Изготавливаем модель под объект: партия, цвет металла, покрытие древесины, крепёж и график поставки согласуются под проект.</p></div></div>
</div></div></section>
<section style="padding-top:0"><div class="container"><div class="sec-head"><div><h2>${esc(cfg.relatedTitle)}</h2></div><a class="btn btn-sm" href="${prefix}maf/${cfg.target}/index.html">${esc(cfg.relatedLink)}</a></div><div class="tiles3">${others.map((p) => `<a class="tile" href="${prefix}maf/${cfg.target}/${p.pageSlug}/index.html"><div class="ph has-img r-43"><img src="${prefix}assets/img/maf/${cfg.imgTarget}/${p.sku}/main.webp" alt="${esc(p.name)}" loading="lazy"><span class="ph-label">${esc(p.shortName)}</span></div><h3>${esc(p.name)}</h3><p>${esc(p.priceText)}</p></a>`).join('')}</div></div></section>
<section style="padding-top:0"><div class="container"><div class="formpanel"><h3>Рассчитать ${esc(product.name.toLowerCase())} под ваш объект</h3><p>Укажите количество, город поставки и требования — пришлём смету за 1 рабочий день.</p><form onsubmit="return submitLead(this)"><div class="row2"><div class="field"><label>Имя</label><input type="text" required></div><div class="field"><label>Телефон</label><input type="tel" required placeholder="+7"></div></div><div class="field"><label>Количество и требования</label><textarea rows="2" placeholder="Например: ${esc(product.name)}, 10 шт, RAL 7016"></textarea></div><button class="btn btn-primary btn-block" type="submit">Отправить заявку</button><p class="consent">Нажимая кнопку, вы соглашаетесь с политикой обработки персональных данных.</p></form><div class="form-result form-ok" style="display:none"><b>Заявка принята</b>Мы свяжемся с вами в течение рабочего дня.</div></div></div></section>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"${esc(product.name)}","description":"${esc(product.cardText)}","category":"Малые архитектурные формы / ${esc(cfg.label)}","brand":{"@type":"Brand","name":"СТАЛЬПРОМ"},"manufacturer":{"@type":"Organization","name":"СТАЛЬПРОМ"},${schemaOffer}}</script>
</main>
${footer(prefix)}`;
  return doc({
    title: `${product.name} — производство и поставка | СТАЛЬПРОМ`,
    description: `${product.name} от производителя для благоустройства. ${product.priceText}, окраска RAL, поставка по России.`,
    canonical: `https://stalprom.ru/maf/${cfg.target}/${product.pageSlug}/`,
    ogImage: `https://stalprom.ru/${rel}/main.webp`,
    cssPrefix: prefix,
    scriptPrefix: prefix,
    body,
  });
}

function updateSitemap(siteRoot, cfg, products) {
  const sitemapPath = join(siteRoot, 'sitemap.xml');
  const fallbackUrls = [
    ['/', '1.0'],
    ['/metallokonstrukcii/', '0.9'],
    ['/proizvodstvo/', '0.8'],
    ['/maf/', '0.9'],
    ['/ograzhdeniya/', '0.9'],
    [`/maf/${cfg.target}/`, '0.8'],
    ['/maf/kacheli/', '0.8'],
    ['/maf/kacheli/kacheli-siti/', '0.7'],
    ['/maf/kacheli/kacheli-bulvar/', '0.7'],
    ['/maf/kacheli/kacheli-miass-raund/', '0.6'],
    ['/maf/kacheli/kacheli-oazis/', '0.6'],
    ['/maf/kacheli/kacheli-oazis-tip-7/', '0.6'],
    ['/maf/kacheli/kacheli-tandem/', '0.6'],
    ['/maf/urny/', '0.8'],
    ['/maf/urny/oprokidyvayushchayasya/', '0.6'],
    ['/maf/urny/s-pepelnicej/', '0.6'],
    ['/maf/urny/antivandalnaya/', '0.6'],
    ['/maf/veloparkovki/', '0.8'],
    ['/maf/veloparkovki/u-obraznaya/', '0.6'],
    ['/maf/veloparkovki/volna/', '0.6'],
    ['/maf/veloparkovki/s-navesom/', '0.6'],
    ['/maf/parkovochnye-stolbiki/', '0.8'],
    ['/maf/parkovochnye-stolbiki/betoniruemyj/', '0.6'],
    ['/maf/parkovochnye-stolbiki/semnyj/', '0.6'],
    ['/maf/parkovochnye-stolbiki/so-svetootrazhatelem/', '0.6'],
    ['/maf/parkovochnye-stolbiki/s-cepyu/', '0.6'],
    ['/metallokonstrukcii/korziny-dlya-konditsionerov/', '0.8'],
    ['/metallokonstrukcii/pochtovye-yashchiki/', '0.8'],
    ['/metallokonstrukcii/konteynernye-ploshchadki/', '0.8'],
    ['/metallokonstrukcii/metalloizdeliya-na-zakaz/', '0.7'],
    ['/ograzhdeniya/gazonnye/', '0.7'],
    ['/ograzhdeniya/perila/', '0.6'],
    ['/zastrojshchikam/', '0.8'],
    ['/44-fz/', '0.6'],
    ['/projects/', '0.7'],
    ['/about/', '0.5'],
    ['/dostavka/', '0.5'],
    ['/contacts/', '0.6'],
  ];
  const existing = new Map();
  if (existsSync(sitemapPath)) {
    const current = readFileSync(sitemapPath, 'utf8');
    const re = /<url><loc>https:\/\/stalprom\.ru([^<]+)<\/loc><priority>([^<]+)<\/priority><\/url>/g;
    let m;
    while ((m = re.exec(current))) existing.set(m[1], m[2]);
  }
  if (!existing.size) for (const [u, pr] of fallbackUrls) existing.set(u, pr);

  for (const key of [...existing.keys()]) {
    if (key === `/maf/${cfg.target}/` || key.startsWith(`/maf/${cfg.target}/`)) existing.delete(key);
  }
  existing.set(`/maf/${cfg.target}/`, '0.8');
  for (const p of products) existing.set(`/maf/${cfg.target}/${p.pageSlug}/`, '0.6');

  const urls = [...existing.entries()];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, pr]) => `  <url><loc>https://stalprom.ru${u}</loc><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`;
  writeFileSync(sitemapPath, xml);
}

function normalizeProducts(products, propertiesBySku, manifests, cfg) {
  const used = new Map();
  return products.map((raw, idx) => {
    const sku = text(raw.sku || raw.bitrix_sku);
    const manifest = manifests.get(sku);
    const product = manifest?.product || raw;
    const baseSlug = slugify(product.slug || product.old_path || product.name, sku);
    const seen = used.get(baseSlug) || 0;
    used.set(baseSlug, seen + 1);
    const pageSlug = seen ? `${baseSlug}-${sku}` : baseSlug;
    const specs = (propertiesBySku.get(sku) || []).slice(0, 8).map((p) => [p.property_name, p.property_value]).filter(([, v]) => text(v));
    const material = specs.find(([k]) => /материал/i.test(k))?.[1] || 'сталь, дерево';
    const size = specs.find(([k]) => /длина|диаметр|габарит/i.test(k))?.[1] || 'под проект';
    let shortName = product.name;
    for (const pattern of cfg.stripNames || []) shortName = shortName.replace(pattern, '');
    shortName = shortName.trim() || product.name;
    return {
      sku,
      raw: product,
      manifest,
      pageSlug,
      name: product.name,
      shortName,
      priceText: priceRub(product.price || raw.price),
      cardText: cleanDescription(product, cfg.productType).slice(0, 170),
      badge: idx < 6 ? 'серия' : (String(product.name).includes('без спинки') ? 'без спинки' : 'модель'),
      cardSpecs: [['Материал', material], ['Размер', size], ['Артикул', sku]],
      specs,
    };
  });
}

function main() {
  const category = argValue('category', 'skameyki');
  const cfg = CATEGORY_CONFIG[category];
  if (!cfg) throw new Error(`Unknown category: ${category}`);

  const siteRoot = argValue('site-root', process.cwd());
  const sourceRoot = argValue('source-root', DEFAULT_SOURCE_ROOT);
  const generatedRoot = argValue('generated-root', DEFAULT_GENERATED_ROOT);
  const format = argValue('format', 'webp');
  const quality = Number(argValue('quality', '82'));
  const maxSide = Number(argValue('max-side', '2000'));

  const categorySource = join(sourceRoot, cfg.source);
  const generatedCategory = join(generatedRoot, cfg.source);
  const productsCsv = join(categorySource, 'products.csv');
  const propertiesCsv = join(categorySource, 'product_properties.csv');

  if (!existsSync(productsCsv)) throw new Error(`Missing products.csv: ${productsCsv}`);
  if (!existsSync(generatedCategory)) throw new Error(`Missing generated category: ${generatedCategory}`);

  const productsRaw = readCsv(productsCsv);
  const propertiesRaw = existsSync(propertiesCsv) ? readCsv(propertiesCsv) : [];
  const propertiesBySku = new Map();
  for (const p of propertiesRaw) {
    const sku = text(p.sku);
    if (!propertiesBySku.has(sku)) propertiesBySku.set(sku, []);
    propertiesBySku.get(sku).push(p);
  }

  const manifests = new Map();
  for (const dir of readdirSync(generatedCategory)) {
    if (!/^\d+$/.test(dir)) continue;
    const file = join(generatedCategory, dir, 'manifest.json');
    if (existsSync(file)) manifests.set(dir, JSON.parse(readFileSync(file, 'utf8')));
  }

  const products = normalizeProducts(
    productsRaw.filter((p) => manifests.has(text(p.sku || p.bitrix_sku))),
    propertiesBySku,
    manifests,
    cfg,
  );

  const imgRoot = join(siteRoot, 'assets/img/maf', cfg.imgTarget);
  const pageRoot = join(siteRoot, 'maf', cfg.target);
  mkdirSync(imgRoot, { recursive: true });
  mkdirSync(pageRoot, { recursive: true });

  const report = { createdAt: new Date().toISOString(), category, products: products.length, images: 0, skipped: [] };
  for (const product of products) {
    for (const [variant] of VARIANTS) {
      const result = chooseVariant(product.manifest, variant);
      if (!result) {
        report.skipped.push({ sku: product.sku, variant, reason: 'no-result' });
        continue;
      }
      const dest = join(imgRoot, product.sku, `${variant}.${format}`);
      convertImage(result.file, dest, format, quality, maxSide);
      report.images += 1;
    }
  }
  writeFileSync(join(imgRoot, 'publish-report.json'), JSON.stringify(report, null, 2));

  for (const entry of readdirSync(pageRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) rmSync(join(pageRoot, entry.name), { recursive: true, force: true });
  }
  writeFileSync(join(pageRoot, 'index.html'), renderIndex(cfg, products));
  for (const product of products) {
    const dir = join(pageRoot, product.pageSlug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderProduct(cfg, product, products));
  }
  updateSitemap(siteRoot, cfg, products);

  console.log(JSON.stringify({
    ok: true,
    category,
    products: products.length,
    images: report.images,
    skipped: report.skipped.length,
    pageRoot: relative(siteRoot, pageRoot),
    imageRoot: relative(siteRoot, imgRoot),
  }, null, 2));
}

main();
