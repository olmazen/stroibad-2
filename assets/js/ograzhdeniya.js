/* EGOE · Ограждения — hero (день/ночь + 3D-параллакс) + живой калькулятор.
   Логика калькулятора перенесена с лендинга FORRMA, генератор PDF убран:
   кнопки сметы ведут в общий лид-модал EGOE (openModal / submitLead из site.js). */
(function(){
'use strict';

/* ===================== HERO: день / ночь ===================== */
(function(){
  const hero = document.querySelector('.ogr-hero');
  const grp  = document.getElementById('ogrDayNight');
  if (hero && grp){
    grp.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      grp.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      hero.classList.toggle('is-night', b.dataset.mode === 'night');
    }));
  }
  /* Мягкий параллакс-наклон линии ограждения за курсором (десктоп) */
  const wrap  = document.querySelector('.ogr-fence3d');
  const line  = document.querySelector('.ogr-fline');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (wrap && line && !reduce && window.matchMedia('(pointer:fine)').matches){
    let raf = null;
    wrap.addEventListener('pointermove', e => {
      const r = wrap.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width  - .5;
      const ny = (e.clientY - r.top)  / r.height - .5;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        line.style.animationPlayState = 'paused';
        line.style.transform = `rotateY(${-30 + nx*22}deg) rotateX(${3 - ny*10}deg)`;
      });
    });
    wrap.addEventListener('pointerleave', () => {
      line.style.transform = '';
      line.style.animationPlayState = '';
    });
  }
})();

/* ===================== КАЛЬКУЛЯТОР ===================== */
const lenMetersInput  = document.getElementById('lenMetersInput');
if (!lenMetersInput) return; // калькулятора нет на странице — выходим

const lenSectionsHint = document.getElementById('lenSectionsHint');
const artInput  = document.getElementById('artInput');
const artVal    = document.getElementById('artVal');
const sectionsNote = document.getElementById('sectionsNote');
const fpSections = document.getElementById('fpSections');
const fpPosts    = document.getElementById('fpPosts');
const fpLength   = document.getElementById('fpLength');
const fpMode     = document.getElementById('fpMode');
const fenceGrid  = document.getElementById('fenceGrid');

const DECOR_DESCRIPTIONS = {
  forest_a: 'FOREST · A — олень-самец с оленёнком на лесной поляне. Идеален для участков с природным ландшафтом и деревянных домов.',
  forest_b: 'FOREST · B — олениха с оленёнком и птица среди берёз. Мягкий, лиричный сюжет для семейных участков.',
  forest_c: 'FOREST · C — медведица с медвежонком и сова на дубе. Эпичный сюжет для крупных территорий и архитектуры шале.',
  forest_d: 'FOREST · D — графический природный мотив: листья, ветви, флора. Универсальный, без животных — для современной архитектуры и дизайн-кода.',
};
const POST_INSTALL_DESC = {
  platform: 'На готовую площадку — самый быстрый вариант, если стяжка уже залита.',
  embed:    'На закладные — арматурные элементы заливаются заранее. Идеально для новых участков.',
  concrete: 'Бетонирование — рытьё ям и заливка под каждым столбом. Универсально для грунта.',
  consult:  'Обсудить с инженером — выезд, изучение грунта и геометрии. Для сложных рельефов.',
};

function readDecorType(){
  const btn = document.querySelector('#decorTypeGroup .selected');
  return btn ? btn.dataset.decor : 'forest_a';
}
function setupGroup(id){
  const g = document.getElementById(id);
  if (!g) return;
  g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    g.querySelectorAll('button').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
    updateCalc();
  }));
}
setupGroup('lightGroup'); setupGroup('heightGroup'); setupGroup('mountGroup'); setupGroup('postInstallGroup');

function fmt(n){ return Math.round(n).toLocaleString('ru-RU').replace(/,/g,' ') + ' ₽'; }

const _priceState = new WeakMap();
function animatePriceChange(el, newVal){
  if (!el) return;
  const oldVal = _priceState.get(el) ?? newVal;
  _priceState.set(el, newVal);
  if (el._priceRAF){ cancelAnimationFrame(el._priceRAF); el._priceRAF = null; } // никогда не оставляем осиротевший кадр
  if (Math.abs(newVal - oldVal) < 1){ el.textContent = fmt(newVal); el.classList.remove('counting'); return; }
  el.classList.add('counting');
  const start = performance.now(), dur = 450;
  function tick(now){
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(oldVal + (newVal - oldVal) * eased);
    if (t < 1){ el._priceRAF = requestAnimationFrame(tick); }
    else { el._priceRAF = null; setTimeout(() => el.classList.remove('counting'), 250); }
  }
  el._priceRAF = requestAnimationFrame(tick);
}

const PRICES = { panel: 54150, post: 18900, decor: 24840, light: 8650 };

const FOREST_VARIANT_SVG = {
  a: 'uploads/forest-a-viz.svg',
  b: 'uploads/PANEL_B_01.svg',
  c: 'uploads/PANEL_C_01.svg',
  d: 'uploads/PANEL_D_01.svg',
};
function forestSceneSvg(variant){
  const file = FOREST_VARIANT_SVG[variant] || FOREST_VARIANT_SVG.a;
  return `<image href="${file}" x="0" y="0" width="100" height="180" preserveAspectRatio="xMidYMid slice"/>`;
}
function tileSvg(type){
  const lath = '#0A0D10';
  const viewW = 100, viewH = 180;
  let content = '', preserve = 'none';
  if (type === 'blind' || type === 'trans'){
    const count = type === 'blind' ? 8 : 6;
    const margin = 8, available = 100 - margin*2, gap = (available - count*3)/(count-1);
    let laths = '';
    for (let i=0;i<count;i++){ const x = margin + i*(3+gap); laths += `<rect x="${x}" y="8" width="3" height="${viewH-12}" fill="${lath}" rx="1"/>`; }
    content = laths;
  } else {
    let decor = 'a';
    const t = readDecorType();
    if (t && t.startsWith('forest_')) decor = t.split('_')[1];
    content = forestSceneSvg(decor);
    preserve = 'xMidYMid slice';
  }
  const cap    = `<rect x="0" y="0" width="${viewW}" height="3" fill="#20262c" rx="1"/>`;
  const ground = `<rect x="0" y="${viewH-3}" width="${viewW}" height="3" fill="#0A0D10" rx="1"/>`;
  return `<svg viewBox="0 0 ${viewW} ${viewH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="${preserve}">${cap}${content}${ground}</svg>`;
}

function arrangeModules(sections, mainN){
  const arr = new Array(sections).fill('blind');
  const startMain = Math.floor((sections - mainN) / 2);
  for (let i=0;i<mainN;i++) arr[startMain + i] = 'main';
  return arr;
}

/* renderFence — диффинг тайлов (добавляем/удаляем поштучно) */
let currentTiles = [], vizRevealed = false, pendingInitialReveal = false;
function makeTile(type, mode){
  const el = document.createElement('div');
  el.className = 'fence-tile ' + (mode === 'off' ? 'glow-off' : 'glow-' + mode) + ' entering';
  el.dataset.type = type; el.dataset.mode = mode;
  el.innerHTML = `<div class="tile-inner">${tileSvg(type)}</div>`;
  return el;
}
function setTileMode(el, type, mode){
  const prevType = el.dataset.type, prevMode = el.dataset.mode, prevDecor = el.dataset.decor || '';
  let curDecor = type === 'main' ? (readDecorType() || '') : '';
  if (prevType === type && prevMode === mode && prevDecor === curDecor) return;
  if (prevMode !== mode){
    el.classList.remove('glow-off','glow-warm','glow-cold','glow-rgb');
    el.classList.add(mode === 'off' ? 'glow-off' : 'glow-' + mode);
    el.dataset.mode = mode;
  }
  if (prevType !== type || (type === 'main' && prevDecor !== curDecor)){
    el.querySelector('.tile-inner').innerHTML = tileSvg(type);
    el.dataset.type = type; el.dataset.decor = curDecor;
  }
}
function staggerInitialReveal(){
  currentTiles.forEach((t,i) => setTimeout(() => { if (t.el && t.el.parentNode) t.el.classList.add('in'); }, 200 + i*90));
  setTimeout(() => applyRowsVar(currentTiles.length), 200 + currentTiles.length*90 + 200);
}
function pickCols(n, stageW, stageH){
  if (n <= 6) return 6;
  const gap = 8, availH = stageH - 32;
  let best = { cols:6, score:-Infinity };
  for (let cols=6; cols<=14; cols++){
    const rows = Math.ceil(n/cols);
    const tileW = (stageW - gap*(cols-1))/cols, tileH = tileW*1.8;
    let scale = availH / (rows*tileH + (rows-1)*gap); if (scale>1) scale=1;
    const score = scale - rows*0.06 - (cols-6)*0.04;
    if (score > best.score) best = { cols, score };
  }
  return best.cols;
}
function applyRowsVar(n){
  if (!fenceGrid) return;
  const stage = fenceGrid.parentElement; if (!stage) return;
  const stageW = stage.clientWidth, stageH = stage.clientHeight;
  if (!stageW || !stageH){ requestAnimationFrame(() => applyRowsVar(n)); return; }
  const cols = pickCols(n, stageW, stageH), rows = Math.max(1, Math.ceil(n/cols)), gap = 8;
  const newCols = `repeat(${cols}, 1fr)`;
  if (fenceGrid.style.gridTemplateColumns !== newCols) fenceGrid.style.gridTemplateColumns = newCols;
  const tileW = (stageW - gap*(cols-1))/cols, tileH = tileW*1.8;
  let scale = (stageH-32) / (rows*tileH + (rows-1)*gap);
  if (scale>1) scale=1; if (scale<0.18) scale=0.18;
  fenceGrid.style.setProperty('--gs', scale.toFixed(3));
}
function renderFence(arr, mode){
  const n = arr.length, m = currentTiles.length;
  fenceGrid.querySelectorAll('.fence-tile.exiting').forEach(el => el.parentNode && el.parentNode.removeChild(el));
  if (n < m){
    const toRemove = currentTiles.splice(n, m-n);
    toRemove.reverse().forEach((t,idx) => setTimeout(() => { t.el.classList.remove('entering','in'); t.el.classList.add('exiting'); }, idx*40));
    setTimeout(() => toRemove.forEach(t => t.el.parentNode && t.el.parentNode.removeChild(t.el)), toRemove.length*40 + 750);
  }
  if (n > m){
    const startIdx = m;
    for (let i=m;i<n;i++){ const el = makeTile(arr[i], mode); fenceGrid.appendChild(el); currentTiles.push({ el, type:arr[i], mode }); }
    if (vizRevealed){
      requestAnimationFrame(() => requestAnimationFrame(() => {
        for (let i=startIdx;i<n;i++){ const idx=i-startIdx; setTimeout(() => { if (currentTiles[i] && currentTiles[i].el) currentTiles[i].el.classList.add('in'); }, idx*90); }
      }));
    } else { pendingInitialReveal = true; }
  }
  const limit = Math.min(n,m);
  for (let i=0;i<limit;i++){ setTileMode(currentTiles[i].el, arr[i], mode); currentTiles[i].type = arr[i]; currentTiles[i].mode = mode; }
  applyRowsVar(n);
  const vb = document.getElementById('vizBlock');
  if (vb) vb.dataset.light = mode;
}

function updateCalc(){
  let totalLen = parseFloat(lenMetersInput.value);
  if (isNaN(totalLen) || totalLen < 5) totalLen = 5;
  if (totalLen > 200) totalLen = 200;
  const fenceLen = totalLen;
  const sections = Math.max(0, Math.ceil(fenceLen / 2.5));
  const len = totalLen;
  const posts = sections + 1;

  const maxArt = sections;
  if (parseInt(artInput.value) > maxArt) artInput.value = maxArt;
  artInput.max = Math.min(6, maxArt);
  const decorCount = parseInt(artInput.value);

  artVal.innerHTML = decorCount + '<span class="unit">шт</span>';
  if (fpSections) fpSections.textContent = sections;
  if (fpPosts) fpPosts.textContent = posts;
  if (fpLength) fpLength.textContent = Math.round(len*10)/10;
  if (sectionsNote) sectionsNote.textContent = `${sections} секций · ${posts} столбов · ${len} м участка`;
  if (lenSectionsHint) lenSectionsHint.textContent = `${sections} секц.`;

  const hMul   = parseFloat(document.querySelector('#heightGroup .selected').dataset.h);
  const panelP = PRICES.panel * hMul, postP = PRICES.post, decorP = PRICES.decor, lightP = PRICES.light;

  const lightBtn = document.querySelector('#lightGroup .selected');
  const lightMode = lightBtn.dataset.mode;
  let lightSides = 0;
  if (lightMode !== 'off'){
    const sidesBtn = document.querySelector('#lightSidesGroup .selected');
    lightSides = sidesBtn ? parseInt(sidesBtn.dataset.sides) : 1;
  }
  const lightCount = sections * lightSides, lightTotal = lightCount * lightP;

  const mountPerM = parseFloat(document.querySelector('#mountGroup .selected').dataset.mount);
  const mountTotal = mountPerM > 0 ? mountPerM * len : 0;
  const mountIsConsult = mountPerM < 0;

  const mainN = Math.min(decorCount, sections);

  document.getElementById('qBlind').textContent = '× ' + sections;
  document.getElementById('vBlind').textContent = fmt(panelP * sections);
  document.getElementById('qTrans').textContent = '× ' + decorCount;
  document.getElementById('vTrans').textContent = fmt(decorP * decorCount);
  document.getElementById('qMain').textContent  = lightSides > 0 ? '× ' + lightCount : '× 0';
  document.getElementById('vMain').textContent  = fmt(lightTotal);
  document.getElementById('qPost').textContent  = '× ' + posts;
  document.getElementById('vPost').textContent  = fmt(postP * posts);
  document.getElementById('qLed').textContent   = lightSides > 0 ? 'одна сторона' : '—';
  document.getElementById('vLed').textContent   = lightSides > 0 ? 'включено' : '—';
  document.getElementById('qMount').textContent = mountIsConsult ? 'консультация' : (mountPerM > 0 ? len + ' м' : '—');
  document.getElementById('vMount').textContent = mountIsConsult ? 'согласуется' : (mountPerM > 0 ? fmt(mountTotal) : '—');

  const total = panelP*sections + postP*posts + decorP*decorCount + lightTotal + mountTotal;
  animatePriceChange(document.getElementById('totalPrice'), total);
  animatePriceChange(document.getElementById('vTotal'), total);

  renderFence(arrangeModules(sections, mainN), lightMode);

  if (fpMode){
    fpMode.className = 'viz-mode';
    if (lightMode === 'off'){ fpMode.innerHTML = '<span class="led-dot"></span>&nbsp;Подсветка выключена'; fpMode.classList.add('off'); }
    else {
      const map = { warm:'LED 2700K · тёплый', rgb:'RGB · умный дом' };
      fpMode.innerHTML = '<span class="led-dot"></span>&nbsp;' + (map[lightMode] || 'LED');
      fpMode.classList.add('on');
    }
  }
}

/* хинты по группам декора / установки */
const decorGroup = document.getElementById('decorTypeGroup'), decorHintEl = document.getElementById('decorHint');
if (decorGroup){
  decorGroup.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    decorGroup.querySelectorAll('button').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
    if (decorHintEl) decorHintEl.textContent = DECOR_DESCRIPTIONS[b.dataset.decor] || '';
    updateCalc();
  }));
}
const postInstallHintEl = document.getElementById('postInstallHint'), postInstallEl = document.getElementById('postInstallGroup');
if (postInstallEl){
  postInstallEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (postInstallHintEl) postInstallHintEl.textContent = POST_INSTALL_DESC[b.dataset.pi] || '';
  }));
}

lenMetersInput.addEventListener('input', updateCalc);
document.querySelectorAll('.num-step').forEach(btn => btn.addEventListener('click', () => {
  const delta = parseFloat(btn.dataset.delta) || 0;
  let cur = parseFloat(lenMetersInput.value) || 0;
  cur = Math.max(5, Math.min(200, cur + delta));
  lenMetersInput.value = Math.round(cur*2)/2;
  updateCalc();
}));
artInput.addEventListener('input', updateCalc);

/* появление визуализатора */
const vizIO = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting){
    entry.target.classList.add('revealed'); vizRevealed = true;
    if (pendingInitialReveal){ pendingInitialReveal = false; setTimeout(staggerInitialReveal, 250); }
    vizIO.unobserve(entry.target);
  }
}), { threshold:0.15, rootMargin:'0px 0px -40px 0px' });
const vb = document.getElementById('vizBlock');
if (vb){
  vizIO.observe(vb);
  setTimeout(() => { if (!vizRevealed){ vb.classList.add('revealed'); vizRevealed = true; if (pendingInitialReveal){ pendingInitialReveal=false; staggerInitialReveal(); } } }, 1500);
}
let _rto;
window.addEventListener('resize', () => { clearTimeout(_rto); _rto = setTimeout(() => applyRowsVar(currentTiles.length), 150); });

updateCalc();
})();
