/* EGOE · Ограждения — hero (скроллинг времени суток) + слоёный стенд + калькулятор.
   Логика калькулятора перенесена с лендинга FORRMA, генератор PDF убран:
   кнопки сметы ведут в общий лид-модал EGOE (openModal / submitLead из site.js). */
(function(){
'use strict';

/* ===================== HERO: скроллинг времени суток ===================== */
(function(){
  const tl = document.getElementById('ogrTl');
  if (!tl) return;
  const hero   = document.querySelector('.ogr-hero');
  const imgs   = [...tl.querySelectorAll('.ogr-tl-img')];
  const range  = document.getElementById('ogrTlRange');
  const timeEl = document.getElementById('ogrTlTime');
  const phaseEl= document.getElementById('ogrTlPhase');
  const playBtn= document.getElementById('ogrTlPlay');
  const STEPS = [
    {t:'05:00',p:'Рассвет',      tod:'night'},
    {t:'08:00',p:'Восход',       tod:'dusk'},
    {t:'11:00',p:'День',         tod:'day'},
    {t:'14:00',p:'День',         tod:'day'},
    {t:'19:00',p:'Закат',        tod:'dusk'},
    {t:'21:00',p:'Подсветка',    tod:'dusk'},
    {t:'23:00',p:'Ночь',         tod:'night'},
    {t:'01:00',p:'Ночь',         tod:'night'},
    {t:'03:00',p:'Глубокая ночь',tod:'night'},
  ];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  imgs.forEach(im => { const pre = new Image(); pre.src = im.getAttribute('src'); }); // предзагрузка кадров суток — без пустых вспышек при кросс-фейде
  let cur = 2, timer = null;
  function set(i){
    cur = (i + STEPS.length) % STEPS.length;
    imgs.forEach((im,k) => im.classList.toggle('is-active', k === cur));
    const s = STEPS[cur];
    if (timeEl) timeEl.textContent = s.t;
    if (phaseEl) phaseEl.textContent = s.p;
    if (hero) hero.dataset.tod = s.tod;
    if (range){ range.value = cur; range.style.setProperty('--fill', (cur/(STEPS.length-1)*100) + '%'); }
  }
  function stop(){ if (timer){ clearInterval(timer); timer = null; } if (playBtn) playBtn.classList.remove('playing'); }
  function play(){ if (timer) return; if (playBtn) playBtn.classList.add('playing'); timer = setInterval(() => set(cur+1), 2400); }
  if (range) range.addEventListener('input', () => { stop(); set(parseInt(range.value)); });
  if (playBtn) playBtn.addEventListener('click', () => { timer ? stop() : play(); });
  set(2);
  if (!reduce){
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting){ play(); io.disconnect(); } }), {threshold:0.35});
    io.observe(tl);
  }
})();

/* ===================== КОНСТРУКЦИЯ: слоёный стенд ===================== */
(function(){
  const stage  = document.getElementById('stage');
  const layers = document.querySelectorAll('#techLayers .layer');
  if (!stage || !layers.length) return;
  const images   = stage.querySelectorAll('.stage-img');
  const resetBtn = document.getElementById('stageReset');
  const labelNum = document.getElementById('stageLabelNum');
  const labelTxt = document.getElementById('stageLabelText');
  let activeLayer = 0;
  const NAMES = {};
  layers.forEach(c => { NAMES[parseInt(c.dataset.layer)] = (c.querySelector('.title')||{}).textContent?.trim() || ''; });
  function showImage(n){ images.forEach(im => im.classList.toggle('is-active', parseInt(im.dataset.layer) === n)); }
  function renderLabel(n){ if (!labelNum || !labelTxt || n === 0) return; labelNum.textContent = String(n).padStart(2,'0'); labelTxt.textContent = NAMES[n] || ''; }
  function setLayer(n){
    if (n === activeLayer) n = 0;
    activeLayer = n;
    stage.dataset.active = n === 0 ? '' : String(n);
    showImage(n);
    layers.forEach(c => { const on = parseInt(c.dataset.layer) === n; c.classList.toggle('is-active', on); c.setAttribute('aria-expanded', String(on)); });
    if (n !== 0) renderLabel(n);
  }
  layers.forEach(c => {
    c.addEventListener('click', () => setLayer(parseInt(c.dataset.layer)));
    c.addEventListener('mouseenter', () => { if (activeLayer !== 0) return; const n = parseInt(c.dataset.layer); stage.dataset.active = String(n); renderLabel(n); showImage(n); });
    c.addEventListener('mouseleave', () => { if (activeLayer !== 0) return; stage.dataset.active = ''; showImage(0); });
  });
  if (resetBtn) resetBtn.addEventListener('click', () => setLayer(0));

  /* Соединительные линии от плашек к деталям на фото (десктоп) */
  const wrap = document.getElementById('tech2');
  const svg  = document.getElementById('tech2Links');
  if (wrap && svg){
    const linkPath = svg.querySelector('.tech2-link');
    const node = svg.querySelector('.tech2-node');
    const plates = [...wrap.querySelectorAll('.layer')];
    const ANCH = { 1:[0.50,0.44], 2:[0.60,0.80], 3:[0.30,0.56], 4:[0.85,0.24] }; // якоря деталей в кадре (доли)
    const desktop = () => window.matchMedia('(min-width:901px)').matches;
    function draw(p){
      if (!desktop()) return;
      const n = parseInt(p.dataset.layer);
      const wr = wrap.getBoundingClientRect(), pr = p.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      const fromRight = p.dataset.side === 'left';           // левые плашки тянут линию от правого края
      const px = (fromRight ? pr.right : pr.left) - wr.left;
      const py = pr.top + pr.height/2 - wr.top;
      const a = ANCH[n] || [0.5,0.5];
      const tx = sr.left + sr.width*a[0] - wr.left;
      const ty = sr.top + sr.height*a[1] - wr.top;
      const mx = (px + tx) / 2;
      linkPath.setAttribute('d', `M ${px} ${py} C ${mx} ${py}, ${mx} ${ty}, ${tx} ${ty}`);
      node.setAttribute('cx', tx); node.setAttribute('cy', ty);
      const len = linkPath.getTotalLength();
      linkPath.style.transition = 'none';
      linkPath.style.strokeDasharray = len; linkPath.style.strokeDashoffset = len;
      void linkPath.getBoundingClientRect();
      linkPath.style.transition = 'stroke-dashoffset .55s cubic-bezier(.4,0,.2,1)';
      linkPath.style.strokeDashoffset = '0';
      svg.classList.add('on');
    }
    const hide = () => svg.classList.remove('on');
    plates.forEach(p => {
      p.addEventListener('mouseenter', () => draw(p));
      p.addEventListener('mouseleave', hide);
      p.addEventListener('focus', () => draw(p));
      p.addEventListener('blur', hide);
    });
    let rt; window.addEventListener('resize', () => { hide(); clearTimeout(rt); });
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


/* ── перетаскивание плашки времени по hero (десктоп) ── */
(function(){
  var panel = document.querySelector('.ogr-tl-panel');
  var handle = panel && panel.querySelector('.ogr-tl-panel-h');
  var hero = document.querySelector('.ogr-hero--bg');
  if(!panel || !handle || !hero) return;
  var tx=0, ty=0, sx=0, sy=0, ox=0, oy=0, dragging=false;
  function mobile(){ return window.matchMedia('(max-width:960px)').matches; }
  function down(e){
    if(mobile()) return;
    if(e.target.closest('.ogr-tl-range,.ogr-tl-play')) return; // не мешаем ползунку/кнопке
    dragging=true; panel.classList.add('is-dragging');
    sx=e.clientX; sy=e.clientY; ox=tx; oy=ty;
    try{ panel.setPointerCapture(e.pointerId); }catch(_){}
    e.preventDefault();
  }
  function move(e){
    if(!dragging) return;
    var nx=ox+(e.clientX-sx), ny=oy+(e.clientY-sy);
    var hr=hero.getBoundingClientRect(), pr=panel.getBoundingClientRect();
    var baseL=pr.left-tx, baseT=pr.top-ty; // позиция без transform
    var minX=hr.left+10-baseL, maxX=hr.right-10-(baseL+pr.width);
    var minY=hr.top+10-baseT, maxY=hr.bottom-10-(baseT+pr.height);
    if(maxX<minX) maxX=minX; if(maxY<minY) maxY=minY;
    nx=Math.max(minX,Math.min(maxX,nx)); ny=Math.max(minY,Math.min(maxY,ny));
    tx=nx; ty=ny; panel.style.transform='translate('+nx.toFixed(0)+'px,'+ny.toFixed(0)+'px)';
    e.preventDefault();
  }
  function up(){ if(!dragging) return; dragging=false; panel.classList.remove('is-dragging'); }
  handle.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  // при переходе на мобилку — сбросить смещение
  window.addEventListener('resize', function(){ if(mobile() && (tx||ty)){ tx=ty=0; panel.style.transform=''; } });
})();
