#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSiteShellData, renderSiteFooter, renderSiteHeader } from './site-shell.mjs';

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
    title: 'Скамейки уличные от производителя — каталог и цены | EGOE',
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
    title: 'Лежаки парковые от производителя — каталог и цены | EGOE',
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
    title: 'Павильоны, навесы и беседки от производителя | EGOE',
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
    title: 'Урны уличные от производителя — каталог и цены | EGOE',
    h1: 'Урны уличные',
    lead: 'Металлические уличные урны для парков, дворов ЖК, общественных пространств, набережных и коммерческих территорий.',
    metaDescription: 'Урны уличные от производителя: металлические модели, окраска RAL, комплектация под объект, поставка по России.',
    ogTitle: 'Урны уличные от производителя',
    listName: 'Модели уличных урн',
    defaultSpecs: [['Материал', 'сталь'], ['Тип товара', 'Урна уличная'], ['Поставка', 'по России']],
    stripNames: [/^Урна уличная\s*/i, /^Урна\s*/i],
  },
  konteynernye_ploshchadki_dlya_tbo: {
    source: 'konteynernye_ploshchadki_dlya_tbo',
    target: 'konteynernye-ploshchadki',
    imgTarget: 'konteynernye-ploshchadki',
    section: 'metallokonstrukcii',
    assetSection: 'metallokonstrukcii',
    sectionLabel: 'Металлоконструкции',
    sectionEyebrow: 'Металлоконструкции для благоустройства',
    label: 'Контейнерные площадки',
    singular: 'контейнерную площадку',
    productType: 'контейнерная площадка для ТКО',
    relatedTitle: 'Другие контейнерные площадки',
    relatedLink: 'Все контейнерные площадки',
    indexHeadline: 'Выберите контейнерную площадку',
    title: 'Контейнерные площадки для ТКО от производителя | EGOE',
    h1: 'Контейнерные площадки для ТКО',
    lead: 'Закрытые контейнерные шкафы, ограждения и площадки для сбора ТКО и КГМ: изготовление под объект, окраска RAL и поставка по России.',
    metaDescription: 'Контейнерные площадки для ТКО от производителя: закрытые шкафы, ограждения и модульные решения. Цены, характеристики, окраска RAL и поставка по России.',
    ogTitle: 'Контейнерные площадки для ТКО',
    listName: 'Модели контейнерных площадок для ТКО',
    materialsLabel: 'сталь',
    productionNote: 'Изготавливаем модель под объект: партия, цвет металла, тип заполнения, крепёж и график поставки согласуются под проект.',
    defaultSpecs: [['Материал', 'сталь'], ['Тип товара', 'Контейнерная площадка'], ['Поставка', 'по России']],
    stripNames: [/^Контейнерная площадка для ТБО\s*/i, /^Контейнерная площадка\s*/i, /^Контейнерный шкаф\s*/i, /^Ограждение для ТБО\s*/i],
  },
  velosipednye_parkovki: {
    source: 'velosipednye_parkovki',
    target: 'veloparkovki',
    imgTarget: 'veloparkovki',
    label: 'Велопарковки',
    singular: 'велопарковку',
    productType: 'велопарковка для благоустройства',
    relatedTitle: 'Другие модели велопарковок',
    relatedLink: 'Все велопарковки',
    indexHeadline: 'Выберите модель велопарковки',
    title: 'Велопарковки уличные от производителя — каталог и цены | EGOE',
    h1: 'Велопарковки уличные',
    lead: 'Уличные велопарковки и парковки для самокатов для дворов ЖК, школ, парков, офисов и общественных пространств.',
    metaDescription: 'Велопарковки уличные от производителя: модели из стали и нержавейки, парковки для самокатов, навесы, окраска RAL и поставка по России.',
    ogTitle: 'Велопарковки уличные от производителя',
    listName: 'Модели уличных велопарковок',
    defaultSpecs: [['Материал', 'сталь'], ['Тип товара', 'Велопарковка'], ['Поставка', 'по России']],
    stripNames: [/^Велопарковка\s*/i, /^Парковка для самокатов\s*/i],
  },
};

function section(cfg) {
  return cfg.section || 'maf';
}

function assetSection(cfg) {
  return cfg.assetSection || 'maf';
}

function categoryUrl(cfg) {
  return `/${section(cfg)}/${cfg.target}/`;
}

function categoryRelativeUrl(cfg) {
  return `${section(cfg)}/${cfg.target}`;
}

function sectionLabel(cfg) {
  return cfg.sectionLabel || 'МАФ';
}

function sectionEyebrow(cfg) {
  return cfg.sectionEyebrow || 'Малые архитектурные формы';
}

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
  return results.findLast((r) => r.selected) || null;
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
  return raw.replace(/^Материалы:\s*/i, '').replace(/\s+/g, ' ').trim();
}

function excerptDescription(value, max = 220) {
  if (value.length <= max) return value;
  const candidate = value.slice(0, max + 1);
  const sentence = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('! '), candidate.lastIndexOf('? '));
  if (sentence >= Math.floor(max * 0.55)) return candidate.slice(0, sentence + 1).trim();
  const word = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, word > 0 ? word : max).replace(/[,:;\-–—\s]+$/, '')}…`;
}

function doc({ title, description, canonical, ogImage, ogType = 'website', cssPrefix, body, scriptPrefix }) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="${ogType}">
<meta property="og:locale" content="ru_RU">
<meta property="og:site_name" content="EGOE">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<link rel="stylesheet" href="${cssPrefix}assets/css/fonts.css">
<link rel="stylesheet" href="${cssPrefix}assets/css/style.css?v=egoe55">
</head>
<body${canonical.includes('/maf/') ? ' class="maf-page"' : ''}>
${body}
<script src="${scriptPrefix}assets/js/site.js?v=gallery-2"></script>
<script src="${scriptPrefix}assets/js/leads.js"></script>
</body>
</html>
`;
}

function imageBlock(cfg, product, variant, label, classes = '', loading = 'lazy') {
  const variantClass = variant === 'white' ? ' contain' : '';
  if (!product.hasImages) {
    return `<div class="ph ${classes} r-43"><span class="ph-label">${esc(label)} · фото готовится</span></div>`;
  }
  const img = `assets/img/${assetSection(cfg)}/${cfg.imgTarget}/${product.sku}/${variant}.webp`;
  return `<div class="ph has-img${variantClass} ${classes} r-43"><img src="{{prefix}}${img}" alt="${esc(label)}" loading="${loading}"><span class="ph-label">${esc(label)}</span></div>`;
}

function card(cfg, product, prefix = '../../') {
  const visual = imageBlock(cfg, product, 'main', product.shortName).replaceAll('{{prefix}}', prefix);
  return `<a class="model-card reveal" href="${prefix}${categoryRelativeUrl(cfg)}/${product.pageSlug}/">
  <div style="position:relative"><span class="mc-badge">${esc(product.badge)}</span>${visual}</div>
  <div class="mc-b">
    <h3>${esc(product.name)}</h3>
    <div class="mc-sub">${esc(product.cardText)}</div>
    <ul class="mc-spec">${product.cardSpecs.map(([a, b]) => `<li><span>${esc(a)}</span><b>${esc(b)}</b></li>`).join('')}</ul>
    <div class="mc-foot"><div class="mc-price"><b>${esc(product.priceText)}</b><small>по комплектации и партии</small></div><span class="mc-go">Выбрать →</span></div>
  </div>
</a>`;
}

function renderIndex(cfg, products, shellData) {
  const prefix = '../../';
  const pageRel = `${section(cfg)}/${cfg.target}/index.html`;
  const items = products.map((p, i) => `{"@type":"ListItem","position":${i + 1},"name":"${esc(p.name)}","url":"https://www.egoe-life.ru${categoryUrl(cfg)}${p.pageSlug}/"}`).join(',');
  const hero = imageBlock(cfg, products[0], 'main', products[0].name, '', 'eager').replaceAll('{{prefix}}', prefix);
  const body = `${renderSiteHeader(shellData, pageRel)}
<main>
<div class="shero">
  <div class="shero-bg">${hero}</div>
  <span class="shero-corner">${esc(cfg.label)} · каталог</span>
  <div class="container"><div class="shero-inner">
    <nav class="crumbs"><a href="${prefix}">Главная</a> / <a href="${prefix}${section(cfg)}/">${esc(sectionLabel(cfg))}</a> / <span>${esc(cfg.label)}</span></nav>
    <div class="eyebrow">${esc(sectionEyebrow(cfg))}</div>
    <h1>${esc(cfg.h1)} <em>от производителя</em></h1>
    <p class="lead">${esc(cfg.lead)}</p>
    <div class="shero-meta"><span><b>${products.length}</b> моделей</span><span>${esc(cfg.materialsLabel || 'сталь + дерево')}</span><span>окраска <b>RAL</b></span><span>поставка по России</span></div>
  </div></div>
</div>
<section>
  <div class="container">
    <div class="reveal"><div class="dim"><span class="tick"></span>Модельный ряд</div></div>
    <div class="sec-head reveal" style="margin-top:24px"><div><h2>${esc(cfg.indexHeadline)}</h2></div><p class="lead-wide">Сравните модели, характеристики и цены. Цвет, материалы, крепление и комплектацию согласуем под ваш объект.</p></div>
    <div class="model-grid">${products.map((p) => card(cfg, p, prefix)).join('\n')}</div>
  </div>
</section>
<section class="dev" style="padding:72px 0"><div class="container"><div class="split">
  <div class="reveal"><div class="dim on-dark"><span class="tick"></span>Под объект</div><h2 style="margin:22px 0 16px;font-size:clamp(24px,3vw,36px)">Комплектуем территорию изделиями в едином стиле</h2><p style="color:#B5BAC0;font-size:16px;max-width:520px">Подбираем серию под дизайн-код территории: единый RAL, материалы, закладные, крепёж и поставка партиями под график благоустройства.</p><a class="btn btn-primary" style="margin-top:24px" href="${prefix}contacts/">Обсудить серию</a></div>
  <ul class="devlist reveal" style="--d:.1s"><li><span><b>${products.length} моделей.</b> Подбираем решение под двор, парк, ЖК или общественную территорию.</span></li><li><span><b>Единый RAL.</b> Металл окрашиваем в цвет проекта и соседних МАФ.</span></li><li><span><b>Проектная поставка.</b> Считаем партию, логистику, монтажные закладные и сроки.</span></li><li><span><b>Документы.</b> Работаем с НДС, готовим паспорта изделий и спецификации.</span></li></ul>
</div></div></section>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","name":"${esc(cfg.listName)}","itemListElement":[${items}]}</script>
</main>
${renderSiteFooter(shellData, pageRel)}`;
  return doc({
    title: cfg.title,
    description: cfg.metaDescription,
    canonical: `https://www.egoe-life.ru${categoryUrl(cfg)}`,
    ogImage: products.some((p) => p.hasImages)
      ? `https://www.egoe-life.ru/assets/img/${assetSection(cfg)}/${cfg.imgTarget}/${products.find((p) => p.hasImages).sku}/main.webp`
      : '',
    cssPrefix: prefix,
    scriptPrefix: prefix,
    body,
  });
}

function renderProduct(cfg, product, allProducts, shellData) {
  const prefix = '../../../';
  const pageRel = `${section(cfg)}/${cfg.target}/${product.pageSlug}/index.html`;
  const rel = `assets/img/${assetSection(cfg)}/${cfg.imgTarget}/${product.sku}`;
  const others = allProducts.filter((p) => p.sku !== product.sku).slice(0, 3);
  const specRows = product.specs.length ? product.specs : cfg.defaultSpecs;
  const description = cleanDescription(product.raw, cfg.productType);
  const schemaPrice = lowPrice(product.raw.price);
  const productImage = product.hasImages ? `https://www.egoe-life.ru/${rel}/white.webp` : '';
  const productSchema = {
    '@context': 'https://schema.org', '@type': 'Product', name: product.name,
    description, category: `${sectionLabel(cfg)} / ${cfg.label}`,
    brand: { '@type': 'Brand', name: 'EGOE' },
    manufacturer: { '@type': 'Organization', name: 'EGOE' },
  };
  if (productImage) productSchema.image = productImage;
  if (schemaPrice) productSchema.offers = {
    '@type': 'AggregateOffer', priceCurrency: 'RUB', lowPrice: String(schemaPrice),
    availability: 'https://schema.org/PreOrder', seller: { '@type': 'Organization', name: 'EGOE' },
  };
  const mainVisual = imageBlock(cfg, product, 'main', product.name, 'main', 'eager').replaceAll('{{prefix}}', prefix);
  const detailVisual = imageBlock(cfg, product, 'closeup', `${product.name} — деталь`).replaceAll('{{prefix}}', prefix);
  const whiteVisual = imageBlock(cfg, product, 'white', `${product.name} — белый фон`).replaceAll('{{prefix}}', prefix);
  const angleVisual = imageBlock(cfg, product, 'angle', `${product.name} на объекте`).replaceAll('{{prefix}}', prefix);
  const body = `${renderSiteHeader(shellData, pageRel)}
<main>
<div class="page-head"><div class="container">
  <nav class="crumbs"><a href="${prefix}">Главная</a> / <a href="${prefix}${section(cfg)}/">${esc(sectionLabel(cfg))}</a> / <a href="${prefix}${categoryRelativeUrl(cfg)}/">${esc(cfg.label)}</a> / <span>${esc(product.name)}</span></nav>
  <h1>${esc(product.name)}</h1>
  <p>${esc(excerptDescription(description))}</p>
</div></div>
<section><div class="container"><div class="prodpage">
  <div class="gallery">
    ${mainVisual}
    <div class="thumbs">
      ${detailVisual}
      ${whiteVisual}
      ${angleVisual}
    </div>
  </div>
  <div class="pp-info">
    <div class="pp-title">${esc(product.name)}</div>
    <div class="pp-art">Артикул ${esc(product.sku)} · ${esc(cfg.productType)}</div>
    <div class="pp-price"><span class="big">${esc(product.priceText)}</span><span class="note">точная цена — по комплектации и партии</span></div>
    <div class="opt-row"><div class="lbl">Цвет металла (RAL)</div><div class="ral"><span class="ralc on" onclick="pickOption(this)" data-ral="#383E42" style="background:#383E42" title="RAL 7016"></span><span class="ralc" onclick="pickOption(this)" data-ral="#0A0A0C" style="background:#0A0A0C" title="RAL 9005"></span><span class="ralc" onclick="pickOption(this)" data-ral="#45322E" style="background:#45322E" title="RAL 8017"></span><span class="ralc" onclick="pickOption(this)" data-ral="#114232" style="background:#114232" title="RAL 6005"></span></div></div>
    <div class="opt-row"><div class="lbl">Количество</div><div class="qty"><button onclick="qtyStep(this,-1)">−</button><input type="text" value="1" inputmode="numeric"><button onclick="qtyStep(this,1)">+</button></div></div>
    <div class="pp-actions"><a class="btn btn-primary" href="${prefix}contacts/">Запросить расчёт</a><a class="btn" href="tel:+79272295828">Позвонить</a></div>
    <div class="obj-note"><b>Заказ под объект</b><br>Подберём цвет RAL, древесину, крепление, логистику и серийную цену под проект благоустройства.</div>
  </div>
</div></div></section>
<section style="padding-top:0"><div class="container"><div class="split">
  <div><div class="sec-head"><div><h2>Характеристики</h2></div></div><table class="specs">${specRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>
  <div><div class="sec-head"><div><h2>Описание</h2></div></div><div class="prose"><p>${esc(description)}</p><p>${esc(cfg.productionNote || 'Изготавливаем модель под объект: партия, цвет металла, покрытие древесины, крепёж и график поставки согласуются под проект.')}</p></div></div>
</div></div></section>
<section style="padding-top:0"><div class="container"><div class="sec-head"><div><h2>${esc(cfg.relatedTitle)}</h2></div><a class="btn btn-sm" href="${prefix}${categoryRelativeUrl(cfg)}/">${esc(cfg.relatedLink)}</a></div><div class="tiles3">${others.map((p) => `<a class="tile" href="${prefix}${categoryRelativeUrl(cfg)}/${p.pageSlug}/">${imageBlock(cfg, p, 'main', p.shortName).replaceAll('{{prefix}}', prefix)}<h3>${esc(p.name)}</h3><p>${esc(p.priceText)}</p></a>`).join('')}</div></div></section>
<section style="padding-top:0"><div class="container"><div class="formpanel"><h3>Получить расчёт: ${esc(product.name)}</h3><p>Укажите количество, город поставки и требования — пришлём смету за 1 рабочий день.</p><form onsubmit="return window.EGOE_LEADS ? window.EGOE_LEADS.submitForm(this) : false"><div class="row2"><div class="field"><label>Имя</label><input type="text" required></div><div class="field"><label>Телефон</label><input type="tel" required placeholder="+7"></div></div><div class="field"><label>Количество и требования</label><textarea rows="2" placeholder="Например: ${esc(product.name)}, 10 шт, RAL 7016"></textarea></div><button class="btn btn-primary btn-block" type="submit">Отправить заявку</button><p class="consent">Нажимая кнопку, вы соглашаетесь с <a href="${prefix}privacy/">политикой обработки персональных данных</a>.</p></form><div class="form-result form-ok" style="display:none"><b>Заявка принята</b>Мы свяжемся с вами в течение рабочего дня.</div></div></div></section>
<script type="application/ld+json">${JSON.stringify(productSchema)}</script>
</main>
${renderSiteFooter(shellData, pageRel)}`;
  return doc({
    title: `${product.name} — производство и поставка | EGOE`,
    description: `${product.name} от производителя для благоустройства. ${product.priceText}, окраска RAL, поставка по России.`,
    canonical: `https://www.egoe-life.ru${categoryUrl(cfg)}${product.pageSlug}/`,
    ogImage: productImage,
    ogType: 'product',
    cssPrefix: prefix,
    scriptPrefix: prefix,
    body,
  });
}

function updateSitemap(siteRoot) {
  const script = join(siteRoot, 'tools', 'build-sitemap.mjs');
  const result = spawnSync(process.execPath, [script, '--write'], {
    cwd: siteRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`Sitemap generation failed:\n${result.stderr || result.stdout}`);
  }
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
      hasImages: cfg.publishImages && VARIANTS.every(([variant]) => chooseVariant(manifest || {}, variant)),
      pageSlug,
      name: product.name,
      shortName,
      priceText: priceRub(product.price || raw.price),
      cardText: excerptDescription(cleanDescription(product, cfg.productType), 220),
      badge: idx < 6 ? 'серия' : (String(product.name).includes('без спинки') ? 'без спинки' : 'модель'),
      cardSpecs: [['Материал', material], ['Размер', size], ['Артикул', sku]],
      specs,
    };
  });
}

async function main() {
  const category = argValue('category', 'skameyki');
  const categoryConfig = CATEGORY_CONFIG[category];
  if (!categoryConfig) throw new Error(`Unknown category: ${category}`);

  const siteRoot = resolve(argValue('site-root', process.cwd()));
  const shellData = await loadSiteShellData(siteRoot);
  const sourceRoot = argValue('source-root', DEFAULT_SOURCE_ROOT);
  const generatedRoot = argValue('generated-root', DEFAULT_GENERATED_ROOT);
  const format = argValue('format', 'webp');
  const quality = Number(argValue('quality', '82'));
  const maxSide = Number(argValue('max-side', '2000'));
  const imagesArg = argValue('images', 'auto');
  const publishImages = imagesArg === 'false' ? false : true;
  const cfg = { ...categoryConfig, publishImages };

  const categorySource = join(sourceRoot, cfg.source);
  const generatedCategory = join(generatedRoot, cfg.source);
  const productsCsv = join(categorySource, 'products.csv');
  const propertiesCsv = join(categorySource, 'product_properties.csv');

  if (!existsSync(productsCsv)) throw new Error(`Missing products.csv: ${productsCsv}`);
  if (publishImages && !existsSync(generatedCategory)) throw new Error(`Missing generated category: ${generatedCategory}`);

  const productsRaw = readCsv(productsCsv);
  const propertiesRaw = existsSync(propertiesCsv) ? readCsv(propertiesCsv) : [];
  const propertiesBySku = new Map();
  for (const p of propertiesRaw) {
    const sku = text(p.sku);
    if (!propertiesBySku.has(sku)) propertiesBySku.set(sku, []);
    propertiesBySku.get(sku).push(p);
  }

  const manifests = new Map();
  if (existsSync(generatedCategory)) {
    for (const dir of readdirSync(generatedCategory)) {
      if (!/^\d+$/.test(dir)) continue;
      const file = join(generatedCategory, dir, 'manifest.json');
      if (existsSync(file)) manifests.set(dir, JSON.parse(readFileSync(file, 'utf8')));
    }
  }

  const products = normalizeProducts(
    productsRaw,
    propertiesBySku,
    manifests,
    cfg,
  );

  const imgRoot = join(siteRoot, 'assets/img', assetSection(cfg), cfg.imgTarget);
  const pageRoot = join(siteRoot, section(cfg), cfg.target);
  mkdirSync(imgRoot, { recursive: true });
  mkdirSync(pageRoot, { recursive: true });

  const report = { createdAt: new Date().toISOString(), category, products: products.length, images: 0, skipped: [] };
  for (const product of products) {
    if (!publishImages) continue;
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
  writeFileSync(join(pageRoot, 'index.html'), renderIndex(cfg, products, shellData));
  for (const product of products) {
    const dir = join(pageRoot, product.pageSlug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderProduct(cfg, product, products, shellData));
  }
  updateSitemap(siteRoot);

  console.log(JSON.stringify({
    ok: true,
    category,
    products: products.length,
    images: report.images,
    productsWithCompleteImages: products.filter((product) => product.hasImages).length,
    skipped: report.skipped.length,
    pageRoot: relative(siteRoot, pageRoot),
    imageRoot: relative(siteRoot, imgRoot),
  }, null, 2));
}

await main();
