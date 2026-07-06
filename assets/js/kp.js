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
    brand: 'EGOE', maker: 'ООО «Фабрика САМШИТ»',
    tel: '8 (8453) 65-57-77', email: 'samshitbalakovo@mail.ru',
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
    if (stream) { prepStream(); setTimeout(runStream, 380); } // печать стартует сразу; чертежи/фото дозаполняют свои блоки
    fillStamp(num);
    injectDrawings(rows).then(finish);   // дождаться вставки чертежей ДО __kpReady/печати
  }

  /* =============== потоковая «печать» документа =============== */
  var streamUnits = [], streamTimers = [];
  function prepStream() {
    var sheets = [].slice.call(doc.querySelectorAll('.sheet'));
    var pn = sheets.filter(function (s) { return s.classList.contains('kp-product'); }).length, pi = 0;
    sheets.forEach(function (sheet, si) {
      var kind = sheet.classList.contains('kp-cover') ? 'cover'
        : sheet.classList.contains('kp-ledger') ? 'ledger'
        : sheet.classList.contains('kp-product') ? 'product' : 'terms';
      if (kind === 'product') pi += 1;
      sheet.classList.add('stx', 'stx-sheet');
      streamUnits.push({ el: sheet, t: 'sheet', kind: kind, pi: pi, pn: pn, si: si, n: sheets.length });
      [].slice.call(sheet.children).forEach(function (ch) {
        var table = ch.tagName === 'TABLE' ? ch : (ch.querySelector ? ch.querySelector('table') : null);
        if (kind === 'ledger' && table && table.rows.length > 1) {
          // строки ведомости печатаются по одной
          [].slice.call(table.rows).forEach(function (tr) { tr.classList.add('stx'); streamUnits.push({ el: tr, t: 'row' }); });
        } else {
          ch.classList.add('stx');
          var t = (ch.querySelector && ch.querySelector('img')) ? 'img'
            : (/^H[12]$/.test(ch.tagName) || (ch.classList && ch.classList.contains('kp-h'))) ? 'h' : 'b';
          streamUnits.push({ el: ch, t: t });
        }
      });
    });
  }
  function postStream(msg) { try { parent.postMessage({ kpStream: msg }, location.origin); } catch (e) {} }
  function runStream() {
    if (!streamUnits.length) { postStream({ done: true }); return; }
    document.body.classList.add('kp-streaming');
    var headEl = document.createElement('div'); headEl.className = 'st-head'; document.body.appendChild(headEl);
    var k = streamUnits.length > 90 ? 90 / streamUnits.length : 1;   // длинные КП печатаются быстрее
    var delays = { sheet: 380, img: 430, h: 260, row: 135, b: 185 };
    var t = 250;
    streamUnits.forEach(function (u) {
      t += Math.max(60, Math.round((delays[u.t] || 185) * k));
      streamTimers.push(setTimeout(function () {
        u.el.classList.add('st-in');
        if (u.t === 'sheet') postStream({ stage: u.kind, pi: u.pi, pn: u.pn, si: u.si, n: u.n });
        var r = u.el.getBoundingClientRect();
        headEl.style.top = (r.bottom + window.scrollY + 5) + 'px';
        headEl.style.left = (r.left + window.scrollX) + 'px';
        var vh = window.innerHeight;
        if (r.height > vh * 0.6) { // целая страница: показываем её верх
          if (r.top > vh * 0.3 || r.top < 0) window.scrollTo(0, window.scrollY + r.top - 80);
        } else if (r.bottom > vh * 0.78) { // обычный блок: следуем за точкой печати
          window.scrollTo(0, window.scrollY + (r.bottom - vh * 0.55));
        }
      }, t));
    });
    streamTimers.push(setTimeout(function () {
      headEl.remove();
      document.body.classList.remove('kp-streaming');
      postStream({ done: true });
    }, t + 480));
  }
  function finishStreamNow() {  // печать/скачивание посреди потока: мгновенно допечатать всё
    if (!streamTimers.length) return;
    streamTimers.forEach(clearTimeout); streamTimers = [];
    [].slice.call(document.querySelectorAll('.stx')).forEach(function (el) { el.classList.add('st-in'); });
    var h = document.querySelector('.st-head'); if (h) h.remove();
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
    return html;
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
      var thumbs = imgs.filter(function (im) { return im.kind !== 'main'; }).slice(0, 3);
      if (thumbs.length) {
        visual += '<div class="kp-thumbs">' + thumbs.map(function (im) {
          return '<div class="photo-box"><img src="../' + esc(im.path) + '" alt="" loading="eager" onerror="this.closest(\'.photo-box\').classList.add(\'noimg\');this.remove()"></div>';
        }).join('') + '</div>';
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

  var pb = document.getElementById('kpPrintBtn');
  if (pb) pb.addEventListener('click', function () { window.print(); });
})();
