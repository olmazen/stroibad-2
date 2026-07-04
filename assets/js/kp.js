/* ============================================================
   EGOE · рендер коммерческого предложения (/kp/)
   Читает корзину (localStorage sp_cart_v1) + шапку (sp_kp_head_v1)
   + каталог (assets/catalog.json). Режимы: beauty | tender (44-ФЗ).
   PDF = Chrome window.print → «Сохранить как PDF».
   ============================================================ */
(function () {
  'use strict';

  var CART_KEY = 'sp_cart_v1';
  var HEAD_KEY = 'sp_kp_head_v1';
  var VAT = 0.20;

  /* Реквизиты поставщика — статичная константа (НЕ из корзины) */
  var SUP = {
    name: 'ООО «Фабрика САМШИТ»',
    brand: 'производитель продукции под маркой EGOE™',
    inn: '6439086125', kpp: '643901001', ogrn: '1146439002863',
    okpo: '26854828', oktmo: '63607460101',
    addr: '413801, Саратовская обл., Балаковский р-н, с. Натальино, ул. Безымянный, д. 1',
    rs: '40702810600000008505', bank: 'АО «Банк «Агророс», г. Саратов',
    ks: '30101810600000000772', bik: '046311772',
    dir: 'Рафиков Ринат Мубинович', dirShort: 'Рафиков Р.М.', basis: 'Устава',
    tel: '8 (8453) 65-57-77', email: 'samshitbalakovo@mail.ru',
  };

  var P = new URLSearchParams(location.search);
  var mode = P.get('mode') === 'tender' ? 'tender' : 'beauty';
  var ledgerOnly = P.get('ledger') === '1' || mode === 'tender';
  var ndsPerRow = mode === 'tender' && P.get('nds') === 'row';
  var auto = P.get('auto') === '1';
  var firmOnly = mode === 'tender';   // тендер: только ТВЁРДАЯ цена (row.price), справочная «от» не подходит для НМЦК

  document.body.className = 'mode-' + mode + (ledgerOnly ? ' ledger-only' : '');
  var modeLabel = document.getElementById('kpModeLabel');
  if (modeLabel) modeLabel.textContent = mode === 'tender' ? 'Тендерное КП · 44-ФЗ' : 'Красивое КП';

  /* ---------------- утилиты ---------------- */
  function readJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var NBSP = ' ';
  function money(n) {
    var s = (Math.round(n * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return s.replace(/\s/g, NBSP) + NBSP + '₽';
  }
  function moneyInt(n) { return Math.round(n).toLocaleString('ru-RU').replace(/\s/g, NBSP) + NBSP + '₽'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function parseDate(s) {
    if (!s) return new Date();
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);   // локальная дата — без UTC-сдвига на день
    var d = new Date(s); return isNaN(d) ? new Date() : d;
  }
  function fmtRu(d) { return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  /* сумма прописью (рубли — м.р., тысячи — ж.р.) */
  function rublesInWords(n) {
    n = Math.floor(n);
    if (n === 0) return 'ноль';
    var o0 = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
    var o1 = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
    var te = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
    var tn = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    var hu = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    function triad(num, fem) {
      var w = [], h = Math.floor(num / 100), t = Math.floor((num % 100) / 10), u = num % 10;
      if (h) w.push(hu[h]);
      if (t === 1) w.push(te[u]);
      else { if (t) w.push(tn[t]); if (u) w.push((fem ? o1 : o0)[u]); }
      return w.join(' ');
    }
    var scale = [['', '', ''], ['тысяча', 'тысячи', 'тысяч'], ['миллион', 'миллиона', 'миллионов'], ['миллиард', 'миллиарда', 'миллиардов']];
    var g = [], x = n; while (x > 0) { g.push(x % 1000); x = Math.floor(x / 1000); }
    var parts = [];
    for (var i = g.length - 1; i >= 0; i--) {
      var num = g[i]; if (!num) continue;
      var words = triad(num, i === 1);
      if (words) parts.push(words);
      if (i > 0) parts.push(decl(num, scale[i]));
    }
    return parts.join(' ');
  }
  function decl(n, forms) {
    var m100 = n % 100, m10 = n % 10;
    if (m100 >= 11 && m100 <= 14) return forms[2];
    if (m10 === 1) return forms[0];
    if (m10 >= 2 && m10 <= 4) return forms[1];
    return forms[2];
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function amountInWords(total) {
    var rub = Math.floor(total), kop = Math.round((total - rub) * 100);
    if (kop === 100) { rub += 1; kop = 0; }
    return cap(rublesInWords(rub)) + ' ' + decl(rub, ['рубль', 'рубля', 'рублей']) +
      ' ' + pad2(kop) + ' ' + decl(kop, ['копейка', 'копейки', 'копеек']) + ', включая НДС 20%';
  }

  /* ---------------- бизнес-логика позиции ---------------- */
  function round2(n) { return Math.round(n * 100) / 100; }
  function unit(row) {
    if (row.price > 0) return row.price;
    return firmOnly ? 0 : (row.priceFrom > 0 ? row.priceFrom : 0);  // тендер: без fallback на «от»
  }
  function priced(row) { return unit(row) > 0; }
  function ralHex(row) {
    if (!row.ral) return null;
    var list = (row.cat && row.cat.ral) || [];
    var key = row.ral.replace(/\s/g, '').toLowerCase();
    var hit = list.filter(function (x) { return x.name && x.name.replace(/\s/g, '').toLowerCase() === key; })[0];
    return hit ? hit.hex : null;
  }
  function specVal(cat, re) {
    if (!cat || !cat.specs) return null;
    for (var i = 0; i < cat.specs.length; i++) if (re.test(cat.specs[i][0].toLowerCase())) return cat.specs[i][1];
    return null;
  }
  function dims(cat) {
    var L = specVal(cat, /длина|габарит/), W = specVal(cat, /ширина/), H = specVal(cat, /высота|высотой/), Wt = specVal(cat, /вес|масса/);
    return { L: L, W: W, H: H, Wt: Wt, any: !!(L || W || H || Wt) };
  }
  function warranty(cat) { return specVal(cat, /гаранти/) || '24 мес.'; }
  function material(cat) { return specVal(cat, /материал/) || 'сталь'; }

  /* ---------------- загрузка ---------------- */
  var doc = document.getElementById('kp');
  var cart = readJSON(CART_KEY, []);
  var head = readJSON(HEAD_KEY, {});

  fetch('../assets/catalog.json?v=kp2').then(function (r) { return r.json(); }).then(function (catalog) {
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
    if (mode === 'tender') doc.innerHTML = buildTender(rows, num, d);
    else doc.innerHTML = buildBeauty(rows, num, d);
    fillStamp(num);
    if (mode === 'tender') runValidator(rows);
    injectDrawings(rows).then(finish);   // дождаться вставки чертежей ДО __kpReady/печати (иначе пустые рамки в PDF)
  }
  function autoNumber() {
    var d = parseDate(head.date);
    return 'КП-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }

  /* =============== BEAUTY =============== */
  function logo() {
    return '<div class="kp-logo"><span class="mark"><i><span></span><span></span></i></span>' +
      '<span class="txt"><b>EGOE</b><small>Завод металлоконструкций</small></span></div>';
  }
  function photoOrPh(src, alt, phLabel, sku, cls) {
    if (src) return '<div class="photo-box ' + (cls || '') + '"><img src="' + esc(src) + '" alt="' + esc(alt) + '" onerror="this.closest(\'.photo-box\').classList.add(\'noimg\');this.remove()"></div>';
    return '<div class="ph ' + (cls || '') + '">' + (sku ? '<span class="ph-tag">' + esc(sku) + '</span>' : '') +
      '<span class="ph-motif"></span><span class="ph-label">' + esc(phLabel || 'Фото по запросу') + '</span></div>';
  }

  function buildBeauty(rows, num, d) {
    var html = '';
    /* ОБЛОЖКА */
    var firstImg = (rows.filter(function (r) { return r.img; })[0] || rows[0] || {}).img || '';
    html += '<section class="sheet kp-cover beauty-only">' +
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
    var t = totals(rows);
    var body = rows.map(function (r, i) {
      var onr = !priced(r);
      var hx = ralHex(r);
      return '<tr class="' + (onr ? 'onreq' : '') + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td>' + miniPhoto(r) + '</td>' +
        '<td class="lg-name"><b>' + esc(r.name) + '</b><small>Артикул ' + esc(r.id) + (r.cat && r.cat.productType ? ' · ' + esc(r.cat.productType) : '') + '</small></td>' +
        '<td>' + ralCell(r, hx) + '</td>' +
        '<td class="num">' + r.qty + '</td>' +
        '<td class="num">' + (onr ? '<span class="lg-onreq">под заказ</span>' : moneyInt(unit(r))) + '</td>' +
        '<td class="num">' + (onr ? '—' : money(unit(r) * r.qty)) + '</td>' +
        '</tr>';
    }).join('');
    html += '<section class="sheet kp-ledger">' +
      '<h2 class="kp-h">Ведомость изделий</h2>' +
      '<table><thead><tr><th class="num">№</th><th>Фото</th><th>Наименование</th><th>Цвет</th>' +
      '<th class="num">Кол-во</th><th class="num">Цена, ₽</th><th class="num">Сумма, ₽</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' +
      totalsBlock(t, false) +
      (t.hasOnReq ? '<div class="kp-note">* по позициям <span class="am">«под заказ»</span> цена и итог рассчитываются после уточнения объёма, цвета RAL и логистики.</div>' : '') +
      '</section>';

    /* ЛИСТЫ ИЗДЕЛИЙ */
    if (!ledgerOnly) {
      var n = rows.length;
      rows.forEach(function (r, i) { html += productSheet(r, i + 1, n); });
    }

    /* УСЛОВИЯ */
    html += termsSheet();
    return html;
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
    var eyebrow = cat && /art\s*d/i.test(cat.category || '') || /Déco|Deco/i.test(r.name) ? 'Art Déco · ' + esc(r.id) : 'Артикул ' + esc(r.id);

    /* визуал */
    var visual = '<div class="prod-visual">' + photoOrPh(mainImg, r.name, 'Фото по запросу', r.id, '');
    if (hasDraw) {
      visual += '<div class="kp-drawing" data-draw="' + esc(cat.drawing) + '" data-sku="' + esc(r.id) + '">' +
        '<span class="dl-tag">Чертёж · Blueprint</span><span class="dl-sku">' + esc(r.id) + '</span></div>';
      var dm = dims(cat);
      if (dm.any) {
        visual += '<div class="kp-dimline"></div><div class="kp-dim">' + dimText(dm) + '</div>';
      }
    } else {
      /* контактный лист миниатюр */
      var thumbs = imgs.filter(function (im) { return im.kind !== 'main'; }).slice(0, 3);
      if (thumbs.length) {
        visual += '<div class="kp-thumbs">' + thumbs.map(function (im) {
          return '<div class="photo-box"><img src="../' + esc(im.path) + '" alt="" loading="eager" onerror="this.closest(\'.photo-box\').classList.add(\'noimg\');this.remove()"></div>';
        }).join('') + '</div>';
      }
    }
    visual += '</div>';

    /* данные */
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
      ? '<div class="price-plate"><span class="pl-l">Цена</span><span class="pl-v">от ' + moneyInt(unit(r)) + '</span><span class="pl-s">за шт · точная цена по объёму и RAL</span></div>'
      : '<div class="price-plate"><span class="pl-l">Цена</span><span class="pl-v">под заказ</span><span class="pl-s">рассчитывается под объём и RAL</span></div>';

    var descr = (cat && cat.description) ? '<p class="prod-desc">' + esc(cat.description) + '</p>' : '';

    return '<section class="sheet kp-product beauty-only' + noDraw + '">' +
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

  function termsSheet() {
    return '<section class="sheet kp-terms beauty-only">' +
      '<h2 class="kp-h">Условия и контакты</h2>' +
      '<div class="term-grid">' +
      '<div class="term"><h4>Оплата</h4><p>Гибкие условия под объём и график поставки. Работаем с НДС, по 44-ФЗ и 223-ФЗ.</p></div>' +
      '<div class="term"><h4>Сроки изготовления</h4><p>Серийные позиции — от 5–10 рабочих дней; под объект — по согласованию.</p></div>' +
      '<div class="term"><h4>Гарантия</h4><p>24 месяца на металлоконструкцию и порошковую окраску RAL.</p></div>' +
      '<div class="term"><h4>Доставка</h4><p>Отгрузка по всей России от завода в Балаково; логистика под проект.</p></div>' +
      '</div>' +
      '<div class="kp-trust"><span>14 лет</span><span>800+ объектов</span><span>Завод-производитель</span><span>44-ФЗ · НДС</span></div>' +
      '<div class="kp-contacts"><span>Тел.: ' + SUP.tel + '</span><span>E-mail: ' + SUP.email + '</span><span>Производство: г. Балаково</span></div>' +
      '<div class="kp-disclaimer">Предложение носит информационный характер; окончательная стоимость фиксируется в договоре или спецификации. Цены зависят от объёма партии, цвета RAL, комплектации и условий доставки.</div>' +
      '</section>';
  }

  /* =============== TENDER (44-ФЗ) =============== */
  function buildTender(rows, num, d) {
    var validDate = fmtRu(addDays(parseDate(head.date), 30));
    var t = totals(rows);

    /* шапка */
    var html = '<section class="sheet kp-thead-sheet tender-only">' +
      '<div class="kp-thead"><div class="th-top">' +
      '<div class="th-supplier"><div class="name">' + SUP.name + '</div>' +
      '<div class="brand">' + SUP.brand + '</div>' +
      '<div class="reqs">ИНН ' + SUP.inn + ' · КПП ' + SUP.kpp + ' · ОГРН ' + SUP.ogrn + '<br>' +
      SUP.addr + '<br>Тел.: ' + SUP.tel + ' · ' + SUP.email + '</div></div>' +
      '<div class="th-out">Исх. № ' + esc(num) + '<br>от ' + d + ' г.</div></div>' +
      '<div class="th-rule"></div>' +
      '<div class="th-addr"><b>Кому:</b> ' + (esc(head.addressee) || '_______________________________') +
      (head.reqNumber ? '<br>На запрос № ' + esc(head.reqNumber) + (head.reqDate ? ' от ' + fmtRu(parseDate(head.reqDate)) : '') : '') + '</div>' +
      '<h1 class="th-title">Коммерческое предложение</h1>' +
      '<div class="th-sub">для обоснования начальной (максимальной) цены контракта (44-ФЗ)</div>' +
      '<p class="kp-intro">В ответ на Ваш запрос сообщаем стоимость поставки товара, соответствующего техническому заданию:' +
      '<span class="nds">Цены указаны в рублях РФ, в т.ч. НДС 20% (поставщик на общей системе налогообложения).</span></p>' +
      tenderTable(rows) +
      tenderTotals(t) +
      (t.hasOnReq ? '' : '<div class="kp-words">Всего наименований ' + rows.length + ', на сумму: <b>' + esc(amountInWords(t.withVat)) + '</b>.</div>') +
      tenderConditions(validDate, d) +
      '<div class="kp-offer">Настоящее коммерческое предложение является официальной офертой (ст. 435 ГК РФ).</div>' +
      '<div class="kp-assure">Товар новый, соответствует требованиям технического задания. Поставщик не включён в реестр недобросовестных поставщиков.</div>' +
      requisitesBlock() +
      signatureBlock(d) +
      '</div></section>';
    return html;
  }

  function tenderTable(rows) {
    var head6 = '<tr><th class="num">№</th><th>Наименование товара, характеристики</th><th>Ед.</th>' +
      '<th class="num">Кол-во</th><th class="num">Цена за ед. с НДС, ₽</th><th class="num">Сумма с НДС, ₽</th></tr>';
    var head8 = '<tr><th class="num">№</th><th>Наименование товара, характеристики</th><th>Ед.</th><th class="num">Кол-во</th>' +
      '<th class="num">Цена без НДС</th><th class="num">Сумма без НДС</th><th class="num">НДС 20%</th><th class="num">Сумма с НДС</th></tr>';
    var body = rows.map(function (r, i) {
      var withVat = unit(r) * r.qty;
      var noVat = round2(withVat / (1 + VAT)), vat = withVat - noVat;
      var name = '<div class="t-name"><b>' + esc(tenderName(r)) + '</b><small>' + esc(tenderChar(r)) + '</small></div>';
      if (ndsPerRow) {
        return '<tr><td class="num">' + (i + 1) + '</td><td>' + name + '</td><td>шт.</td><td class="num">' + r.qty + '</td>' +
          '<td class="num">' + money(round2(unit(r) / (1 + VAT))) + '</td><td class="num">' + money(noVat) + '</td>' +
          '<td class="num">' + money(vat) + '</td><td class="num">' + money(withVat) + '</td></tr>';
      }
      return '<tr><td class="num">' + (i + 1) + '</td><td>' + name + '</td><td>шт.</td><td class="num">' + r.qty + '</td>' +
        '<td class="num">' + money(unit(r)) + '</td><td class="num">' + money(withVat) + '</td></tr>';
    }).join('');
    return '<div class="kp-ttable"><table><thead>' + (ndsPerRow ? head8 : head6) + '</thead><tbody>' + body + '</tbody></table></div>';
  }
  function tenderName(r) {
    /* наименование под ТЗ: имя изделия (уже содержит тип: Скамейка/Лежак/Урна…) + марка + артикул */
    var name = r.name.replace(/\s*\(Art\s*Déco\)/i, '').trim();
    return name + ', марка EGOE™, арт. ' + r.id;
  }
  function tenderChar(r) {
    var cat = r.cat;
    if (!cat) return 'характеристики уточняются (позиция вне текущего каталога)';
    var parts = [];
    parts.push('материал: ' + material(cat));
    var dm = dims(cat);
    var g = []; if (dm.L) g.push('Д ' + dm.L); if (dm.W) g.push('Ш ' + dm.W); if (dm.H) g.push('В ' + dm.H);
    if (g.length) parts.push('габариты: ' + g.join(', '));
    if (dm.Wt) parts.push('вес: ' + dm.Wt);
    parts.push('покрытие: порошковая окраска' + (r.ral ? ' ' + r.ral : ', цвет RAL по согласованию'));
    parts.push('гарантия: ' + warranty(cat));
    parts.push('страна происхождения: Россия');
    return parts.join('; ') + '.';
  }
  function tenderTotals(t) {
    return '<div class="kp-ttotals">' +
      '<div class="row"><span>Итого без НДС:</span><b class="num">' + money(t.noVat) + '</b></div>' +
      '<div class="row"><span>в т.ч. НДС 20%:</span><b class="num">' + money(t.vat) + '</b></div>' +
      '<div class="row grand"><span>ВСЕГО с НДС:</span><b class="num">' + money(t.withVat) + '</b></div></div>';
  }
  function tenderConditions(validDate, priceDate) {
    return '<div class="kp-cond"><h2 class="kp-h">Условия</h2><dl>' +
      '<dt>Срок изготовления/поставки:</dt><dd>по согласованию сторон (серийные позиции — от 5–10 рабочих дней).</dd>' +
      '<dt>Место поставки, доставка:</dt><dd>по адресу заказчика; доставка по всей России от завода-изготовителя (г. Балаково).</dd>' +
      '<dt>Условия оплаты:</dt><dd>по согласованию (предоплата/поэтапно), безналичный расчёт.</dd>' +
      '<dt>Гарантия:</dt><dd>24 месяца на металлоконструкцию и покрытие.</dd>' +
      '<dt>Валюта:</dt><dd>рубли РФ.</dd>' +
      '<dt>Срок действия предложения:</dt><dd>до ' + validDate + ' включительно.</dd>' +
      '<dt>Цены сформированы:</dt><dd>по состоянию на ' + priceDate + '.</dd>' +
      '</dl></div>';
  }
  function requisitesBlock() {
    return '<div class="kp-req"><h2 class="kp-h">Реквизиты поставщика</h2><dl>' +
      '<dt>Наименование</dt><dd>' + SUP.name + '</dd>' +
      '<dt>ИНН / КПП</dt><dd>' + SUP.inn + ' / ' + SUP.kpp + '</dd>' +
      '<dt>ОГРН</dt><dd>' + SUP.ogrn + '</dd>' +
      '<dt>ОКПО / ОКТМО</dt><dd>' + SUP.okpo + ' / ' + SUP.oktmo + '</dd>' +
      '<dt>Адрес</dt><dd>' + SUP.addr + '</dd>' +
      '<dt>Расчётный счёт</dt><dd>' + SUP.rs + '</dd>' +
      '<dt>Банк</dt><dd>' + SUP.bank + '</dd>' +
      '<dt>Корр. счёт</dt><dd>' + SUP.ks + '</dd>' +
      '<dt>БИК</dt><dd>' + SUP.bik + '</dd>' +
      '<dt>Руководитель</dt><dd>Директор ' + SUP.dir + '</dd>' +
      '<dt>Контакты</dt><dd>' + SUP.tel + ' · ' + SUP.email + '</dd>' +
      '</dl></div>';
  }
  function signatureBlock(d) {
    return '<div class="kp-sign"><div class="sig-l">Директор ' + SUP.name + '<span class="sig-line"></span> / ' + SUP.dirShort + ' /' +
      '<div class="sig-basis">действует на основании ' + SUP.basis + ' · ' + d + '</div></div>' +
      '<div class="sig-mp">М.П.</div></div>';
  }

  /* =============== итоги =============== */
  function totals(rows) {
    var withVat = 0, noVat = 0, vat = 0, hasOnReq = false;
    rows.forEach(function (r) {
      if (!priced(r)) { hasOnReq = true; return; }
      var wv = unit(r) * r.qty, nv = round2(wv / (1 + VAT));
      withVat += wv; noVat += nv; vat += (wv - nv);   // суммируем ПОСТРОЧНО округлённое — итог сходится с таблицей
    });
    return { withVat: round2(withVat), noVat: round2(noVat), vat: round2(vat), hasOnReq: hasOnReq };
  }
  function totalsBlock(t, tender) {
    return '<div class="kp-totals">' +
      '<div class="row"><span>Итого без НДС</span><b class="num">' + money(t.noVat) + '</b></div>' +
      '<div class="row"><span>в т.ч. НДС 20%</span><b class="num">' + money(t.vat) + '</b></div>' +
      '<div class="row grand"><span>Итого с НДС</span><b class="num">' + money(t.withVat) + '</b></div></div>';
  }

  /* =============== чертежи (inline + перекрас) =============== */
  function injectDrawings(rows) {
    var holders = doc.querySelectorAll('.kp-drawing[data-draw]');
    return Promise.all([].map.call(holders, function (h) {
      var path = h.getAttribute('data-draw');
      return fetch('../' + path + '?v=kp2').then(function (r) { return r.text(); }).then(function (txt) {
        txt = txt.replace(/<\?xml[^>]*\?>/i, '');
        /* Чертежи имеют хвостовой белый override .cls-N{...#ffffff...} (для тёмного сайта).
           Заменяем ЛЮБОЙ белый → графит прямо в тексте SVG: не удаляем правила и не трогаем
           fill:none/тёмные исходники (иначе контурные фигуры зальются). */
        txt = txt.replace(/#ffffff/gi, '#14181e').replace(/#fff\b/gi, '#14181e');
        h.insertAdjacentHTML('beforeend', txt);
      }).catch(function () { /* нет чертежа — пропускаем */ });
    }));
  }

  /* =============== штамп-подвал =============== */
  function fillStamp(num) {
    var s = document.getElementById('kpStamp');
    if (!s) return;
    if (mode === 'tender') {
      s.innerHTML = '<span>' + SUP.name + ' · ИНН ' + SUP.inn + '</span><span>КП № ' + esc(num) + ' · 44-ФЗ</span><span>' + SUP.tel + '</span>';
    } else {
      s.innerHTML = '<span>EGOE™ · Завод металлоконструкций, Балаково</span><span>Отгрузка по всей России · 44-ФЗ · НДС</span><span>КП № ' + esc(num) + '</span>';
    }
  }

  /* =============== валидатор тендера =============== */
  function runValidator(rows) {
    var errs = [];
    if (!head.addressee) errs.push('Не указан адресат (полное наименование заказчика).');
    if (!head.number) errs.push('Не указан исходящий № КП.');
    if (!head.date) errs.push('Не указана дата КП.');
    var noCat = rows.filter(function (r) { return !r.cat; });
    if (noCat.length) errs.push('Позиции вне текущего каталога (характеристики недоступны): ' + noCat.map(function (r) { return r.name; }).join(', ') + '.');
    var onreq = rows.filter(function (r) { return !priced(r); });
    if (onreq.length) errs.push('Не указана твёрдая цена по позициям: ' + onreq.map(function (r) { return r.name; }).join(', ') + '. В тендерном КП цена за единицу обязательна (справочная «от» не подходит).');
    if (!errs.length) { window.__kpValid = true; return; }
    window.__kpValid = false;
    var ov = document.getElementById('kpOverlay');
    if (!ov) return;
    ov.hidden = false;
    ov.innerHTML = '<div class="ov-card"><h3>Тендерное КП не готово</h3>' +
      '<p class="ov-sub">Для документа под 44-ФЗ нужно заполнить обязательные поля:</p>' +
      '<ul>' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' +
      '<div class="ov-act"><a class="primary" href="../cart/index.html">← Вернуться в корзину</a>' +
      '<button type="button" onclick="document.getElementById(\'kpOverlay\').hidden=true">Показать как есть</button></div></div>';
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
      if (auto && !(mode === 'tender' && window.__kpValid === false)) setTimeout(function () { window.print(); }, 120);
    });
  }

  var pb = document.getElementById('kpPrintBtn');
  if (pb) pb.addEventListener('click', function () {
    if (mode === 'tender' && window.__kpValid === false) {
      var ov = document.getElementById('kpOverlay'); if (ov) ov.hidden = false;
      return;
    }
    window.print();
  });
})();
