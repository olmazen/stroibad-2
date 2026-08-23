import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');
const write = process.argv.includes('--write');
const rewriteOnly = process.argv.includes('--rewrite-only');
if (!write) throw new Error('Use --write to localize external runtime assets');

const fontQuery = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,400&family=JetBrains+Mono:wght@400;500&family=Oswald:wght@400;500;600;700&family=PT+Sans:wght@400;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;0,800;1,500;1,600;1,700&display=swap';
const browserHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' };

async function download(url, rel, headers = {}) {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}

let fontUrls = [];
if (!rewriteOnly) {
  const fontResponse = await fetch(fontQuery, { headers: browserHeaders });
  if (!fontResponse.ok) throw new Error(`Google Fonts CSS: HTTP ${fontResponse.status}`);
  let fontCss = await fontResponse.text();
  fontUrls = [...new Set([...fontCss.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((match) => match[1]))];
  for (const url of fontUrls) {
    const ext = path.extname(new URL(url).pathname) || '.woff2';
    const name = `${crypto.createHash('sha256').update(url).digest('hex').slice(0, 16)}${ext}`;
    await download(url, `assets/fonts/${name}`, browserHeaders);
    fontCss = fontCss.split(url).join(`../fonts/${name}`);
  }
  await fs.mkdir(path.join(root, 'assets/css'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/css/fonts.css'), `/* Локальная копия шрифтов; без соединения браузера с Google Fonts. */\n${fontCss}`);
}

const vendorFiles = [
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'assets/vendor/three/three.module.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js', 'assets/vendor/three/jsm/controls/OrbitControls.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js', 'assets/vendor/three/jsm/loaders/GLTFLoader.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js', 'assets/vendor/three/jsm/loaders/DRACOLoader.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineSegments2.js', 'assets/vendor/three/jsm/lines/LineSegments2.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineSegmentsGeometry.js', 'assets/vendor/three/jsm/lines/LineSegmentsGeometry.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineMaterial.js', 'assets/vendor/three/jsm/lines/LineMaterial.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js', 'assets/vendor/three/jsm/utils/BufferGeometryUtils.js'],
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/LICENSE', 'assets/vendor/three/LICENSE.txt'],
  ['https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.js', 'assets/vendor/three/draco/draco_decoder.js'],
  ['https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_wasm_wrapper.js', 'assets/vendor/three/draco/draco_wasm_wrapper.js'],
  ['https://www.gstatic.com/draco/versioned/decoders/1.5.7/draco_decoder.wasm', 'assets/vendor/three/draco/draco_decoder.wasm'],
  ['https://raw.githubusercontent.com/google/draco/1.5.7/LICENSE', 'assets/vendor/three/draco/LICENSE.txt'],
  ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'assets/vendor/pdf/html2canvas.min.js'],
  ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/LICENSE', 'assets/vendor/pdf/LICENSE-html2canvas.txt'],
  ['https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js', 'assets/vendor/pdf/jspdf.umd.min.js'],
  ['https://cdn.jsdelivr.net/npm/jspdf@4.2.1/LICENSE', 'assets/vendor/pdf/LICENSE-jspdf.txt'],
  ['https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.min.mjs', 'assets/vendor/pdf/pdf.min.js'],
  ['https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.worker.min.mjs', 'assets/vendor/pdf/pdf.worker.min.js'],
  ['https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/LICENSE', 'assets/vendor/pdf/LICENSE-pdfjs.txt']
];
const fontLicenseFiles = [
  ['https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/OFL.txt', 'assets/fonts/LICENSE-Cormorant-Garamond.txt'],
  ['https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt', 'assets/fonts/LICENSE-JetBrains-Mono.txt'],
  ['https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/OFL.txt', 'assets/fonts/LICENSE-Oswald.txt'],
  ['https://raw.githubusercontent.com/google/fonts/main/ofl/ptsans/OFL.txt', 'assets/fonts/LICENSE-PT-Sans.txt'],
  ['https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/OFL.txt', 'assets/fonts/LICENSE-Playfair-Display.txt']
];
if (!rewriteOnly) {
  for (const [url, rel] of [...vendorFiles, ...fontLicenseFiles]) await download(url, rel);
}

async function htmlFiles(dir = root) {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ['.git', '.private', 'dist', 'node_modules'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await htmlFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.html')) result.push(file);
  }
  return result;
}

let changedPages = 0;
for (const file of await htmlFiles()) {
  let html = await fs.readFile(file, 'utf8');
  const before = html;
  const pageDir = path.dirname(file);
  const href = (rel) => path.relative(pageDir, path.join(root, rel)).split(path.sep).join('/') || '.';

  const hadGoogleFonts = /fonts\.(?:googleapis|gstatic)\.com/.test(html);
  html = html
    .replace(/<link\s+rel=["']preconnect["']\s+href=["']https:\/\/fonts\.googleapis\.com["']\s*\/?>\s*/g, '')
    .replace(/<link\s+rel=["']preconnect["']\s+href=["']https:\/\/fonts\.gstatic\.com["'](?:\s+crossorigin)?\s*\/?>\s*/g, '')
    .replace(/<link\s+href=["']https:\/\/fonts\.googleapis\.com\/css2[^"']+["']\s+rel=["']stylesheet["']\s*\/?>\s*/g, '');
  if (hadGoogleFonts && !html.includes('assets/css/fonts.css')) {
    const localFontLink = `<link rel="stylesheet" href="${href('assets/css/fonts.css')}">`;
    if (/<link[^>]+assets\/css\/style\.css[^>]*>/.test(html)) {
      html = html.replace(/(<link[^>]+assets\/css\/style\.css[^>]*>)/, `${localFontLink}\n$1`);
    } else {
      html = html.replace(/<\/head>/i, `${localFontLink}\n</head>`);
    }
  }

  html = html
    .split('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js').join(href('assets/vendor/three/three.module.js'))
    .split('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/').join(`${href('assets/vendor/three/jsm')}/`);

  if (html !== before) {
    await fs.writeFile(file, html);
    changedPages += 1;
  }
}

console.log(JSON.stringify({
  rewriteOnly,
  fontFiles: fontUrls.length,
  fontLicenses: rewriteOnly ? 0 : fontLicenseFiles.length,
  vendorFiles: rewriteOnly ? 0 : vendorFiles.length,
  changedPages
}, null, 2));
