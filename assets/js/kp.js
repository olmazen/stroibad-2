/* ============================================================
   EGOE · рендер коммерческого предложения (/kp/)
   Один красивый КП. Читает корзину (localStorage sp_cart_v1)
   + шапку (sp_kp_head_v1) + каталог (assets/catalog.json).
   PDF = Chrome window.print → «Сохранить как PDF».
   ============================================================ */
(function () {
  'use strict';

  var CART_KEY = 'sp_cart_v1';
  var HEAD_KEY = 'sp_kp_head_v1';
  var VAT = 0.20;

  /* Контакты изготовителя (для футера) */
  var CO = {
    brand: 'EGOE', maker: 'ООО «Фабрика «САМШИТ»',
    tel: '8 (8453) 65-57-77', email: 'zakaz@egoe-life.ru',
    place: 'Производство: г. Балаково · отгрузка по всей России',
  };

  var P = new URLSearchParams(location.search);
  var ledgerOnly = P.get('ledger') === '1';
  var auto = P.get('auto') === '1';
  var preview = P.get('preview') === '1';   // мини-превью в корзине (обложка+ведомость, без панели, некликабельно)
  if (preview) { ledgerOnly = true; auto = false; if (document.body) document.body.classList.add('kp-preview-mode'); }
  if (P.get('embed') === '1' && document.body) document.body.classList.add('kp-embed'); // внутри шторки корзины: свой тулбар не нужен
  // потоковый режим: документ «печатается» блок за блоком (только при первой генерации состава)
  var stream = P.get('stream') === '1' && !preview
    && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------------- утилиты ---------------- */
  function readJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var NBSP = ' ';
  function round2(n) { return Math.round(n * 100) / 100; }
  function money(n) {
    var s = (Math.round(n * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return s.replace(/\s/g, NBSP) + NBSP + '₽';
  }
  function moneyInt(n) { return Math.round(n).toLocaleString('ru-RU').replace(/\s/g, NBSP) + NBSP + '₽'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function parseDate(s) {
    if (!s) return new Date();
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);   // локальная дата — без UTC-сдвига
    var d = new Date(s); return isNaN(d) ? new Date() : d;
  }
  function fmtRu(d) { return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  /* ---------------- бизнес-логика позиции ---------------- */
  function unit(row) { return row.price > 0 ? row.price : (row.priceFrom > 0 ? row.priceFrom : 0); }
  function priced(row) { return unit(row) > 0; }
  function isFirm(row) { return row.price > 0; }          // подтверждённая цена (иначе — справочная «от»)
  function specVal(cat, re) {
    if (!cat || !cat.specs) return null;
    for (var i = 0; i < cat.specs.length; i++) if (re.test(cat.specs[i][0].toLowerCase())) return cat.specs[i][1];
    return null;
  }
  function dims(cat) {
    var L = specVal(cat, /длина|габарит/), W = specVal(cat, /ширина/), H = specVal(cat, /высота|высотой/), Wt = specVal(cat, /вес|масса/);
    return { L: L, W: W, H: H, Wt: Wt, any: !!(L || W || H || Wt) };
  }

  /* ---------------- загрузка ---------------- */
  var doc = document.getElementById('kp');
  var cart = readJSON(CART_KEY, []);
  var head = readJSON(HEAD_KEY, {});

  fetch('../assets/catalog.json?v=kp4').then(function (r) { return r.json(); }).then(function (catalog) {
    var bySku = {}; catalog.forEach(function (x) { bySku[x.sku] = x; });
    var rows = cart.map(function (it) { return Object.assign({}, it, { cat: bySku[it.id] || null }); });
    build(rows);
  }).catch(function (e) {
    doc.innerHTML = '<div class="sheet"><p>Не удалось загрузить каталог. ' + esc(e.message) + '</p></div>';
    finish();
  });

  /* ---------------- сборка ---------------- */
  function build(rows) {
    if (!rows.length) {
      doc.innerHTML = '<div class="sheet"><h2 class="kp-h">Список пуст</h2>' +
        '<p>Добавьте изделия в корзину, затем сформируйте КП.</p>' +
        '<p><a href="../maf/index.html">← В каталог</a></p></div>';
      finish(); return;
    }
    var d = fmtRu(parseDate(head.date));
    var num = head.number || autoNumber();
    doc.innerHTML = buildKp(rows, num, d);
    if (stream) {
      prepStream();
      window.scrollTo(0, 0);
      postStream({ built: true });                 // сообщаем шторке: макет готов — можно показывать и запускать сборку
      setTimeout(runStreamOnce, 1400);             // фолбэк (прямое открытие вкладки без шторки)
    }
    fillStamp(num);
    injectDrawings(rows).then(finish);   // дождаться вставки чертежей ДО __kpReady/печати
  }
  var streamStarted = false;
  function runStreamOnce() { if (streamStarted) return; streamStarted = true; runStream(); }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    if (e.data && e.data.kpGo) runStreamOnce();     // шторка показала документ — начинаем плавную сборку
  });

  /* =============== плавная сборка документа («таймлайн дизайнера») =============== */
  var streamUnits = [], streamTimers = [], typingEls = [];
  function stAdd(el, role) { if (!el) return; el.classList.add('stx'); streamUnits.push({ el: el, role: role }); }
  function prepStream() {
    // курируем порядок сборки по разделам — крупными смысловыми блоками, не «каждый чих»
    var sheets = [].slice.call(doc.querySelectorAll('.sheet'));
    var pn = sheets.filter(function (s) { return s.classList.contains('kp-product'); }).length, pi = 0;
    sheets.forEach(function (sheet, si) {
      var kind = sheet.classList.contains('kp-cover') ? 'cover'
        : sheet.classList.contains('kp-ledger') ? 'ledger'
        : sheet.classList.contains('kp-product') ? 'product' : 'terms';
      if (kind === 'product') pi += 1;
      sheet.classList.add('stx', 'stx-sheet');
      streamUnits.push({ el: sheet, role: 'sheet', kind: kind, pi: pi, pn: pn, si: si, n: sheets.length });
      var q = function (s) { return sheet.querySelector(s); };
      if (kind === 'cover') {
        stAdd(q('.cover-top'), 'fade');
        stAdd(q('.cover-photo'), 'photo');
        stAdd(q('.cover-title'), 'type');
        stAdd(q('.cover-meta'), 'fade');
      } else if (kind === 'ledger') {
        stAdd(q('.kp-h'), 'type');
        stAdd(q('thead tr'), 'fade');
        [].slice.call(sheet.querySelectorAll('tbody tr')).forEach(function (tr) { stAdd(tr, 'row'); });
        stAdd(q('.kp-totals'), 'fade');
        stAdd(q('.kp-note'), 'fade');
      } else if (kind === 'product') {
        stAdd(q('.prod-top'), 'fade');
        stAdd(q('.prod-head'), 'type');
        stAdd(q('.prod-visual'), 'photo');
        var data = q('.prod-data');
        if (data) { stAdd(data.querySelector('.prod-desc'), 'fade'); stAdd(data.querySelector('.spec-list'), 'fade'); stAdd(data.querySelector('.ral-row'), 'fade'); stAdd(data.querySelector('.price-plate'), 'fade'); }
      } else {
        stAdd(q('.kp-h'), 'type');
        [].slice.call(sheet.querySelectorAll('.term')).forEach(function (t) { stAdd(t, 'fade'); });
        stAdd(q('.kp-valid'), 'fade');
        stAdd(q('.kp-trust'), 'fade');
        stAdd(q('.kp-contacts'), 'fade');
      }
    });
  }
  function postStream(msg) { try { parent.postMessage({ kpStream: msg }, location.origin); } catch (e) {} }

  /* печать текста по буквам с сохранением разметки (<br>, <span>) и мигающей кареткой */
  function typeMarkup(el, dur, done) {
    typingEls.push({ el: el, html: el.innerHTML });
    var nodes = [], total = 0, walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), node;
    while ((node = walker.nextNode())) { nodes.push({ n: node, full: node.nodeValue }); total += node.nodeValue.length; node.nodeValue = ''; }
    if (!total) { if (done) done(); return; }
    el.classList.add('st-caret');
    var per = Math.max(20, Math.min(52, dur / total));
    var ni = 0, ci = 0;
    (function tick() {
      if (ni >= nodes.length) { el.classList.remove('st-caret'); if (done) done(); return; }
      var cur = nodes[ni]; ci++; cur.n.nodeValue = cur.full.slice(0, ci);
      if (ci >= cur.full.length) { ni++; ci = 0; }
      streamTimers.push(setTimeout(tick, per));
    })();
  }

  /* мягкая прокрутка к активному блоку: держим его верх ≈ на 40% высоты, без рывков и без ухода в пустоту */
  var scrollRAF = null;
  function smoothScrollTo(y) {
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    y = Math.max(0, y);
    var start = window.scrollY, dist = y - start, t0 = null, dur = 520;
    if (Math.abs(dist) < 4) return;
    function step(ts) {
      if (t0 == null) t0 = ts; var p = Math.min(1, (ts - t0) / dur);
      var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      window.scrollTo(0, Math.round(start + dist * e));
      if (p < 1) scrollRAF = requestAnimationFrame(step);
    }
    scrollRAF = requestAnimationFrame(step);
  }
  function bringIntoView(el) {
    var r = el.getBoundingClientRect(), vh = window.innerHeight, want = vh * 0.40;
    if (r.top > want + 44 || r.top < 44) smoothScrollTo(window.scrollY + (r.top - want));
  }

  /* каждый крупный блок: серый каркас → контент (заголовки печатаются, фото проявляется);
     мелочь просто мягко возникает. Общая длительность держится в бюджете (не «супер долго»). */
  function runStream() {
    if (!streamUnits.length) { postStream({ done: true }); return; }
    document.body.classList.add('kp-streaming');
    // оценим «номинальную» длительность и подгоним коэффициент под бюджет ~9–13с
    var nominal = 0;
    streamUnits.forEach(function (u) {
      if (u.role === 'sheet') nominal += 300;
      else if (u.role === 'row') nominal += 150;
      else if (u.role === 'type') { var c = (u.el.textContent || '').length; nominal += 320 + Math.min(1000, c * 30); }
      else if (u.role === 'photo') nominal += 640;
      else nominal += 190;
    });
    var budget = Math.max(8500, Math.min(13000, streamUnits.length * 260));
    var k = Math.min(1, budget / Math.max(1, nominal));
    var t = 220;
    function at(dt, fn) { t += Math.max(36, dt * k); streamTimers.push(setTimeout(fn, t)); }
    streamUnits.forEach(function (u) {
      var el = u.el;
      if (u.role === 'sheet') {
        at(300, function () { el.classList.add('st-in'); bringIntoView(el); postStream({ stage: u.kind, pi: u.pi, pn: u.pn, si: u.si, n: u.n }); });
        return;
      }
      if (u.role === 'row') { at(150, function () { el.classList.add('st-in', 'st-fade'); bringIntoView(el); }); return; }
      if (u.role === 'type') {
        var chars = (el.textContent || '').length;
        var typeDur = Math.min(1000, Math.max(420, chars * 34)) * Math.max(0.55, k);
        at(160, function () { el.classList.add('st-ghost', 'st-on'); bringIntoView(el); });          // серый каркас
        at(220, function () { el.classList.add('st-shed', 'st-in'); typeMarkup(el, typeDur); });      // заголовок печатается
        at(typeDur / k, function () {});                                                              // держим до конца печати
      } else if (u.role === 'photo') {
        at(170, function () { el.classList.add('st-ghost', 'st-on'); bringIntoView(el); });           // серый блок под фото
        at(240, function () { el.classList.add('st-shed', 'st-in', 'st-photo'); });                   // фото проявляется
        at(360, function () {});
      } else {
        at(200, function () { el.classList.add('st-in', 'st-fade'); bringIntoView(el); });            // мелочь просто возникает
      }
    });
    at(520, function () {
      document.body.classList.remove('kp-streaming');
      postStream({ done: true });
      smoothScrollTo(0); // элегантный финал — плавно к готовой обложке
    });
  }
  function finishStreamNow() {  // печать/скачивание посреди сборки: мгновенно доверстать всё
    if (!streamTimers.length && !typingEls.length) return;
    streamTimers.forEach(clearTimeout); streamTimers = [];
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    typingEls.forEach(function (x) { x.el.innerHTML = x.html; x.el.classList.remove('st-caret'); });
    typingEls = [];
    [].slice.call(document.querySelectorAll('.stx')).forEach(function (el) { el.classList.add('st-in', 'st-shed'); });
    document.body.classList.remove('kp-streaming');
    postStream({ done: true });
  }
  window.addEventListener('beforeprint', finishStreamNow);
  function autoNumber() {
    var d = parseDate(head.date);
    return 'КП-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }

  /* =============== документ =============== */
  function logo() {
    return '<div class="kp-logo"><span class="mark"><i><span></span><span></span></i></span>' +
      '<span class="txt"><b>EGOE</b><small>Завод металлоконструкций</small></span></div>';
  }
  function photoOrPh(src, alt, phLabel, sku, cls) {
    if (src) return '<div class="photo-box ' + (cls || '') + '"><img src="' + esc(src) + '" alt="' + esc(alt) + '" onerror="this.closest(\'.photo-box\').classList.add(\'noimg\');this.remove()"></div>';
    return '<div class="ph ' + (cls || '') + '">' + (sku ? '<span class="ph-tag">' + esc(sku) + '</span>' : '') +
      '<span class="ph-motif"></span><span class="ph-label">' + esc(phLabel || 'Фото по запросу') + '</span></div>';
  }

  function buildKp(rows, num, d) {
    var html = '';
    var t = totals(rows);
    var validDate = fmtRu(addDays(parseDate(head.date), 30));

    /* ОБЛОЖКА */
    var firstImg = (rows.filter(function (r) { return r.img; })[0] || rows[0] || {}).img || '';
    html += '<section class="sheet kp-cover">' +
      '<span class="bp-corner tl"></span><span class="bp-corner br"></span>' +
      '<div class="cover-top">' + logo() +
      '<div class="cover-eyebrow"><div class="eyebrow">Коммерческое предложение</div>' +
      '<div class="num">№ ' + esc(num) + ' от ' + d + '</div></div></div>' +
      '<div class="cover-photo">' + photoOrPh(firstImg, 'EGOE', 'Изделия EGOE', '', '') + '</div>' +
      '<h1 class="cover-title">Коммерческое<br><span class="am">предложение</span></h1>' +
      '<div class="kp-dimline"></div>' +
      '<div class="cover-meta">' +
      (head.object ? '<span>Объект: <b>' + esc(head.object) + '</b></span>' : '') +
      (head.addressee ? '<span>Кому: <b>' + esc(head.addressee) + '</b></span>' : '') +
      '<span>Изделий: <b>' + rows.length + '</b></span>' +
      '<span>EGOE · Завод металлоконструкций · Балаково</span></div>' +
      '</section>';

    /* ВЕДОМОСТЬ */
    var body = rows.map(function (r, i) {
      var onr = !priced(r);
      var hx = ralHex(r);
      return '<tr class="' + (onr ? 'onreq' : '') + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + miniPhoto(r) + '</td>' +
        '<td class="lg-name"><b>' + esc(r.name) + '</b><small>Артикул ' + esc(r.id) + (r.cat && r.cat.productType ? ' · ' + esc(r.cat.productType) : '') + '</small></td>' +
        '<td>' + ralCell(r, hx) + '</td>' +
        '<td class="num">' + r.qty + '</td>' +
        '<td class="num">' + (onr ? '<span class="lg-onreq">под заказ</span>' : (isFirm(r) ? moneyInt(unit(r)) : 'от ' + moneyInt(unit(r)))) + '</td>' +
        '<td class="num">' + (onr ? '—' : money(unit(r) * r.qty)) + '</td>' +
        '</tr>';
    }).join('');
    html += '<section class="sheet kp-ledger">' +
      '<h2 class="kp-h">Ведомость изделий</h2>' +
      '<table><thead><tr><th class="num">№</th><th>Фото</th><th>Наименование</th><th>Цвет</th>' +
      '<th class="num">Кол-во</th><th class="num">Цена, ₽</th><th class="num">Сумма, ₽</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' +
      totalsBlock(t) +
      (t.hasOnReq ? '<div class="kp-note">* по позициям <span class="am">«под заказ»</span> цена и итог рассчитываются после уточнения объёма, цвета RAL и логистики.</div>' : '') +
      '</section>';

    /* ЛИСТЫ ИЗДЕЛИЙ */
    if (!ledgerOnly) {
      var n = rows.length;
      rows.forEach(function (r, i) { html += productSheet(r, i + 1, n); });
    }

    /* УСЛОВИЯ */
    html += termsSheet(validDate);
    /* СЕРТИФИКАТЫ — если в корзине есть корзины для кондиционеров */
    if (hasKorziny(rows)) html += certSheet();
    return html;
  }

  function hasKorziny(rows) {
    return rows.some(function (r) {
      if (r.cat && r.cat.catKey === 'metallokonstrukcii/korziny-dlya-konditsionerov') return true;
      if (/^(ART|STN)\d{1,3}$/i.test(r.id || '')) return true;
      if (r.cat && /корзин/i.test(r.cat.category || '')) return true;
      return false;
    });
  }
  function certSheet() {
    var docs = [
      ['../assets/img/docs/korziny/sertifikat.webp', 'Сертификат соответствия', 'Система «Прибор-Эксперт» · № РОСС RU.НЕ06.Н25994 · действует до 14.07.2027'],
      ['../assets/img/docs/korziny/protokol-1.webp', 'Протокол испытаний · лист 1', 'Лаборатория «Система качества» · № СК-24/07-0339 от 09.07.2024'],
      ['../assets/img/docs/korziny/protokol-2.webp', 'Протокол испытаний · лист 2', 'Размеры, сталь 0,7 мм, кромки — все показатели «соответствует»']
    ];
    return '<section class="sheet kp-certs">' +
      '<span class="bp-corner tl"></span><span class="bp-corner br"></span>' +
      '<h2 class="kp-h">Сертификаты и испытания</h2>' +
      '<p class="kp-certs-sub">Корзины для кондиционеров сертифицированы и прошли лабораторные испытания. Продукция соответствует ТУ 28.25.12-001-24405486-2024. Полный пакет документов предоставляется к поставке.</p>' +
      '<div class="cert-sheet-grid">' +
      docs.map(function (d) {
        return '<figure class="cert-doc"><div class="cert-doc-img"><img src="' + d[0] + '" alt="' + esc(d[1]) + '" onerror="this.closest(\'.cert-doc\').style.display=\'none\'"></div><figcaption><b>' + esc(d[1]) + '</b><span>' + esc(d[2]) + '</span></figcaption></figure>';
      }).join('') +
      '</div></section>';
  }

  function ralHex(row) {
    if (!row.ral) return null;
    var list = (row.cat && row.cat.ral) || [];
    var key = row.ral.replace(/\s/g, '').toLowerCase();
    var hit = list.filter(function (x) { return x.name && x.name.replace(/\s/g, '').toLowerCase() === key; })[0];
    return hit ? hit.hex : null;
  }
  function miniPhoto(r) {
    if (r.img) return '<div class="photo-box lg-ph"><img src="' + esc(r.img) + '" alt="" onerror="this.closest(\'.photo-box\').classList.add(\'noimg\');this.remove()"></div>';
    return '<div class="ph lg-ph"><span class="ph-motif" style="width:20px;height:20px"></span></div>';
  }
  function ralCell(r, hx) {
    if (!r.ral) return '<span class="lg-onreq">—</span>';
    return '<span class="ral-chip ' + (hx ? '' : 'na') + '">' + (hx ? '<i style="background:' + esc(hx) + '"></i>' : '<i></i>') + esc(r.ral) + '</span>';
  }

  function productSheet(r, idx, n) {
    var cat = r.cat;
    var hasDraw = !!(cat && cat.drawing);
    var imgs = (cat && cat.images) || [];
    var mainImg = r.img || (imgs[0] && imgs[0].path ? '../' + imgs[0].path : '');
    var noDraw = hasDraw ? '' : ' no-draw';
    var eyebrow = (cat && /art\s*d/i.test(cat.category || '')) || /Déco|Deco/i.test(r.name) ? 'Art Déco · ' + esc(r.id) : 'Артикул ' + esc(r.id);

    var visual = '<div class="prod-visual">' + photoOrPh(mainImg, r.name, 'Фото по запросу', r.id, '');
    if (hasDraw) {
      visual += '<div class="kp-drawing" data-draw="' + esc(cat.drawing) + '" data-sku="' + esc(r.id) + '">' +
        '<span class="dl-tag">Чертёж · Blueprint</span><span class="dl-sku">' + esc(r.id) + '</span></div>';
      var dm = dims(cat);
      if (dm.any) visual += '<div class="kp-dimline"></div><div class="kp-dim">' + dimText(dm) + '</div>';
    } else {
      // Стандарт: под главным фото — студийное фото изделия на белом фоне (второй визуал, как чертёж у Арт-Деко)
      var whiteImg = imgs.filter(function (im) { return im.kind === 'white'; })[0]
        || imgs.filter(function (im) { return im.kind !== 'main'; })[0];
      if (whiteImg && whiteImg.path) {
        visual += '<div class="kp-white"><img src="../' + esc(whiteImg.path) + '" alt="' + esc(r.name) + ' — фото на белом фоне" loading="eager" ' +
          'onerror="this.closest(\'.kp-white\').classList.add(\'noimg\');this.remove()"></div>';
      }
    }
    visual += '</div>';

    var specs = (cat && cat.specs) || [];
    var specHtml = specs.length ? '<dl class="spec-list">' + specs.map(function (s) {
      return '<dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd>';
    }).join('') + '</dl>' : '';
    var ralHtml = (cat && cat.ral && cat.ral.length) ? '<div class="ral-row"><div class="rr-h">Доступные цвета RAL</div><div class="ral-swatches">' +
      cat.ral.map(function (c) {
        var on = r.ral && c.name && r.ral.replace(/\s/g, '').toLowerCase() === c.name.replace(/\s/g, '').toLowerCase();
        return '<span class="sw ' + (on ? 'on' : '') + '"><i style="background:' + esc(c.hex) + '"></i>' + esc(c.name) + (on ? ' ●' : '') + '</span>';
      }).join('') + '</div></div>' : '';
    var pricePlate = priced(r)
      ? '<div class="price-plate"><span class="pl-l">Цена</span><span class="pl-v">' + (isFirm(r) ? '' : 'от ') + moneyInt(unit(r)) + '</span><span class="pl-s">за шт · точная цена по объёму и RAL</span></div>'
      : '<div class="price-plate"><span class="pl-l">Цена</span><span class="pl-v">под заказ</span><span class="pl-s">рассчитывается под объём и RAL</span></div>';
    var descr = (cat && cat.description) ? '<p class="prod-desc">' + esc(cat.description) + '</p>' : '';

    return '<section class="sheet kp-product' + noDraw + '">' +
      '<span class="bp-corner tl"></span><span class="bp-corner br"></span>' +
      '<div class="prod-top"><span>EGOE · ' + esc((cat && cat.productType) || 'Изделие') + '</span><span>Лист ' + idx + '/' + n + ' · ' + esc(r.id) + '</span></div>' +
      '<div class="prod-head"><div class="eyebrow">' + eyebrow + '</div><h2>' + esc(r.name) + '</h2>' +
      (cat && cat.productType ? '<div class="ptype">' + esc(cat.productType) + '</div>' : '') + '</div>' +
      '<div class="prod-grid">' + visual +
      '<div class="prod-data">' + descr + specHtml + ralHtml + pricePlate + '</div>' +
      '</div></section>';
  }

  function dimText(dm) {
    var chain = [];
    if (dm.L) chain.push('Д ' + dm.L);
    if (dm.W) chain.push('Ш ' + dm.W);
    if (dm.H) chain.push('В ' + dm.H);
    var s = chain.length ? '<b>' + esc(chain.join(' × ')) + '</b>' : '';
    if (dm.Wt) s += (s ? ' · ' : '') + 'Вес <b>' + esc(dm.Wt) + '</b>';
    return 'Габариты: ' + s;
  }

  function termsSheet(validDate) {
    return '<section class="sheet kp-terms">' +
      '<h2 class="kp-h">Условия и контакты</h2>' +
      '<div class="term-grid">' +
      '<div class="term"><h4>Цены и оплата</h4><p>Цены указаны в рублях, в т.ч. НДС 20%. Точная стоимость — под объём, цвет RAL и комплектацию. Безналичный расчёт.</p></div>' +
      '<div class="term"><h4>Сроки изготовления</h4><p>Серийные позиции — от 5–10 рабочих дней; под объект — по согласованию.</p></div>' +
      '<div class="term"><h4>Гарантия</h4><p>24 месяца на металлоконструкцию и порошковую окраску RAL.</p></div>' +
      '<div class="term"><h4>Доставка</h4><p>Отгрузка по всей России от завода в Балаково; логистика под проект.</p></div>' +
      '</div>' +
      '<div class="kp-valid">Предложение действительно до <b>' + validDate + '</b>.</div>' +
      '<div class="kp-trust"><span>14 лет</span><span>800+ объектов</span><span>Завод-производитель</span><span>Своё производство</span></div>' +
      '<div class="kp-contacts"><span>Тел.: ' + CO.tel + '</span><span>E-mail: ' + CO.email + '</span><span>' + CO.place + '</span></div>' +
      '<div class="kp-disclaimer">Предложение носит информационный характер; окончательная стоимость фиксируется в договоре или спецификации. ' + CO.brand + ' · изготовитель ' + CO.maker + '.</div>' +
      '</section>';
  }

  /* =============== итоги (с НДС 20%) =============== */
  function totals(rows) {
    var withVat = 0, noVat = 0, vat = 0, hasOnReq = false;
    rows.forEach(function (r) {
      if (!priced(r)) { hasOnReq = true; return; }
      var wv = unit(r) * r.qty, nv = round2(wv / (1 + VAT));
      withVat += wv; noVat += nv; vat += (wv - nv);
    });
    return { withVat: round2(withVat), noVat: round2(noVat), vat: round2(vat), hasOnReq: hasOnReq };
  }
  function totalsBlock(t) {
    return '<div class="kp-totals">' +
      '<div class="row"><span>Итого без НДС</span><b class="num">' + money(t.noVat) + '</b></div>' +
      '<div class="row"><span>в т.ч. НДС 20%</span><b class="num">' + money(t.vat) + '</b></div>' +
      '<div class="row grand"><span>Итого с НДС</span><b class="num">' + money(t.withVat) + '</b></div></div>';
  }

  /* =============== чертежи (inline + перекрас в графит) =============== */
  function injectDrawings(rows) {
    var holders = doc.querySelectorAll('.kp-drawing[data-draw]');
    return Promise.all([].map.call(holders, function (h) {
      var path = h.getAttribute('data-draw');
      return fetch('../' + path + '?v=kp4').then(function (r) { return r.text(); }).then(function (txt) {
        txt = txt.replace(/<\?xml[^>]*\?>/i, '');
        /* хвостовой белый override .cls-N{...#ffffff...} → графит; не трогаем fill:none/тёмные */
        txt = txt.replace(/#ffffff/gi, '#14181e').replace(/#fff\b/gi, '#14181e');
        h.insertAdjacentHTML('beforeend', txt);
      }).catch(function () { /* нет чертежа — пропускаем */ });
    }));
  }

  /* =============== штамп-подвал =============== */
  function fillStamp(num) {
    var s = document.getElementById('kpStamp');
    if (!s) return;
    s.innerHTML = '<span>EGOE · Завод металлоконструкций, Балаково</span><span>Отгрузка по всей России</span><span>КП № ' + esc(num) + '</span>';
  }

  /* =============== готовность + печать =============== */
  function finish() {
    var imgs = [].slice.call(doc.querySelectorAll('img'));
    var waits = imgs.map(function (im) {
      if (im.complete) return Promise.resolve();
      return new Promise(function (res) { im.addEventListener('load', res); im.addEventListener('error', res); });
    });
    var fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    Promise.all([fonts].concat(waits)).then(function () {
      var m = document.getElementById('kp-ready'); if (m) m.setAttribute('data-ready', '1');
      window.__kpReady = true;
      fitNarrow();
      if (auto) setTimeout(function () { window.print(); }, 120);
    });
  }

  /* узкий экран (мобилка / шторка): масштабируем A4 точно под ширину, без обрезки */
  var SHEET_W = 830; // 210mm + отступы
  function fitNarrow() {
    var d = document.querySelector('.kp-doc'); if (!d) return;
    if (window.innerWidth < 60) return; // вырожденный вьюпорт (скрытый iframe) — не трогаем
    if (window.innerWidth < 820) {
      d.style.width = SHEET_W + 'px';
      d.style.transform = 'none';
      var s = window.innerWidth / SHEET_W;
      var h = d.scrollHeight;
      d.style.transform = 'scale(' + s + ')';
      d.style.transformOrigin = 'top left';
      d.style.height = Math.ceil(h * s) + 'px';
    } else {
      d.style.width = ''; d.style.transform = ''; d.style.transformOrigin = ''; d.style.height = '';
    }
  }
  window.addEventListener('resize', fitNarrow);
  setTimeout(fitNarrow, 700); // страховка после дозагрузки чертежей

  /* ===== скачивание готового PDF-ФАЙЛА (клиентский рендер, без диалога печати) ===== */
  var pb = document.getElementById('kpPrintBtn');
  var _libP = null;
  function ensureLibs() {
    if (_libP) return _libP;
    _libP = new Promise(function (resolve, reject) {
      var srcs = [];
      if (!window.html2canvas) srcs.push('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
      if (!(window.jspdf && window.jspdf.jsPDF)) srcs.push('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
      var left = srcs.length; if (!left) return resolve();
      srcs.forEach(function (src) {
        var s = document.createElement('script'); s.src = src;
        s.onload = function () { if (--left === 0) resolve(); };
        s.onerror = function () { reject(new Error('lib')); };
        document.head.appendChild(s);
      });
    });
    return _libP;
  }
  var _dling = false;
  function setDlBusy(on) { if (pb) { pb.disabled = on; pb.textContent = on ? 'Собираем PDF…' : 'Скачать PDF'; } }
  function downloadPDF() {
    if (_dling) return; _dling = true; setDlBusy(true);
    finishStreamNow();
    var d = document.querySelector('.kp-doc');
    var saved = d ? { t: d.style.transform, w: d.style.width, h: d.style.height } : null;
    if (d) { d.style.transform = 'none'; d.style.width = SHEET_W + 'px'; d.style.height = ''; }   // снимаем мобильный масштаб — рендерим в полный A4
    function done() { if (d && saved) { d.style.transform = saved.t; d.style.width = saved.w; d.style.height = saved.h; } fitNarrow(); _dling = false; setDlBusy(false); }
    function fail() { done(); try { window.print(); } catch (e) {} }   // запасной путь — обычная печать
    ensureLibs().then(function () { return (document.fonts && document.fonts.ready) || Promise.resolve(); }).then(function () {
      var JsPDF = window.jspdf.jsPDF;
      var sheets = [].slice.call(doc.querySelectorAll('.sheet'));
      if (!sheets.length) return fail();
      var pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      var i = 0;
      (function next() {
        if (i >= sheets.length) { pdf.save(((head && head.number) || 'КП-EGOE') + '.pdf'); done(); return; }
        html2canvas(sheets[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }).then(function (cv) {
          if (i > 0) pdf.addPage();
          pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
          i++; next();
        }).catch(fail);
      })();
    }).catch(fail);
  }
  window.__kpDownload = downloadPDF;
  if (pb) pb.addEventListener('click', downloadPDF);
  var pbPrint = document.getElementById('kpPrintOnly');
  if (pbPrint) pbPrint.addEventListener('click', function () { window.print(); });
  // команда «скачать» из корзинной шторки (КП открыт в iframe)
  window.addEventListener('message', function (e) { if (e.origin === location.origin && e.data && e.data.kpDownload) downloadPDF(); });
})();
