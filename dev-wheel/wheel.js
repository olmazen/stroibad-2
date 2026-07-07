/* Автономная конфигурируемая версия «колеса заказа» для песочницы настроек скролла.
   Извлечено из assets/js/site.js. window.buildFlowWheel(CFG) строит колесо в #flowWheel
   с движком скролла по CFG. НЕ трогает боевой site.js. */
window.buildFlowWheel = function (CFG) {
  CFG = CFG || {};
  var host = document.getElementById('flowWheel');
  if (!host) return;
  var items = Array.prototype.map.call(host.querySelectorAll('.fdial-list li'), function (li, i) {
    return { n: i + 1, t: li.dataset.t || li.textContent, d: li.dataset.d || '', k: li.dataset.k || '' };
  });
  var N = items.length;
  if (N < 2) return;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SP = 24;
  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  // ── настройки движка скролла (пресеты песочницы) ──
  var C_MODE = CFG.mode || 'spring';                 // 'spring' | 'lerp'
  var C_LERP = CFG.lerp != null ? CFG.lerp : 0.18;   // коэффициент сглаживания (lerp)
  var C_SPK = CFG.springK != null ? CFG.springK : 0.10;
  var C_SPD = CFG.springD != null ? CFG.springD : 0.76;
  var C_TRACK = CFG.trackVh != null ? CFG.trackVh : 88; // высота трека на шаг (vh) — больше = мягче/длиннее скролл
  var C_MAGNET = CFG.magnet !== false;               // варп маппинга к шагам (по умолч. вкл)
  var C_PAGESNAP = !!CFG.pageSnap;                   // программная доводка страницы (по умолч. ВЫКЛ — убирает рывок)
  var C_SNAPMS = CFG.snapMs != null ? CFG.snapMs : 200;

  function chips(a) { return '<div class="fw-chips">' + a.map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</div>'; }
  function mediaFor(k) {
    var cur = '<div class="fw-cur" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 3l14 8-6.5 1.5L16 19l-3 1.6-3.4-6.4L5 18z"/></svg></div>';
    if (k === 'choose') {
      var arrow = function (d) { return '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>'; };
      var card = function (c, cls, series, vibe, name, sub, price, imgs, alt) {
        return '<div class="fw-ch-card ' + cls + '" data-c="' + c + '">' +
          '<div class="fw-ch-head"><span class="fw-ch-badge">' + series + '</span><span class="fw-ch-vibe">' + vibe + '</span></div>' +
          '<div class="fw-ch-ph">' +
          imgs.map(function (src, i) { return '<img class="' + (i === 0 ? 'on' : '') + '" src="' + src + '" alt="' + alt + '" loading="eager">'; }).join('') +
          '<button class="fw-ch-arrow prev" type="button" aria-label="Предыдущее фото">' + arrow('M15 5l-7 7 7 7') + '</button>' +
          '<button class="fw-ch-arrow next" type="button" aria-label="Следующее фото">' + arrow('M9 5l7 7-7 7') + '</button>' +
          '<span class="fw-ch-dots">' + imgs.map(function (_, i) { return '<i class="' + (i === 0 ? 'on' : '') + '"></i>'; }).join('') + '</span>' +
          '</div>' +
          '<div class="fw-ch-info"><b>' + name + '</b><span>' + sub + '</span></div>' +
          '<div class="fw-ch-buy"><em>' + price + '</em><button class="fw-ch-btn" type="button"><span>+</span> В корзину</button></div>' +
          '</div>';
      };
      return '<div class="fw-choose">' +
        '<p class="fw-ch-lead">Каждое изделие — в двух линейках: <b class="std">Стандарт</b> (рабочая классика, доступно) и <b class="art">Art&nbsp;Déco</b> (авторский дизайн, премиум).</p>' +
        '<div class="fw-ch-cards">' +
        card('0', 'std', 'Стандарт', 'Рабочая классика', 'Скамейка «Колледж»', 'Сталь + брус хвойных пород · для дворов, парков и улиц', 'от 19 600 ₽',
          ['assets/img/maf/skamejki/9467/white.webp', 'assets/img/maf/skamejki/9467/main.webp', 'assets/img/maf/skamejki/9467/angle.webp'], 'Скамейка стальная — серия Стандарт') +
        card('1', 'art', 'Art Déco', 'Дизайн-линия', 'Скамейка A1-101', 'Авторские формы, термодерево и нержавеющая сталь · премиум', 'от 44 500 ₽',
          ['assets/img/artdeco/skamejki/a1-101/hero.webp?i12', 'assets/img/artdeco/skamejki/a1-101/facade1.webp?i12', 'assets/img/artdeco/skamejki/a1-101/life1.webp'], 'Скамейка дизайнерская — серия Art Déco') +
        '</div>' +
        '<button class="fw-ch-next" type="button"><span class="fw-ch-circle" data-cnt>2</span><span class="fw-ch-nx"><b>В корзине — перейти к заявке</b><i class="fw-ch-down"><svg viewBox="0 0 24 24"><path d="M12 4v14M6 12l6 6 6-6"/></svg></i></span></button>' +
        cur + '</div>';
    }
    if (k === 'quote') return '<div class="fw-quote fw-flow2">' +
      '<div class="fw-att-zone">' +
      '<div class="fw-cart">' +
        '<div class="fw-cart-h"><span class="fw-cart-ic"><svg viewBox="0 0 24 24"><path d="M4 5h2l2 11h9l2-8H7"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg></span><b>Ваша корзина</b><em>2 позиции</em></div>' +
        '<div class="fw-ci"><span class="fw-ci-ph"><img src="assets/img/artdeco/skamejki/a1-101/hero.webp?i12" alt="Скамейка A1-101"></span><span class="fw-ci-tx"><b>Скамейка A1-101 · Art&nbsp;Déco</b><i>8 шт · от 44 500 ₽</i></span></div>' +
        '<div class="fw-ci"><span class="fw-ci-ph"><img src="assets/img/maf/skamejki/9467/white.webp" alt="Скамейка Колледж"></span><span class="fw-ci-tx"><b>Скамейка «Колледж» · Стандарт</b><i>14 шт · от 19 600 ₽</i></span></div>' +
      '</div>' +
      '<div class="fw-qform">' +
        '<div class="fw-qrow"><div class="field"><input type="text" readonly tabindex="-1" data-df="name" placeholder="Ваше имя"></div>' +
        '<div class="field"><input type="tel" readonly tabindex="-1" data-df="tel" placeholder="Телефон"></div></div>' +
        '<span class="btn btn-primary fw-q-btn">Получить КП в PDF →</span>' +
      '</div>' +
      '<div class="fw-genline"><b data-pdf>Собираем ваше КП по корзине…</b><span class="fw-pdf-bar"><u></u></span></div>' +
      cur + '</div>' +
      '<div class="fw-win fw-pdfwin"><div class="fw-win-bar"><i></i><i></i><i></i><b>КП-EGOE-214.pdf</b><span data-pgind>1 / 3</span></div>' +
      '<div class="fw-win-body"><div class="fw-pages">' +
      '<div class="fw-pg on"><div class="pdf-logo"><s></s>EGOE</div>' +
        '<div class="pdf-cv"><em>Коммерческое предложение № 214</em><b>Ваш список<br>из корзины</b><span>2 позиции · 22 единицы</span></div>' +
        '<div class="pdf-foot">EGOE · завод металлоконструкций · egoe-life.ru</div></div>' +
      '<div class="fw-pg"><b class="pdf-h">Ведомость изделий</b><div class="pdf-t">' +
        '<div class="pdf-tr th"><span>Изделие</span><span>RAL</span><span>Кол-во</span><span>Цена, от</span></div>' +
        '<div class="pdf-tr"><span>Скамейка A1-101 · Art&nbsp;Déco</span><span>7016</span><span>8</span><span>44 500 ₽</span></div>' +
        '<div class="pdf-tr"><span>Скамейка «Колледж» · Стандарт</span><span>9005</span><span>14</span><span>19 600 ₽</span></div>' +
        '</div><div class="pdf-sum"><span>ориентировочно, до финального КП</span><b>≈ 630 400 ₽</b></div></div>' +
      '<div class="fw-pg"><div class="pdf-h3"><b>Скамейка A1-101</b><i>Art Déco</i></div>' +
        '<div class="pdf-media"><img src="assets/img/artdeco/skamejki/a1-101/hero.webp?i12" alt=""><span class="pdf-draw"><img src="assets/img/artdeco/skamejki/a1-101/drawing-white.svg" alt=""></span></div>' +
        '<div class="pdf-spec"><span>Серия</span><b>Art Déco · коллекция A</b></div><div class="pdf-spec"><span>Материал</span><b>сталь · термодерево</b></div><div class="pdf-spec"><span>Окраска</span><b>любой RAL</b></div></div>' +
      '</div><div class="fw-pgdots"><i class="on"></i><i></i><i></i></div></div></div></div>' +
      '<button class="fw-own" type="button" onclick="openModal()">Оставить свою заявку →</button>';
    if (k === 'contract') return '<div class="fw-flow2">' +
      '<div class="fw-att-zone"><div class="fw-checklist">' +
      '<div class="fw-ck"><i></i>Работа по 44-ФЗ и 223-ФЗ</div>' +
      '<div class="fw-ck"><i></i>НДС 20% включён</div>' +
      '<div class="fw-ck"><i></i>Спецификация и КМД в приложении</div>' +
      '<div class="fw-ck"><i></i>Гарантия 24 месяца</div>' +
      '</div></div>' +
      '<div class="fw-win fw-docwin"><div class="fw-win-bar"><i></i><i></i><i></i><b>договор-214.pdf</b><span>пакет для тендера</span></div>' +
      '<div class="fw-win-body"><div class="fw-ct">' +
      '<b class="ct-h">Договор поставки № 214</b><span class="ct-sub">ООО «EGOE» · с НДС 20%</span>' +
      '<div class="ct-par"><u style="width:96%"></u><u style="width:88%"></u><u style="width:64%"></u></div>' +
      '<div class="ct-par"><u style="width:92%"></u><u style="width:97%"></u><u style="width:41%"></u></div>' +
      '<div class="ct-par"><u style="width:85%"></u><u style="width:72%"></u></div>' +
      '<div class="ct-sign"><div class="ct-s"><em>Поставщик · EGOE</em><svg viewBox="0 0 130 36"><path d="M8 26 C 20 6, 30 32, 44 18 S 64 8, 74 22 S 102 28, 122 10"/></svg></div>' +
      '<span class="fw-stamp"><b>EGOE</b>завод · Балаково</span></div>' +
      '</div></div></div></div>';
    if (k === 'draw') return '<div class="fw-bp fw-bp-stack folded">' +
      '<img class="fw-bp-under" src="assets/img/artdeco/lezhaki/i1-3451/drawing-white.svg" alt="" aria-hidden="true">' +
      '<span class="fw-bp-tag">EGOE · КМД</span>' +
      '<img class="fw-bp-main" src="assets/img/artdeco/lezhaki/a1-2661/drawing-white.svg" alt="Чертёж изделия — КМД-документация"></div>';
    if (k === 'prod') return '<div class="fw-stagechips"><span>Резка</span><span>Гибка</span><span>Сварка</span><span>Окраска RAL</span></div>' +
      '<div class="fw-ph fw-kb"><img src="assets/img/artdeco/lezhaki/i1-3651/facade2.webp?i10" alt="Сталь изделия крупным планом — производство EGOE"><span>сталь · порошковая окраска RAL · свой цех</span></div>';
    if (k === 'ship') return '<div class="fw-logi">' +
      '<div class="fw-lg-status"><b data-lgst>Собираем партию…</b></div>' +
      '<div class="fw-lg-track"><u class="lg-line"></u><u class="lg-fill"></u>' +
      '<span class="lg-node" style="left:0%"><i></i><b>Завод</b></span>' +
      '<span class="lg-node" style="left:33.3%"><i></i><b>Партия</b></span>' +
      '<span class="lg-node" style="left:66.6%"><i></i><b>В пути</b></span>' +
      '<span class="lg-node" style="left:100%"><i></i><b>Объект</b></span>' +
      '<div class="fw-truck"><svg viewBox="0 0 48 26"><rect x="1" y="4" width="29" height="14" rx="1.5"/><path d="M30 8h9.5l6.5 6v4H30z"/><circle cx="11" cy="21" r="4"/><circle cx="38" cy="21" r="4"/></svg></div>' +
      '</div></div>' +
      '<div class="fw-ph fw-shipph"><img src="assets/img/metallokonstrukcii/konteynernye-ploshchadki/13992/main.webp" alt="Изделие доставлено и смонтировано на объекте"><span>доставлено и смонтировано · двор ЖК</span></div>';
    return '';
  }

  function winShow(w, on) {
    if (!w) return;
    if (on) { w.style.opacity = '1'; w.style.transform = 'none'; }
    else { w.style.opacity = ''; w.style.transform = ''; }
  }
  var track = document.createElement('div');
  track.className = 'fw-track';
  track.style.height = (N * C_TRACK + 16) + 'vh';
  track.innerHTML =
    '<div class="fw-sticky">' +
      '<div class="fw-sheets" aria-hidden="true">' +
        '<img class="fw-sh s1" src="assets/img/artdeco/lezhaki/a1-4651/drawing-white.svg" alt="">' +
        '<img class="fw-sh s2" src="assets/img/artdeco/lezhaki/i1-3651/drawing-white.svg" alt="">' +
        '<img class="fw-sh s3" src="assets/img/artdeco/lezhaki/i1-3561/drawing-white.svg" alt="">' +
      '</div>' +
      '<div class="fw-ghost" aria-hidden="true">01</div>' +
      '<svg class="fw-arc" aria-hidden="true"><circle class="fw-ring2"/><circle class="fw-ring"/><g class="fw-ticks"></g></svg>' +
      '<div class="fw-marker" aria-hidden="true"></div>' +
      '<div class="fw-cards"></div>' +
      '<div class="fw-head"></div>' +
      '<div class="fw-body"></div>' +
    '</div>';
  host.appendChild(track);

  var headSrc = host.querySelector('.fw-head-src');
  if (headSrc) track.querySelector('.fw-head').appendChild(headSrc);

  // панель шага = ОПИСАНИЕ + доп-медиа (заголовок едет на колесе)
  var body = track.querySelector('.fw-body');
  body.innerHTML = items.map(function (s, i) {
    return '<article class="fw-step' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">' +
      '<p>' + s.d + '</p><div class="fw-media">' + mediaFor(s.k) + '</div></article>';
  }).join('');
  host.classList.add('built');
  // плашка «перейти к заявке» из шага «Выбор изделий» — аккуратно доводит на шаг 2
  var chNextBtn = track.querySelector('.fw-ch-next');
  if (chNextBtn) chNextBtn.addEventListener('click', function () { scrollToStep(1); });

  var sticky = track.querySelector('.fw-sticky');
  var svg = track.querySelector('.fw-arc');
  var ring = track.querySelector('.fw-ring');
  var ring2 = track.querySelector('.fw-ring2');
  var ticksG = track.querySelector('.fw-ticks');
  var cardsBox = track.querySelector('.fw-cards');
  var marker = track.querySelector('.fw-marker');
  var ghost = track.querySelector('.fw-ghost');
  var steps = track.querySelectorAll('.fw-step');

  // карточки на колесе: номер + заголовок шага
  var cards = items.map(function (s, i) {
    var el = document.createElement('div');
    el.className = 'fw-card';
    el.innerHTML = '<b>' + pad2(s.n) + ' / ' + pad2(N) + '</b><span>' + s.t + '</span>';
    el.addEventListener('click', function () { scrollToStep(i); });
    cardsBox.appendChild(el);
    return el;
  });

  var W = 0, H = 0, R = 0, CX = 0, CY = 0, BASE = 0, CARD_R = 0, EDGE = 0, mobile = false;
  var theta = 0, targetTheta = 0, vel = 0, active = 0, raf = null;
  var rad = function (a) { return a * Math.PI / 180; };
  // мягкий магнит: лёгкое притяжение к ближайшей категории, БЕЗ жёсткого плато (аккуратно, плавно)
  function magnet(pf) {
    if (!C_MAGNET) return pf;                       // линейный маппинг (без притяжения)
    var i = Math.round(pf), f = pf - i;            // -0.5..0.5
    return i + f * (0.9 + 0.1 * Math.min(1, Math.abs(f) * 2));
  }
  var tickEls = [], tickDefs = [];

  function layout() {
    W = innerWidth; H = innerHeight;
    mobile = W < 900;
    if (mobile) {
      var crestGap = Math.min(210, Math.max(150, Math.round(H * 0.22)));
      var crest = H - crestGap;                  // верхняя точка нижнего колеса
      R = Math.max(Math.round(W * 0.8), 360);
      CX = Math.round(W / 2); CY = crest + R;
      BASE = -90; CARD_R = R + 46;
      marker.className = 'fw-marker down';
      marker.style.left = CX + 'px'; marker.style.top = (crest - 24) + 'px';
      // карточка стоит на 46px выше crest и сама ~60px высотой → низ контента держим выше её верха
      sticky.style.setProperty('--fwbot', (H - crest + 122) + 'px');
    } else {
      EDGE = Math.round(Math.max(150, Math.min(0.15 * W, 225)));
      R = Math.round(Math.max(H * 0.78, 540));
      CX = EDGE - R; CY = Math.round(H / 2);
      BASE = 0; CARD_R = R + 28;
      marker.className = 'fw-marker';
      marker.style.left = (EDGE + 6) + 'px'; marker.style.top = CY + 'px';
      sticky.style.setProperty('--fwleft', (EDGE + 330) + 'px');
      sticky.style.setProperty('--fwbot', '90px');
    }
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    ring.setAttribute('cx', CX); ring.setAttribute('cy', CY); ring.setAttribute('r', R);
    ring2.setAttribute('cx', CX); ring2.setAttribute('cy', CY); ring2.setAttribute('r', Math.max(R - 54, 80));
    // риски дуги — создаём как элементы (обновляются пофреймово: у указателя чуть удлиняются и подсвечиваются)
    tickEls = []; tickDefs = []; ticksG.innerHTML = '';
    for (var b = -34; b <= (N - 1) * SP + 34; b += 3) {
      var mj = b >= -0.01 && b <= (N - 1) * SP + 0.01 && Math.abs(((b % SP) + SP) % SP) < 0.01;
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      if (mj) ln.setAttribute('class', 'mj');
      ticksG.appendChild(ln);
      tickEls.push(ln); tickDefs.push({ b: b, mj: mj });
    }
    apply();
  }
  function drawTicks() {
    for (var k = 0; k < tickEls.length; k++) {
      var d = tickDefs[k], off = d.b + theta, A = BASE + off;      // theta «вшита» — риски едут с колесом
      var prox = Math.max(0, 1 - Math.abs(off) / 15);              // 1 у указателя → 0 за 15°
      var grow = prox * prox;
      var len = (d.mj ? 22 : 10) + grow * (d.mj ? 18 : 14);        // у указателя длиннее
      var r2 = R - 4, r1 = r2 - len, ca = Math.cos(rad(A)), sa = Math.sin(rad(A));
      var el = tickEls[k];
      el.setAttribute('x1', (CX + r1 * ca).toFixed(1)); el.setAttribute('y1', (CY + r1 * sa).toFixed(1));
      el.setAttribute('x2', (CX + r2 * ca).toFixed(1)); el.setAttribute('y2', (CY + r2 * sa).toFixed(1));
      el.style.opacity = ((d.mj ? 0.5 : 0.26) + grow * 0.5).toFixed(2);
      el.style.strokeWidth = ((d.mj ? 1.8 : 1.1) + grow * 1.7).toFixed(2);
      if (prox > 0.5) el.classList.add('near'); else el.classList.remove('near');
    }
  }

  function apply() {
    for (var i = 0; i < N; i++) {
      var bi = i * SP + theta;                 // угол от паза
      var A = BASE + bi;
      var x = CX + CARD_R * Math.cos(rad(A));
      var y = CY + CARD_R * Math.sin(rad(A));
      var tilt = bi * (mobile ? 0.9 : 0.45);   // блок наклоняется, уезжая с колесом
      var t = Math.abs(bi);
      var el = cards[i];
      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) ' +
        (mobile ? 'translate(-50%,-100%)' : 'translate(22px,-50%)') + ' rotate(' + tilt.toFixed(2) + 'deg)';
      el.style.opacity = Math.max(0, 1 - Math.max(0, t - 5) / (mobile ? 30 : 42)).toFixed(3);
      el.style.filter = (!reduced && t > 8) ? 'blur(' + Math.min((t - 8) / 9, 4.5).toFixed(2) + 'px)' : 'none';
      el.classList.toggle('on', t < SP / 2);
    }
    drawTicks();
    sticky.style.setProperty('--th', theta.toFixed(2) + 'deg');
  }
  // Мягкая недодемпфированная пружина: во время быстрого скролла theta отстаёт, на остановке
  // плавно догоняет с лёгким перелётом (~119%, ~0.9с) — аккуратно, без топорности.
  var SPRING_K = C_SPK, SPRING_D = C_SPD;
  function frame() {
    raf = null;
    if (reduced) { theta = targetTheta; vel = 0; apply(); return; }
    var disp = targetTheta - theta;
    if (C_MODE === 'lerp') {
      // сглаживание без перелёта: theta плавно догоняет цель (нет дёрганья)
      theta += disp * C_LERP;
      apply();
      if (Math.abs(disp) < 0.02) { theta = targetTheta; }
      else raf = requestAnimationFrame(frame);
      return;
    }
    // пружина (недодемпфированная)
    vel = (vel + disp * SPRING_K) * SPRING_D;
    theta += vel;
    apply();
    if (Math.abs(disp) < 0.006 && Math.abs(vel) < 0.006) { theta = targetTheta; vel = 0; }
    else raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  /* ── демо-сцены шагов: печать, курсор, PDF, штамп ── */
  function makeScene(root, kind) {
    var timers = [], running = false;
    function t(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function every(fn, ms) { timers.push(setInterval(fn, ms)); }
    function typeVal(inp, str, cps, done) {
      var i = 0;
      var iv = setInterval(function () {
        inp.value = str.slice(0, ++i);
        if (i >= str.length) { clearInterval(iv); if (done) done(); }
      }, cps);
      timers.push(iv);
    }
    function curTo(cur, el, ms, dx, dy) {
      var r = el.getBoundingClientRect(), p = cur.offsetParent.getBoundingClientRect();
      cur.style.transitionDuration = ms + 'ms';
      cur.style.left = (r.left - p.left + r.width * (dx == null ? 0.5 : dx)) + 'px';
      cur.style.top = (r.top - p.top + r.height * (dy == null ? 0.6 : dy)) + 'px';
    }
    var api = { start: function () {}, stop: function () {} };

    if (kind === 'choose') {
      var chCards = root.querySelectorAll('.fw-ch-card');
      var chNext = root.querySelector('.fw-ch-next');
      var chCnt = root.querySelector('[data-cnt]');
      var ccur = root.querySelector('.fw-cur');
      // карусель фото каждой карточки — работает и от стрелок вживую, и из демо
      var idxMap = [];
      chCards.forEach(function (cardEl, ci) {
        idxMap[ci] = 0;
        var imgs = cardEl.querySelectorAll('.fw-ch-ph img'), dots = cardEl.querySelectorAll('.fw-ch-dots i');
        function show(i) { var n = imgs.length; i = (i % n + n) % n; idxMap[ci] = i; imgs.forEach(function (im, k) { im.classList.toggle('on', k === i); }); dots.forEach(function (d, k) { d.classList.toggle('on', k === i); }); }
        cardEl.__show = show;
        var pv = cardEl.querySelector('.fw-ch-arrow.prev'), nx = cardEl.querySelector('.fw-ch-arrow.next');
        if (pv) pv.addEventListener('click', function (e) { e.stopPropagation(); show(idxMap[ci] - 1); });
        if (nx) nx.addEventListener('click', function (e) { e.stopPropagation(); show(idxMap[ci] + 1); });
      });
      function btnReset(btn) { btn.classList.remove('done'); btn.innerHTML = '<span>+</span> В корзину'; }
      function btnDone(btn) { btn.classList.add('done'); btn.innerHTML = 'В корзине'; }
      function resetChoose() {
        chCards.forEach(function (c) { c.classList.remove('added'); btnReset(c.querySelector('.fw-ch-btn')); c.__show(0); });
        if (chNext) chNext.classList.remove('show');
        if (chCnt) chCnt.textContent = '0';
        ccur.classList.remove('show', 'press');
      }
      var CARD_MS = 4200;
      api.start = function () {
        running = true;
        (function loop() {
          if (!running) return;
          resetChoose();
          ccur.classList.add('show');
          var added = 0;
          chCards.forEach(function (cardEl, ci) {
            var nx = cardEl.querySelector('.fw-ch-arrow.next'), btn = cardEl.querySelector('.fw-ch-btn');
            var base = 600 + ci * CARD_MS;
            // курсор бьёт по стрелке «вперёд» и листает фотокарточки (2 клика: фото 2 и 3)
            [0, 1].forEach(function (_, kk) {
              var at0 = base + kk * 920;
              t(function () { curTo(ccur, nx, 520, 0.5, 0.5); }, at0);
              t(function () { ccur.classList.add('press'); }, at0 + 560);
              t(function () { ccur.classList.remove('press'); cardEl.__show(idxMap[ci] + 1); }, at0 + 700);
            });
            // курсор на кнопку → в корзину
            t(function () { curTo(ccur, btn, 500, 0.5, 0.5); }, base + 2200);
            t(function () { ccur.classList.add('press'); }, base + 2680);
            t(function () { ccur.classList.remove('press'); cardEl.classList.add('added'); btnDone(btn); added++; if (chCnt) chCnt.textContent = String(added); }, base + 2840);
          });
          var end = 600 + chCards.length * CARD_MS;
          // обе в корзине → появляется кликабельная плашка «перейти к заявке»
          t(function () { ccur.classList.remove('show'); if (chNext) chNext.classList.add('show'); }, end + 250);
          t(loop, end + 3800);
        })();
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; resetChoose(); };
    }

    if (kind === 'quote') {
      var qflow = root.querySelector('.fw-quote');
      var nameI = root.querySelector('[data-df="name"]');
      var telI = root.querySelector('[data-df="tel"]');
      var qBtn = root.querySelector('.fw-q-btn');
      var gen = root.querySelector('.fw-genline');
      var genTx = root.querySelector('[data-pdf]');
      var win = root.querySelector('.fw-pdfwin');
      var pgs = root.querySelectorAll('.fw-pg');
      var dots = root.querySelectorAll('.fw-pgdots i');
      var pgInd = root.querySelector('[data-pgind]');
      var cur = root.querySelector('.fw-quote .fw-cur');
      function showPg(n) {
        pgs.forEach(function (p, i) { p.classList.toggle('on', i === n); });
        dots.forEach(function (d, i) { d.classList.toggle('on', i === n); });
        if (pgInd) pgInd.textContent = (n + 1) + ' / ' + pgs.length;
      }
      function reset() {
        nameI.value = ''; telI.value = '';
        nameI.classList.remove('focus'); telI.classList.remove('focus'); qBtn.classList.remove('press');
        qflow.classList.remove('sent', 'opened'); gen.classList.remove('go', 'ok');
        if (genTx) genTx.textContent = 'Собираем ваше КП по корзине…';
        winShow(win, false); showPg(0); cur.classList.remove('show', 'press');
      }
      api.start = function () {
        running = true;
        (function loop() {
          if (!running) return;
          reset();
          cur.classList.add('show'); curTo(cur, nameI, 10, 0.2, 0.7);
          t(function () { nameI.classList.add('focus'); typeVal(nameI, 'Алексей', 85); }, 650);
          t(function () { nameI.classList.remove('focus'); telI.classList.add('focus'); curTo(cur, telI, 500, 0.25, 0.7); }, 1700);
          t(function () { typeVal(telI, '+7 912 000-00-00', 55); }, 2300);
          t(function () { telI.classList.remove('focus'); curTo(cur, qBtn, 650, 0.5, 0.55); }, 3550);
          t(function () { qBtn.classList.add('press'); cur.classList.add('press'); }, 4300);
          t(function () { qBtn.classList.remove('press'); cur.classList.remove('press', 'show'); qflow.classList.add('sent'); gen.classList.add('go'); }, 4580);
          t(function () { gen.classList.add('ok'); if (genTx) genTx.textContent = 'КП готово ✓ · отправили на почту'; }, 5950);
          t(function () { qflow.classList.add('opened'); winShow(win, true); }, 6300);
          t(function () { showPg(1); }, 8500);
          t(function () { showPg(2); }, 10700);
          t(loop, 13400);
        })();
      };
      api.stop = function () {
        running = false; timers.forEach(clearTimeout); timers = [];
        nameI.value = 'Алексей'; telI.value = '+7 912 000-00-00';
        nameI.classList.remove('focus'); telI.classList.remove('focus'); qBtn.classList.remove('press');
        qflow.classList.add('sent', 'opened'); gen.classList.add('go', 'ok');
        if (genTx) genTx.textContent = 'КП готово ✓';
        winShow(win, true); showPg(0); cur.classList.remove('show', 'press');
      };
    }

    if (kind === 'contract') {
      var pars = root.querySelectorAll('.ct-par');
      var cks = root.querySelectorAll('.fw-ck');
      var sign = root.querySelector('.ct-s');
      var stamp = root.querySelector('.fw-stamp');
      var page = root.querySelector('.fw-ct');
      var cflow = root.querySelector('.fw-flow2');
      var cwin = root.querySelector('.fw-win');
      api.start = function () {
        running = true;
        cflow.classList.add('opened'); winShow(cwin, true);
        (function loop() {
          if (!running) return;
          pars.forEach(function (p) { p.classList.remove('in'); });
          cks.forEach(function (c) { c.classList.remove('in'); });
          sign.classList.remove('draw'); stamp.classList.remove('slam'); page.classList.remove('shake');
          pars.forEach(function (p, i) { t(function () { p.classList.add('in'); }, 420 + i * 620); });
          cks.forEach(function (c, i) { t(function () { c.classList.add('in'); }, 560 + i * 620); });
          t(function () { sign.classList.add('draw'); }, 420 + pars.length * 620 + 300);
          t(function () { stamp.classList.add('slam'); page.classList.add('shake'); }, 420 + pars.length * 620 + 1350);
          t(loop, 420 + pars.length * 620 + 6300);
        })();
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; cflow.classList.add('opened'); winShow(cwin, true); pars.forEach(function (p) { p.classList.add('in'); }); cks.forEach(function (c) { c.classList.add('in'); }); sign.classList.add('draw'); stamp.classList.add('slam'); page.classList.remove('shake'); };
    }

    if (kind === 'draw') {
      var bp = root.querySelector('.fw-bp-stack');
      api.start = function () {
        running = true;
        (function loop() {
          if (!running) return;
          bp.classList.add('folded');
          t(function () { bp.classList.remove('folded'); }, 500);
          t(loop, 5200);
        })();
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; bp.classList.remove('folded'); };
    }

    if (kind === 'prod') {
      var pchips = root.querySelectorAll('.fw-stagechips span');
      var ph = root.querySelector('.fw-ph');
      api.start = function () {
        running = true;
        ph.classList.add('play');
        var i = -1;
        every(function () {
          i = (i + 1) % pchips.length;
          pchips.forEach(function (c, j) { c.classList.toggle('on', j === i); c.classList.toggle('done', j < i); });
        }, 1100);
        pchips.forEach(function (c, j) { c.classList.toggle('on', j === 0); });
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; ph.classList.remove('play'); pchips.forEach(function (c) { c.classList.remove('on', 'done'); }); };
    }

    if (kind === 'ship') {
      var logi = root.querySelector('.fw-logi');
      var truck = root.querySelector('.fw-truck');
      var fill = root.querySelector('.lg-fill');
      var nodes = root.querySelectorAll('.lg-node');
      var lgst = root.querySelector('[data-lgst]');
      var ST = ['Собираем партию…', 'Партия собрана — грузим', 'В пути по России', 'Доставлено на объект ✓'];
      function stage(n) {
        truck.style.left = (n * 33.333) + '%';
        fill.style.width = (n * 33.333) + '%';
        nodes.forEach(function (nd, i) { nd.classList.toggle('on', i <= n); });
        if (lgst) { lgst.textContent = ST[n]; lgst.classList.toggle('ok', n === 3); }
        truck.classList.toggle('go', n > 0 && n < 3);
      }
      api.start = function () {
        running = true; logi.classList.add('play');
        (function loop() {
          if (!running) return;
          stage(0);
          t(function () { stage(1); }, 1300);
          t(function () { stage(2); }, 2700);
          t(function () { stage(3); }, 4100);
          t(loop, 7600);
        })();
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; logi.classList.remove('play'); stage(3); truck.classList.remove('go'); };
    }

    return api;
  }
  var sceneOf = {};
  steps.forEach(function (s, i) { var k = items[i].k; if (k) sceneOf[i] = makeScene(s, k); });
  var playingScene = -1;
  function updateScene() {
    var want = sticky.classList.contains('settle') ? active : -1;
    if (want === playingScene) return;
    if (playingScene >= 0 && sceneOf[playingScene]) sceneOf[playingScene].stop();
    playingScene = want;
    if (want >= 0 && sceneOf[want] && !reduced) sceneOf[want].start();
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    steps.forEach(function (s) { s.classList.toggle('on', +s.dataset.i === i); });
    if (ghost) ghost.textContent = pad2(i + 1);
  }
  var snapT = null, snapping = false;
  function onScroll() {
    var r = track.getBoundingClientRect();
    var total = track.offsetHeight - H;
    var p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
    var pf = p * (N - 1);
    var mf = magnet(pf);                              // магнит к ближайшей категории
    var idx = Math.max(0, Math.min(N - 1, Math.round(pf)));
    targetTheta = -mf * SP;
    setActive(idx);
    // паз: главная встала на место → показываем доп; в движении — прячем
    sticky.classList.toggle('settle', Math.abs(mf - Math.round(mf)) < 0.32);
    updateScene();
    kick();
    // страничная доводка — ТОЛЬКО если включена в пресете и НЕ на крайних шагах (чтобы концы всегда пролистывались дальше)
    if (C_PAGESNAP && !reduced && total > 0 && r.top <= 1 && r.bottom >= H && idx > 0 && idx < N - 1) scheduleSnap(idx, total);
  }
  var snapRAF = null;
  function scheduleSnap(idx, total) {
    if (snapping) return;
    if (snapT) clearTimeout(snapT);
    snapT = setTimeout(function () {                    // доводим только когда скролл РЕАЛЬНО замер
      var top0 = track.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop);
      var want = Math.round(top0 + (idx / (N - 1)) * total);
      var start = window.scrollY || 0, dist = want - start;
      if (Math.abs(dist) < 2) return;
      // собственная плавная eased-прокрутка (мягче и аккуратнее нативного smooth), длительность по расстоянию
      snapping = true;
      var t0 = null, dur = Math.min(680, 300 + Math.abs(dist) * 1.1);
      if (snapRAF) cancelAnimationFrame(snapRAF);
      function step(ts) {
        if (t0 == null) t0 = ts;
        var q = Math.min(1, (ts - t0) / dur);
        var e = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;   // easeInOutCubic — плавно
        window.scrollTo(0, Math.round(start + dist * e));
        if (q < 1) snapRAF = requestAnimationFrame(step);
        else { snapping = false; snapRAF = null; }
      }
      snapRAF = requestAnimationFrame(step);
    }, C_SNAPMS);
  }
  function scrollToStep(i) {
    var top = track.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop);
    var total = track.offsetHeight - H;
    window.scrollTo({ top: Math.round(top + (i / (N - 1)) * total) + 2, behavior: reduced ? 'auto' : 'smooth' });
  }
  window.__fwSet = function (p) { // отладочный хук 0..1
    var pf = p * (N - 1); var mf = magnet(pf); var idx = Math.max(0, Math.min(N - 1, Math.round(pf)));
    targetTheta = -mf * SP; theta = targetTheta; vel = 0;
    setActive(idx); sticky.classList.toggle('settle', Math.abs(mf - Math.round(mf)) < 0.32); updateScene(); apply();
  };

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', layout);
  layout(); onScroll();
};
