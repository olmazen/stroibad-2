/* EGOE — общий скрипт сайта v3: навигация, формы, корзина-страница, микроанимации */
(function () {
  // модальное окно «Расчёт по ТЗ»
  window.openModal = function () {
    var m = document.getElementById('modal');
    if (m) { m.classList.add('on'); document.body.style.overflow = 'hidden'; }
  };
  window.closeModal = function () {
    var m = document.getElementById('modal');
    if (m) { m.classList.remove('on'); document.body.style.overflow = ''; }
  };
  document.addEventListener('click', function (e) {
    var m = document.getElementById('modal');
    if (m && e.target === m) window.closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.closeModal();
  });

  // ── КОНФИГ ЛИДОВ ─────────────────────────────────────────────────────────
  // e-mail: FormSubmit (активируется письмом-подтверждением на ПЕРВЫЙ сабмит).
  // tgRelay: URL релея Google Apps Script для Telegram — токен бота живёт В СКРИПТЕ,
  //          НЕ в этом файле и НЕ в публичном репозитории. Пусто = канал выключен.
  window.LEAD_CFG = window.LEAD_CFG || { email: 'zakaz@egoe-life.ru', tgRelay: 'https://script.google.com/macros/s/AKfycbx5_jnp2K1hCTRHX_7dMErdReIMhClkpFtWE6hIm19W_3V3uh6S2JEoQXBK6KMG914j7Q/exec' };

  // собрать пары «подпись поля → значение» из любой формы (у полей нет name — берём label/placeholder)
  function leadFields(form) {
    var out = {}, n = 0;
    form.querySelectorAll('input, textarea, select').forEach(function (el) {
      var t = (el.type || '').toLowerCase();
      if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'file') return;
      var wrap = el.closest('.field'), lab = wrap && wrap.querySelector('label');
      var key = (lab && lab.textContent.trim()) || el.getAttribute('placeholder') || el.getAttribute('aria-label') || ('Поле ' + (++n));
      var val = (t === 'checkbox') ? (el.checked ? 'да' : '') : (el.value || '').trim();
      if (val) out[key] = val;
    });
    return out;
  }
  // номер к единому виду +7XXXXXXXXXX (клиент мог ввести с пробелами/тире/через 8) → кликабелен в Telegram
  function normPhone(v) {
    var dg = String(v == null ? '' : v).replace(/\D/g, '');
    if (dg.length === 11 && (dg[0] === '8' || dg[0] === '7')) dg = '7' + dg.slice(1);
    else if (dg.length === 10) dg = '7' + dg;
    return dg.length === 11 ? '+' + dg : String(v == null ? '' : v);
  }
  function sendLead(fields, tag) {
    var payload = { _subject: 'Заявка с сайта EGOE — ' + (tag || 'форма') };
    Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });
    Object.keys(payload).forEach(function (k) { if (/тел|phone/i.test(k)) payload[k] = normPhone(payload[k]); });
    var C = window.LEAD_CFG || {};
    if (C.email) {
      fetch('https://formsubmit.co/ajax/' + encodeURIComponent(C.email), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () {});
    }
    if (C.tgRelay) {
      // text/plain = «простой» CORS-запрос → браузер НЕ шлёт preflight OPTIONS,
      // который Apps Script не умеет (иначе POST блокируется и в Telegram ничего не приходит).
      // Тело остаётся JSON-строкой — на стороне скрипта JSON.parse(e.postData.contents) её читает.
      fetch(C.tgRelay, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }).catch(function () {});
    }
  }
  window.__sendLead = sendLead;   // переиспользуется КП-генератором

  // отправка любой формы-заявки -> e-mail + Telegram, затем «спасибо»
  window.submitLead = function (form) {
    try { sendLead(leadFields(form), 'форма'); } catch (e) {}
    var box = form.querySelector('.form-result') || form.parentNode.querySelector('.form-result');
    form.style.display = 'none';
    if (box) box.style.display = 'block';
    return false;
  };

  // счётчик количества на странице товара
  window.qtyStep = function (btn, delta) {
    var input = btn.parentNode.querySelector('input');
    var v = Math.max(1, (parseInt(input.value, 10) || 1) + delta);
    input.value = v;
  };

  // выбор опции (чипы / RAL) + живой отклик галереи на цвет RAL
  window.pickOption = function (el) {
    var siblings = el.parentNode.querySelectorAll('.chip, .ralc');
    siblings.forEach(function (s) { s.classList.remove('on'); });
    el.classList.add('on');
    if (el.dataset && el.dataset.ral) {
      var main = document.querySelector('.gallery .ph.main');
      if (main) {
        main.style.setProperty('--ral', el.dataset.ral);
        main.classList.add('ral-on');
      }
    }
  };
})();

/* ── товарная галерея: замена главного кадра и крупный просмотр ── */
(function () {
  var galleries = document.querySelectorAll('.gallery');
  if (!galleries.length) return;

  var lightbox;
  var lightboxImg;
  var lightboxTitle;
  var lightboxCounter;
  var currentSet = [];
  var currentIndex = 0;

  function textOf(card) {
    var label = card.querySelector('.ph-label');
    return label ? label.textContent.trim() : '';
  }

  function readCard(card) {
    var img = card.querySelector('img');
    return {
      src: img ? (img.currentSrc || img.getAttribute('src') || img.src) : '',
      alt: img ? (img.getAttribute('alt') || '') : '',
      label: textOf(card),
      contain: card.classList.contains('contain')
    };
  }

  function writeCard(card, data) {
    var img = card.querySelector('img');
    var label = card.querySelector('.ph-label');
    if (!img || !data.src) return;
    img.src = data.src;
    img.alt = data.alt || data.label || '';
    img.loading = card.classList.contains('main') ? 'eager' : 'lazy';
    if (label) label.textContent = data.label || data.alt || '';
    card.classList.toggle('contain', !!data.contain);
    card.classList.add('has-img');
  }

  function galleryItems(gallery) {
    var main = gallery.querySelector('.ph.main');
    var thumbs = Array.prototype.slice.call(gallery.querySelectorAll('.thumbs .ph'));
    return [main].concat(thumbs).filter(Boolean).map(readCard).filter(function (item) {
      return item.src;
    });
  }

  function ensureLightbox() {
    if (lightbox) return lightbox;
    lightbox = document.createElement('div');
    lightbox.className = 'gallery-lightbox';
    lightbox.setAttribute('aria-hidden', 'true');
    lightbox.innerHTML = [
      '<button class="gallery-lightbox__btn" type="button" data-dir="-1" aria-label="Предыдущее фото">‹</button>',
      '<div class="gallery-lightbox__frame" role="dialog" aria-modal="true" aria-label="Просмотр фотографии">',
      '<button class="gallery-lightbox__close" type="button" aria-label="Закрыть">×</button>',
      '<div class="gallery-lightbox__photo"><img alt=""></div>',
      '<div class="gallery-lightbox__caption"><b></b><span class="gallery-lightbox__counter"></span></div>',
      '</div>',
      '<button class="gallery-lightbox__btn" type="button" data-dir="1" aria-label="Следующее фото">›</button>'
    ].join('');
    document.body.appendChild(lightbox);
    lightboxImg = lightbox.querySelector('img');
    lightboxTitle = lightbox.querySelector('.gallery-lightbox__caption b');
    lightboxCounter = lightbox.querySelector('.gallery-lightbox__counter');

    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox || e.target.closest('.gallery-lightbox__close')) closeLightbox();
      var btn = e.target.closest('[data-dir]');
      if (btn) stepLightbox(parseInt(btn.dataset.dir, 10));
    });

    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('on')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
    });
    return lightbox;
  }

  function renderLightbox() {
    var item = currentSet[currentIndex];
    if (!item) return;
    lightboxImg.src = item.src;
    lightboxImg.alt = item.alt || item.label || '';
    lightboxTitle.textContent = item.label || item.alt || 'Фото товара';
    lightboxCounter.textContent = (currentIndex + 1) + ' / ' + currentSet.length;
  }

  function openLightbox(gallery, index) {
    currentSet = galleryItems(gallery);
    currentIndex = Math.max(0, Math.min(index || 0, currentSet.length - 1));
    if (!currentSet.length) return;
    ensureLightbox();
    renderLightbox();
    lightbox.classList.add('on');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('gallery-lock');
    var close = lightbox.querySelector('.gallery-lightbox__close');
    if (close) close.focus();
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('on');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('gallery-lock');
  }

  function stepLightbox(dir) {
    if (!currentSet.length) return;
    currentIndex = (currentIndex + dir + currentSet.length) % currentSet.length;
    renderLightbox();
  }

  function swapWithMain(gallery, thumb) {
    var main = gallery.querySelector('.ph.main');
    if (!main || !thumb || main === thumb) return;
    var mainData = readCard(main);
    var thumbData = readCard(thumb);
    if (!thumbData.src) return;
    main.classList.add('is-changing');
    thumb.classList.remove('just-swapped');
    writeCard(main, thumbData);
    writeCard(thumb, mainData);
    requestAnimationFrame(function () {
      thumb.classList.add('just-swapped');
      setTimeout(function () {
        main.classList.remove('is-changing');
        thumb.classList.remove('just-swapped');
      }, 280);
    });
  }

  galleries.forEach(function (gallery) {
    var main = gallery.querySelector('.ph.main');
    var thumbs = gallery.querySelectorAll('.thumbs .ph');
    if (!main || !thumbs.length) return;

    main.setAttribute('role', 'button');
    main.setAttribute('tabindex', '0');
    main.setAttribute('aria-label', 'Открыть фото крупно');
    if (!main.querySelector('.gallery-open')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gallery-open';
      btn.textContent = 'Открыть крупно';
      main.appendChild(btn);
    }

    main.addEventListener('click', function (e) {
      if (e.target.closest('.gallery-open') || e.target.closest('img') || e.target === main) {
        openLightbox(gallery, 0);
      }
    });
    main.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightbox(gallery, 0);
      }
    });

    thumbs.forEach(function (thumb) {
      thumb.setAttribute('role', 'button');
      thumb.setAttribute('tabindex', '0');
      thumb.setAttribute('aria-label', 'Показать фото: ' + (textOf(thumb) || 'товар'));
      thumb.addEventListener('click', function () { swapWithMain(gallery, thumb); });
      thumb.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          swapWithMain(gallery, thumb);
        }
      });
    });
  });
})();

/* ── утилита: вызов колбэка, когда элемент появляется во вьюпорте ── */
window.__whenVisible = (function () {
  // IntersectionObserver надёжнее на СЛАБЫХ устройствах: срабатывает вне основного потока,
  // поэтому reveal не «застревает» невидимым, когда главный поток занят тяжёлой анимацией
  // (из-за чего секции оставались пустыми — сквозь них проступал blueprint-фон).
  if (typeof IntersectionObserver === 'function') {
    var cbs = new WeakMap();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var cb = cbs.get(e.target);
          io.unobserve(e.target); cbs.delete(e.target);
          if (cb) cb(e.target);
        }
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    return function (el, cb) { cbs.set(el, cb); io.observe(el); };
  }
  // фолбэк для очень старых браузеров (scroll + rAF)
  var watched = [];
  var ticking = false;
  function check() {
    ticking = false;
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    for (var i = watched.length - 1; i >= 0; i--) {
      var w = watched[i];
      var r = w.el.getBoundingClientRect();
      if (r.top < vh * (1 - w.margin) && r.bottom > 0) {
        watched.splice(i, 1);
        w.cb(w.el);
      }
    }
    if (!watched.length) {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    }
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(check); }
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  addEventListener('load', check);
  setTimeout(check, 60); setTimeout(check, 400); setTimeout(check, 1200);
  return function (el, cb, margin) {
    watched.push({ el: el, cb: cb, margin: margin || 0.08 });
    onScroll();
  };
})();

/* ── появление блоков при прокрутке ── */
(function () {
  var els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach(function (e) { e.classList.add('in'); });
    return;
  }
  els.forEach(function (e) {
    window.__whenVisible(e, function (el) { el.classList.add('in'); });
  });
  // страховка от «пустых карточек»: на слабых устройствах появление может застрять, и сквозь
  // невидимую карточку проступает blueprint-фон. Принудительно показываем всё, что уже в зоне
  // видимости (и выше), через 2с и 5с — контент никогда не остаётся невидимым.
  function revealVisible(){
    var vh = innerHeight;
    document.querySelectorAll('.reveal:not(.in)').forEach(function (el){
      if (el.getBoundingClientRect().top < vh) el.classList.add('in');
    });
  }
  setTimeout(revealVisible, 2000);
  setTimeout(revealVisible, 5000);
})();

/* ── анимированные счётчики ── */
(function () {
  var nums = document.querySelectorAll('[data-count]');
  if (!nums.length) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    nums.forEach(function (n) { n.firstChild && (n.childNodes[0].nodeValue = n.dataset.count); });
    return;
  }
  nums.forEach(function (n) {
    window.__whenVisible(n, function (el) {
      var target = parseFloat(el.dataset.count), t0 = null, dur = 1300;
      function tick(ts) {
        if (!t0) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.childNodes[0].nodeValue = Math.round(target * eased).toLocaleString('ru-RU');
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }, 0.15);
  });
})();

/* ── тень у закреплённой шапки при скролле ── */
(function () {
  var h = document.getElementById('siteHeader');
  if (!h) return;
  var onScroll = function () { h.classList.toggle('stuck', window.scrollY > 30); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ── индикатор прокрутки страницы (янтарная линия сверху) ── */
(function () {
  var bar = document.createElement('div');
  bar.className = 'scroll-progress';
  document.body.appendChild(bar);
  var onScroll = function () {
    var doc = document.documentElement;
    var max = doc.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ── подсветка карточек, следующая за курсором ── */
(function () {
  if (matchMedia('(hover: none)').matches) return;
  var sel = '.icard,.why-card,.model-card,.dir-tile,.dir-card,.dir-hero,.spot,.review,.tile,.type-card,.versus,.stat,.metric';
  document.querySelectorAll(sel).forEach(function (card) {
    card.classList.add('card-glow');
    card.addEventListener('mousemove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });
})();

/* ── чертежи: линии «рисуются» (hero + схемы) ── */
(function () {
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var svgs = document.querySelectorAll('svg[data-draw]');
  if (!svgs.length) return;

  function prep(svg) {
    var shapes = svg.querySelectorAll('path,line,rect,circle,ellipse,polyline,polygon');
    var i = 0;
    shapes.forEach(function (el) {
      if (el.classList.contains('bp-pulse')) return;
      var L;
      try { L = el.getTotalLength(); } catch (e) { return; }
      if (!L || !isFinite(L)) return;
      el.style.strokeDasharray = L;
      el.style.strokeDashoffset = L;
      el.style.transition = 'stroke-dashoffset 1s cubic-bezier(.4,0,.2,1) ' + (i * 0.09) + 's';
      el.dataset.prepped = '1';
      i++;
    });
    return i;
  }

  function draw(svg) {
    svg.querySelectorAll('[data-prepped]').forEach(function (el) {
      el.style.strokeDashoffset = 0;
    });
    svg.classList.add('drawn'); // включает появление подписей (.bp-fade)
  }

  svgs.forEach(function (svg) {
    if (reduced) { svg.classList.add('drawn'); return; }
    prep(svg);
    window.__whenVisible(svg, function () {
      setTimeout(function () { draw(svg); }, 250);
    }, 0.12);
  });
})();

/* ── мобильное меню v3: панель справа, аккордеоны разделов, CTA снизу ──
   Разметка строится ИЗ существующего desktop-меню (#nav) — один источник правды,
   ничего не дублируем в HTML страниц. */
(function () {
  var nav = document.getElementById('nav');
  var header = document.getElementById('siteHeader');
  if (!nav || !header) return;

  var esc = function (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var topbar = document.querySelector('.topbar');
  var phoneA = topbar ? topbar.querySelector('a[href^="tel:"]') : null;
  var messA = topbar ? Array.prototype.slice.call(topbar.querySelectorAll('.tb-r a:not([href^="tel:"])')) : [];

  // --- собираем панель из пунктов desktop-меню ---
  var body = '';
  Array.prototype.forEach.call(nav.children, function (child) {
    if (child.classList && child.classList.contains('navitem')) {
      var top = child.querySelector(':scope > a') || child.querySelector('a');
      var dd = child.querySelector('.dropdown');
      var items = dd ? Array.prototype.map.call(dd.querySelectorAll('.dd-item'), function (a) { return a.outerHTML; }).join('') : '';
      body += '<div class="mnav-group">'
        + '<button class="mnav-acc" type="button" aria-expanded="false"><span>' + esc(top.textContent.trim()) + '</span><i></i></button>'
        + '<div class="mnav-sub"><div class="mnav-sub-in">'
        + '<a class="mnav-all" href="' + esc(top.getAttribute('href')) + '">Весь раздел →</a>'
        + items
        + '</div></div></div>';
    } else if (child.tagName === 'A') {
      body += '<a class="mnav-link" href="' + esc(child.getAttribute('href')) + '">' + esc(child.textContent.trim()) + '</a>';
    }
  });

  var cta = '<div class="mnav-cta">'
    + '<button class="btn btn-primary btn-block" type="button" onclick="closeMnav();openModal()">Расчёт по ТЗ</button>'
    + (phoneA ? '<a class="mnav-phone" href="' + esc(phoneA.getAttribute('href')) + '">' + esc(phoneA.textContent.trim()) + '<small>звонок и расчёт бесплатно</small></a>' : '')
    + (messA.length ? '<div class="mnav-mess">' + messA.map(function (a) { return '<a href="' + esc(a.getAttribute('href')) + '">' + esc(a.textContent.trim()) + '</a>'; }).join('') + '</div>' : '')
    + '</div>';

  var mnav = document.createElement('div');
  mnav.className = 'mnav';
  mnav.id = 'mnav';
  mnav.setAttribute('aria-hidden', 'true');
  mnav.innerHTML = '<div class="mnav-ov"></div>'
    + '<aside class="mnav-panel" role="dialog" aria-label="Меню">'
    + '<div class="mnav-head"><b>EGOE</b><button class="mnav-x" type="button" aria-label="Закрыть меню">×</button></div>'
    + '<div class="mnav-scroll">' + body + '</div>'
    + cta
    + '</aside>';
  document.body.appendChild(mnav);

  var burger = document.querySelector('.burger');
  function openMnav() {
    mnav.classList.add('on');
    mnav.setAttribute('aria-hidden', 'false');
    document.body.classList.add('mnav-lock');
    if (burger) burger.classList.add('open');
  }
  window.closeMnav = function () {
    mnav.classList.remove('on');
    mnav.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mnav-lock');
    if (burger) burger.classList.remove('open');
  };
  window.toggleNav = function () {
    if (mnav.classList.contains('on')) window.closeMnav(); else openMnav();
  };

  mnav.querySelector('.mnav-ov').addEventListener('click', window.closeMnav);
  mnav.querySelector('.mnav-x').addEventListener('click', window.closeMnav);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') window.closeMnav(); });
  // переход по любой ссылке закрывает меню
  mnav.addEventListener('click', function (e) { if (e.target.closest('a')) window.closeMnav(); });
  // аккордеоны разделов
  mnav.querySelectorAll('.mnav-acc').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var g = btn.parentNode;
      var open = g.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      // одновременно открыт только один раздел — аккуратнее на маленьком экране
      if (open) mnav.querySelectorAll('.mnav-group.open').forEach(function (o) {
        if (o !== g) { o.classList.remove('open'); o.querySelector('.mnav-acc').setAttribute('aria-expanded', 'false'); }
      });
    });
  });
  window.addEventListener('resize', function () { if (innerWidth > 1180) window.closeMnav(); });
})();

/* ── шапка: поиск + корзина (лист для КП) ── */
(function () {
  var header = document.getElementById('siteHeader');
  if (!header) return;
  var logo = header.querySelector('.logo');
  // база сайта (для корректных путей на любой глубине и на GitHub Pages)
  var base = logo ? new URL(logo.getAttribute('href'), location.href) : new URL('./', location.href);
  var siteBase = new URL('./', base); // папка index.html = корень сайта

  /* ---- вставляем иконки в шапку ---- */
  var actions = header.querySelector('.hdr-actions');
  var burger = header.querySelector('.burger');
  var cartURL = new URL('cart/', siteBase).href;
  var tools = document.createElement('div');
  tools.className = 'hdr-tools';
  tools.innerHTML =
    '<button class="hicon" id="hSearch" type="button" aria-label="Поиск"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></button>' +
    '<a class="hicon" id="hCart" href="' + cartURL + '" aria-label="Корзина — список для расчёта"><svg viewBox="0 0 24 24"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg><span class="hicon-badge" id="cartCount">0</span></a>';
  if (actions) actions.insertBefore(tools, actions.firstChild);
  else if (burger) burger.parentNode.insertBefore(tools, burger);

  /* ---- разметка оверлеев (поиск + тост корзины) ---- */
  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="search-ov" id="searchOv"><div class="search-box">' +
      '<div class="search-field"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
      '<input type="search" id="searchInput" placeholder="Поиск по товарам: скамейка, урна, A1-101…" autocomplete="off">' +
      '<button class="search-x" id="searchX" aria-label="Закрыть">×</button></div>' +
      '<div class="search-results" id="searchResults"></div>' +
      '<div class="search-hint">Введите название или артикул · Esc — закрыть</div>' +
    '</div></div>' +
    '<div class="add-cart-ok" id="addCartOk"><span>Добавлено в список ✓</span><a href="' + cartURL + '">Открыть корзину →</a></div>';
  document.body.appendChild(wrap);

  /* ================= КОРЗИНА (данные; страница — /cart/) ================= */
  var KEY = 'sp_cart_v1';
  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function write(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} renderBadge(); }
  function count() { return read().reduce(function (s, i) { return s + i.qty; }, 0); }
  function setQty(id, d) {
    var c = read();
    c.forEach(function (x) { if (x.id === id) x.qty = Math.max(1, x.qty + d); });
    write(c);
  }
  function del(id) { write(read().filter(function (x) { return x.id !== id; })); }
  function clearAll() { write([]); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function abs(u) { try { return u ? new URL(u, location.href).href : ''; } catch (e) { return u; } }

  function update(id, patch) {
    var c = read();
    c.forEach(function (x) { if (x.id === id) { for (var k in patch) x[k] = patch[k]; } });
    write(c);
  }
  window.addToCart = function (item) {
    if (!item || !item.id) return;
    var c = read(); var f = c.filter(function (x) { return x.id === item.id; })[0];
    if (f) {
      f.qty += (item.qty || 1);
      if (item.ral) f.ral = item.ral;                            // обновляем выбор, если пришёл новый
    } else {
      c.push({
        id: item.id, name: item.name || item.id, url: item.url || '', img: item.img || '',
        qty: item.qty || 1,
        ral: item.ral || '',                                     // выбранный цвет RAL
        priceFrom: item.priceFrom || 0,                          // цена «от» с сайта (справочно, показывается как placeholder)
        price: 0,                                                // ТВЁРДАЯ цена/ед — только когда менеджер ввёл вручную (обязательна для тендера)
        comment: ''                                              // комментарий по позиции
      });
    }
    write(c); toast();
  };
  window.addToCartFromPage = function (btn) {
    var pp = document.querySelector('.pp-info') || document;
    var h = pp.querySelector('h1') || document.querySelector('h1');
    var art = (pp.querySelector('.pp-art') || {}).textContent || '';
    var m = art.match(/Артикул\s*([A-Za-zА-Яа-я0-9\-]+)/);
    var mainImg = document.querySelector('.gallery .ph.main img');
    var qtyInp = document.querySelector('.pp-info .qty input') || document.querySelector('.qty input');
    var ralEl = document.querySelector('.ral .ralc.on');
    var priceEl = document.querySelector('.pp-price .big');
    var priceFrom = priceEl ? (parseInt(priceEl.textContent.replace(/[^\d]/g, ''), 10) || 0) : 0;
    var id = (m ? m[1] : (h ? h.textContent.trim() : location.pathname)).trim();
    addToCart({
      id: id,
      name: h ? h.textContent.trim() : id,
      url: location.href,                                        // абсолютный — работает со страницы корзины
      img: mainImg ? abs(mainImg.getAttribute('src')) : '',      // абсолютный — картинка не ломается на /cart/
      qty: qtyInp ? Math.max(1, parseInt(qtyInp.value, 10) || 1) : 1,
      ral: ralEl ? (ralEl.getAttribute('title') || '') : '',     // напр. «RAL 7016»
      priceFrom: priceFrom
    });
  };
  // общий API для страницы корзины
  window.__spCart = { read: read, write: write, count: count, setQty: setQty, del: del, clear: clearAll, update: update, esc: esc, cartURL: cartURL, siteBase: siteBase.href };

  var badge = tools.querySelector('#cartCount');
  function renderBadge() {
    var n = count();
    if (badge) { badge.textContent = n; badge.classList.toggle('on', n > 0); }
  }
  var okToast = wrap.querySelector('#addCartOk');
  var toastT;
  function toast() {
    if (!okToast) return; okToast.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { okToast.classList.remove('on'); }, 2600);
  }

  /* инъекция кнопки «В корзину» на страницах товара */
  var ppActions = document.querySelector('.pp-actions');
  if (ppActions && !ppActions.querySelector('.btn-cart')) {
    var b = document.createElement('button');
    b.className = 'btn btn-cart'; b.type = 'button';
    b.innerHTML = 'В корзину';
    b.addEventListener('click', function () { addToCartFromPage(b); });
    ppActions.insertBefore(b, ppActions.firstChild);
    // Art Déco: «В корзину» — золотая (главная); «Запросить КП» — тонкая белая, ведёт к форме; «Позвонить» убираем
    if (document.querySelector('.gallery.ad-tint')) {
      ppActions.classList.add('pp-actions-ad');
      b.classList.add('btn-gold');
      var tel = ppActions.querySelector('a[href^="tel:"]'); if (tel) tel.remove();
      Array.prototype.forEach.call(ppActions.querySelectorAll('.btn'), function (x) {
        if (x !== b && /запрос/i.test(x.textContent)) {
          x.classList.remove('btn-gold'); x.classList.add('btn-kp');
          x.removeAttribute('onclick');
          x.addEventListener('click', function (e) { e.preventDefault(); var f = document.querySelector('.formpanel'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        }
      });
    }
  }

  /* прикрепление файла (чертёж/ТЗ) в формах заявки — drag&drop + лимит; готово под будущую CRM */
  (function () {
    var MAX = 10 * 1024 * 1024;  // 10 МБ
    var ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.zip';
    var forms = document.querySelectorAll('form[onsubmit*="submitLead"]');
    Array.prototype.forEach.call(forms, function (form) {
      if (form.querySelector('.lead-file')) return;
      var wrap = document.createElement('div');
      wrap.className = 'field lead-file';
      wrap.innerHTML = '<label>Прикрепить файл (чертёж, ТЗ, план) — необязательно</label>' +
        '<div class="filedrop" tabindex="0" role="button" aria-label="Прикрепить файл">' +
        '<input type="file" name="attachment" accept="' + ACCEPT + '" hidden>' +
        '<span class="filedrop-txt"><b>Перетащите файл</b> сюда или нажмите<small>до 10 МБ · PDF, JPG, PNG, DWG, DOC, XLS, ZIP</small></span></div>';
      var submit = form.querySelector('button[type="submit"], .btn[type="submit"], button.btn-block');
      if (submit) form.insertBefore(wrap, submit); else form.appendChild(wrap);
      var drop = wrap.querySelector('.filedrop'), input = wrap.querySelector('input[type="file"]'), txt = wrap.querySelector('.filedrop-txt');
      function setFile(file) {
        if (!file) return;
        if (file.size > MAX) { drop.classList.add('err'); drop.classList.remove('has'); txt.innerHTML = '<b>Файл больше 10 МБ</b><small>' + file.name + ' — выберите файл поменьше</small>'; input.value = ''; return; }
        drop.classList.remove('err'); drop.classList.add('has');
        txt.innerHTML = '<b>' + file.name + '</b><small>' + Math.round(file.size / 1024) + ' КБ · прикреплён · <span class="filedrop-x">убрать</span></small>';
        form.__attachment = file;  // ссылка для будущей отправки в CRM
      }
      drop.addEventListener('click', function (e) { if (e.target.closest('.filedrop-x')) { e.stopPropagation(); input.value = ''; form.__attachment = null; drop.classList.remove('has', 'err'); txt.innerHTML = '<b>Перетащите файл</b> сюда или нажмите<small>до 10 МБ · PDF, JPG, PNG, DWG, DOC, XLS, ZIP</small>'; return; } input.click(); });
      drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      input.addEventListener('change', function () { setFile(input.files[0]); });
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
      ['dragleave', 'dragend', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
      drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) { try { input.files = e.dataTransfer.files; } catch (_) {} setFile(f); } });
    });
  })();

  /* ================= ПОИСК ================= */
  var searchOv = wrap.querySelector('#searchOv'), input = wrap.querySelector('#searchInput'),
      results = wrap.querySelector('#searchResults'), INDEX = null, sel = -1;
  function openSearch() {
    searchOv.classList.add('on'); setTimeout(function () { input.focus(); }, 60);
    if (!INDEX) fetch(new URL('assets/products.json', siteBase)).then(function (r) { return r.json(); })
      .then(function (d) { INDEX = d; if (input.value) run(); }).catch(function () { INDEX = []; });
  }
  function closeSearch() { searchOv.classList.remove('on'); }
  tools.querySelector('#hSearch').addEventListener('click', openSearch);
  wrap.querySelector('#searchX').addEventListener('click', closeSearch);
  searchOv.addEventListener('click', function (e) { if (e.target === searchOv) closeSearch(); });
  function norm(s) { return (s || '').toLowerCase().replace(/ё/g, 'е'); }
  function run() {
    var q = norm(input.value.trim()); sel = -1;
    if (!q) { results.innerHTML = ''; return; }
    if (!INDEX) { results.innerHTML = '<div class="sr-empty">Загрузка…</div>'; return; }
    var terms = q.split(/\s+/);
    var hits = INDEX.filter(function (p) {
      var hay = norm(p.n + ' ' + (p.c || '') + ' ' + (p.k || ''));
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    }).slice(0, 12);
    if (!hits.length) { results.innerHTML = '<div class="sr-empty">Ничего не найдено. Попробуйте «скамейка», «урна», артикул.</div>'; return; }
    results.innerHTML = hits.map(function (p) {
      return '<a class="sr-item" href="' + new URL(p.u, siteBase).href + '">' +
        (p.i ? '<img class="sr-thumb" src="' + new URL(p.i, siteBase).href + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="sr-thumb"></span>') +
        '<span class="sr-tx"><b>' + esc(p.n) + '</b><span>' + esc(p.c || '') + '</span></span></a>';
    }).join('');
  }
  input.addEventListener('input', run);
  input.addEventListener('keydown', function (e) {
    var items = results.querySelectorAll('.sr-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); }
    else if (e.key === 'Enter') { if (items[sel]) items[sel].click(); return; }
    else return;
    items.forEach(function (it, i) { it.classList.toggle('sel', i === sel); });
    if (items[sel]) items[sel].scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSearch();
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openSearch(); }
  });

  renderBadge();
})();

/* ── страница корзины /cart/: список, количество, заявка ── */
(function () {
  var itemsBox = document.getElementById('cartItems');
  if (!itemsBox || !window.__spCart) return;
  var C = window.__spCart;
  var side = document.getElementById('cartSide');
  var titleCount = document.getElementById('cartTitleCount');
  var sumPos = document.getElementById('sumPos');
  var sumQty = document.getElementById('sumQty');
  var itemsTa = document.getElementById('cartFormItems');
  var sumMoney = document.getElementById('sumMoney');

  function money(n) { return (n || 0).toLocaleString('ru-RU') + ' ₽'; }
  function est(i) { return i.price > 0 ? i.price : (i.priceFrom || 0); }   // цена или справочная «от» (ориентировочно)
  function lineList(c) {
    return 'Список для расчёта:\n' + c.map(function (i) {
      var head = '• ' + i.name + (i.ral ? ' (' + i.ral + ')' : '') + ' — ' + i.qty + ' шт';
      if (i.price > 0) return head + ' × ' + money(i.price) + ' = ' + money(i.price * i.qty);
      if (i.priceFrom > 0) return head + ' — ориентировочно от ' + money(i.priceFrom) + '/шт';
      return head + ' — цена по запросу';
    }).join('\n');
  }
  function updateSums() {
    var c = C.read(); var grand = 0, anyReq = false;
    var rows = itemsBox.querySelectorAll('.cartp-item');
    c.forEach(function (i) {
      var u = est(i); var s = u * i.qty; grand += s; if (!(u > 0)) anyReq = true;
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].dataset.id === i.id) {
          var sn = rows[r].querySelector('.ci-sum');
          if (sn) sn.textContent = u > 0 ? (i.price > 0 ? money(s) : '≈ ' + money(s)) : 'по запросу';
        }
      }
    });
    if (sumMoney) sumMoney.textContent = c.length ? money(grand) + (anyReq ? ' + по запросу' : '') : '—';
    if (itemsTa) itemsTa.value = lineList(c);
    if (window.__kpRefresh) window.__kpRefresh();     // обновить мини-превью КП
  }
  function render() {
    var c = C.read();
    var n = C.count();
    if (titleCount) titleCount.textContent = c.length ? c.length + ' поз. · ' + n + ' шт' : '';
    if (sumPos) sumPos.textContent = c.length;
    if (sumQty) sumQty.textContent = n + ' шт';
    if (side) side.classList.toggle('is-empty', !c.length);

    if (!c.length) {
      itemsBox.innerHTML =
        '<div class="cartp-empty reveal in">' +
        '<svg viewBox="0 0 24 24"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>' +
        '<h2>Список пока пуст</h2>' +
        '<p>Добавляйте изделия кнопкой «В корзину» — соберём их в одну заявку<br>и рассчитаем КП по объёму, цвету RAL и доставке.</p>' +
        '<div class="cartp-empty-act"><a class="btn btn-primary" href="' + new URL('maf/index.html', C.siteBase).href + '">Каталог МАФ</a>' +
        '<a class="btn" href="' + new URL('ograzhdeniya/index.html', C.siteBase).href + '">Ограждения</a></div></div>';
      updateSums();
      return;
    }
    itemsBox.innerHTML = c.map(function (i, idx) {
      var img = i.img ? '<img src="' + C.esc(i.img) + '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'noimg\')">' : '';
      var open = i.url ? ' href="' + C.esc(i.url) + '"' : '';
      var meta = 'Артикул ' + C.esc(i.id) + (i.ral ? ' · ' + C.esc(i.ral) : '');
      var ph = i.priceFrom > 0 ? 'от ' + i.priceFrom.toLocaleString('ru-RU') : 'цена';
      var u = est(i);
      var sumTxt = u > 0 ? (i.price > 0 ? money(u * i.qty) : '≈ ' + money(u * i.qty)) : 'по запросу';
      return '<div class="cartp-item" data-id="' + C.esc(i.id) + '" style="--i:' + idx + '">' +
        '<a class="ci-ph' + (i.img ? '' : ' noimg') + '"' + open + '>' + img + '</a>' +
        '<div class="ci-main">' +
          '<a class="ci-name"' + open + '>' + C.esc(i.name) + '</a>' +
          '<small>' + meta + '</small>' +
          '<div class="ci-ctrl">' +
            '<span class="cart-qty"><button type="button" data-q="-1" aria-label="Меньше">−</button><span>' + i.qty + '</span><button type="button" data-q="1" aria-label="Больше">+</button></span>' +
            '<label class="ci-price">Цена/ед <input type="text" inputmode="numeric" data-price value="' + (i.price || '') + '" placeholder="' + ph + '"><span>₽</span></label>' +
            '<span class="ci-sum">' + sumTxt + '</span>' +
            '<button class="ci-del" type="button" data-del>Убрать</button>' +
          '</div>' +
        '</div></div>';
    }).join('') +
    '<div class="cartp-tools"><button class="ci-del" type="button" id="cartClear">Очистить весь список</button></div>';
    updateSums();
  }

  itemsBox.addEventListener('click', function (e) {
    var row = e.target.closest('.cartp-item');
    var q = e.target.closest('[data-q]');
    var d = e.target.closest('[data-del]');
    if (q && row) { C.setQty(row.dataset.id, parseInt(q.dataset.q, 10)); render(); }
    else if (d && row) {
      row.classList.add('out');
      setTimeout(function () { C.del(row.dataset.id); render(); }, 240);
    } else if (e.target.closest('#cartClear')) {
      if (confirm('Очистить весь список?')) { C.clear(); render(); }
    }
  });
  // редактирование цены за единицу — без ре-рендера (не теряем фокус)
  itemsBox.addEventListener('input', function (e) {
    var pin = e.target.closest('[data-price]'); if (!pin) return;
    var row = e.target.closest('.cartp-item'); if (!row) return;
    C.update(row.dataset.id, { price: parseInt(pin.value.replace(/[^\d]/g, ''), 10) || 0 });
    updateSums();
  });

  /* ── КП: анимированный предпросмотр + шторка с «генерацией» + лид-гейт ── */
  (function wireKpGen() {
    var gen = document.getElementById('kpGen');
    if (!gen) return;
    var HEAD_KEY = 'sp_kp_head_v1', LEADS_KEY = 'sp_leads_v1';
    var stage = document.getElementById('kpvStage');
    var form = document.getElementById('kpForm');
    var nameEl = document.getElementById('kpName');
    var phoneEl = document.getElementById('kpPhone');
    var emailEl = document.getElementById('kpEmail');
    var addrEl = document.getElementById('kpAddressee');   // компания → «Кому» в КП
    var okBox = document.getElementById('kpOk');
    var base = C.siteBase || (location.origin + '/');

    function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    // № КП уникален по дате+времени (до секунды) — не путается между заявками и устройствами
    function autoNum() { var d = new Date(), p = function (n) { return ('0' + n).slice(-2); }; return 'КП-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

    // префилл контактов (если уже оставляли)
    var saved = {}; try { saved = JSON.parse(localStorage.getItem(HEAD_KEY)) || {}; } catch (e) {}
    if (nameEl) nameEl.value = saved.name || '';
    if (phoneEl) phoneEl.value = saved.phone || '';
    if (emailEl) emailEl.value = saved.email || '';
    if (addrEl) addrEl.value = saved.addressee || '';

    /* — сцены «генерации» КП: тёмный чертёжный скелет в стиле сайта, всё рисуется
         оранжевыми линиями (обложка → ведомость → лист изделия → условия) — */
    function scenesHtml(items) {
      var first = items[0] || {};
      var num = autoNum();
      function draw(extra) { return 'class="k2d' + (extra ? ' ' + extra : '') + '" pathLength="100"'; }
      // ведомость: строка = линия-имя (реальное название) + янтарная плашка цены
      var rows = items.slice(0, 5).map(function (it, i) {
        var price = it.price || it.priceFrom || 0;
        return '<div class="k2-row" style="animation-delay:' + (0.3 + i * 0.24) + 's">' +
          '<span class="k2-ri">' + (i + 1) + '</span>' +
          '<span class="k2-rn">' + esc(it.name) + '</span>' +
          '<span class="k2-rq">×' + (it.qty || 1) + '</span>' +
          '<span class="k2-rp">' + (price ? money(price * (it.qty || 1)) + ' ₽' : '—') + '</span></div>';
      }).join('');
      var more = items.length > 5 ? '<div class="k2-more" style="animation-delay:' + (0.3 + 5 * 0.24) + 's">+ ещё ' + (items.length - 5) + ' позиций</div>' : '';
      var total = 0;
      items.forEach(function (it) { total += (it.price || it.priceFrom || 0) * (it.qty || 1); });
      return '' +
        // сцена 0 — обложка: рамка фото рисуется штрихом, заголовок печатается
        '<div class="kpv-sc" data-sc="0">' +
          '<div class="k2-hd"><span class="k2-logo"><b>EGOE</b> · завод</span><span class="k2-num">№ ' + num + '</span></div>' +
          '<svg class="k2-svg" viewBox="0 0 270 132" fill="none">' +
            '<rect ' + draw() + ' x="6" y="6" width="258" height="120" rx="3"/>' +
            '<line ' + draw('k2d2') + ' x1="6" y1="6" x2="264" y2="126"/>' +
            '<line ' + draw('k2d2') + ' x1="264" y1="6" x2="6" y2="126"/>' +
            '<circle ' + draw('k2d3') + ' cx="135" cy="66" r="24"/>' +
          '</svg>' +
          '<div class="k2-h1"><span class="kpv-t">КОММЕРЧЕСКОЕ</span><br><span class="kpv-t kpv-t2 am">ПРЕДЛОЖЕНИЕ</span></div>' +
          '<div class="k2-bar" style="animation-delay:1.45s;width:58%"></div>' +
          '<div class="k2-bar" style="animation-delay:1.6s;width:40%"></div>' +
        '</div>' +
        // сцена 1 — ведомость: строки вписываются, итог подчёркивается
        '<div class="kpv-sc" data-sc="1">' +
          '<div class="k2-hd"><span class="k2-logo"><b>EGOE</b></span><span class="k2-cap">Ведомость изделий</span></div>' +
          rows + more +
          '<div class="k2-tot" style="animation-delay:' + (0.45 + Math.min(items.length, 5) * 0.24) + 's"><span>итого</span><b>' + (total ? money(total) + ' ₽' : 'по запросу') + '</b></div>' +
        '</div>' +
        // сцена 2 — лист изделия: чертёжная сетка, контур изделия и размерные линии
        '<div class="kpv-sc" data-sc="2">' +
          '<div class="k2-hd"><span class="k2-logo"><b>EGOE</b></span><span class="k2-cap">Лист изделия · ' + esc(first.id || '') + '</span></div>' +
          '<svg class="k2-svg k2-grid" viewBox="0 0 270 150" fill="none">' +
            '<rect ' + draw() + ' x="52" y="22" width="110" height="86" rx="2"/>' +
            '<line ' + draw('k2d2') + ' x1="52" y1="50" x2="162" y2="50"/>' +
            '<line ' + draw('k2d2') + ' x1="88" y1="22" x2="88" y2="108"/>' +
            '<circle ' + draw('k2d3') + ' cx="212" cy="52" r="20"/>' +
            '<line ' + draw('k2d3') + ' x1="52" y1="126" x2="162" y2="126"/>' +
            '<line ' + draw('k2d3') + ' x1="52" y1="120" x2="52" y2="132"/>' +
            '<line ' + draw('k2d3') + ' x1="162" y1="120" x2="162" y2="132"/>' +
          '</svg>' +
          '<div class="k2-bar" style="animation-delay:1.1s;width:84%"></div>' +
          '<div class="k2-bar" style="animation-delay:1.25s;width:70%"></div>' +
          '<div class="k2-bar am" style="animation-delay:1.45s;width:34%"></div>' +
        '</div>' +
        // сцена 3 — условия и контакты: строки + круглый штамп дорисовывается
        '<div class="kpv-sc" data-sc="3">' +
          '<div class="k2-hd"><span class="k2-logo"><b>EGOE</b></span><span class="k2-cap">Условия и контакты</span></div>' +
          '<div class="k2-bar" style="animation-delay:.2s;width:90%"></div>' +
          '<div class="k2-bar" style="animation-delay:.35s;width:78%"></div>' +
          '<div class="k2-bar" style="animation-delay:.5s;width:84%"></div>' +
          '<div class="k2-bar" style="animation-delay:.65s;width:52%"></div>' +
          '<svg class="k2-svg k2-stamp" viewBox="0 0 270 96" fill="none">' +
            '<line ' + draw('k2d2') + ' x1="14" y1="66" x2="120" y2="66"/>' +
            '<circle ' + draw('k2d2') + ' cx="206" cy="48" r="34"/>' +
            '<circle ' + draw('k2d3') + ' cx="206" cy="48" r="24"/>' +
          '</svg>' +
          '<div class="k2-sign" style="animation-delay:1.3s">EGOE · Балаково · отгрузка по всей России</div>' +
        '</div>';
    }

    /* — плеер сцен: .on запускает CSS-анимации; смена сцены = пересоздание узла (рестарт) — */
    function makePlayer(stageEl) {
      var timer = null, idx = 0, html = '';
      function show(i) {
        var scs = stageEl.querySelectorAll('.kpv-sc');
        if (!scs.length) return;
        idx = i % scs.length;
        scs.forEach(function (sc, j) {
          if (j === idx) { var fresh = sc.cloneNode(true); sc.parentNode.replaceChild(fresh, sc); fresh.classList.add('on'); }
          else sc.classList.remove('on');
        });
      }
      return {
        set: function (items) { html = scenesHtml(items); stageEl.innerHTML = html; },
        show: show,
        loop: function () { this.stop(); show(0); timer = setInterval(function () { show(idx + 1); }, 3600); },
        stop: function () { if (timer) { clearInterval(timer); timer = null; } }
      };
    }
    var pv = stage ? makePlayer(stage) : null;

    var refreshT, lastKey = '';
    function refreshPreview() {
      if (!pv) return;
      clearTimeout(refreshT);
      refreshT = setTimeout(function () {
        var c = C.read(); if (!c.length) { pv.stop(); stage.innerHTML = ''; lastKey = ''; return; }
        var key = JSON.stringify(c.map(function (i) { return [i.id, i.qty, i.price]; }));
        if (key === lastKey) return;
        lastKey = key;
        pv.set(c); pv.loop();
      }, 350);
    }
    window.__kpRefresh = refreshPreview;
    refreshPreview();

    /* — шторка с настоящим КП — */
    var drawer = document.getElementById('kpDrawer');
    var dFrame = document.getElementById('kpdFrame');
    var dStage = document.getElementById('kpdStage');
    var dFilm = document.getElementById('kpdFilm');
    var dStatus = document.getElementById('kpdStatus');
    var dProg = document.getElementById('kpdProg');
    var dNum = document.getElementById('kpdNum');
    var dGenbar = document.getElementById('kpdGenbar');
    var dGbStatus = document.getElementById('kpdGbStatus');
    var dGbFilm = document.getElementById('kpdGbFilm');
    var dGbProg = document.getElementById('kpdGbProg');
    var dPlayer = dStage ? makePlayer(dStage) : null;
    var genTimers = [];
    var GEN_KEY = 'sp_kp_generated_v1'; // какой состав КП уже «сгенерирован» — второй раз не пересобираем
    var lastGenKey = '', gbStage = '', gbTotal = 0;
    function hashStr(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
    function cartGenKey(items) { return hashStr(JSON.stringify(items.map(function (i) { return [i.id, i.qty, i.price || 0]; }))); }

    /* — полоса генерации над документом: статус + чипы готовых разделов + прогресс — */
    var GB_LABELS = { cover: 'обложка', ledger: 'ведомость', product: 'листы изделий', terms: 'условия' };
    function gbReset(n) {
      gbStage = ''; gbTotal = n;
      if (!dGenbar) return;
      dGenbar.hidden = true; dGenbar.classList.remove('off', 'done');
      if (dGbFilm) dGbFilm.innerHTML = '';
      if (dGbStatus) dGbStatus.textContent = 'Пишем обложку…';
      if (dGbProg) dGbProg.style.width = '4%';
    }
    function gbChip(stage, pn) {
      if (!dGbFilm || !stage) return;
      var th = document.createElement('span');
      th.className = 'gb-th';
      th.textContent = '✓ ' + GB_LABELS[stage] + (stage === 'product' && pn > 1 ? ' · ' + pn : '');
      dGbFilm.appendChild(th);
    }
    var pendingBuilt = null; // вызывается, когда КП-iframe сообщил, что макет собран (для быстрого показа)
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return;
      var m = e.data && e.data.kpStream;
      if (!m || !dGenbar) return;
      if (m.built) { if (pendingBuilt) { var f = pendingBuilt; pendingBuilt = null; f(); } return; }
      if (m.done) {
        gbChip(gbStage, gbTotal); gbStage = '';
        if (dGbStatus) dGbStatus.textContent = 'Документ готов';
        if (dGbProg) dGbProg.style.width = '100%';
        dGenbar.classList.add('done');
        try { localStorage.setItem(GEN_KEY, lastGenKey); } catch (e2) {}
        setTimeout(function () { dGenbar.classList.add('off'); }, 1600);
        return;
      }
      if (m.stage !== gbStage) { gbChip(gbStage, m.pn || gbTotal); gbStage = m.stage; }
      if (dGbStatus) dGbStatus.textContent =
        m.stage === 'cover' ? 'Пишем обложку…'
        : m.stage === 'ledger' ? 'Заполняем ведомость…'
        : m.stage === 'product' ? ('Верстаем лист изделия ' + m.pi + ' из ' + m.pn + '…')
        : 'Условия и контакты…';
      if (dGbProg && m.n) dGbProg.style.width = Math.max(4, Math.round(100 * m.si / m.n)) + '%';
    });

    function openDrawer() {
      if (!drawer) { window.open(new URL('kp/index.html', base).href, '_blank'); return; }
      var items = C.read();
      var genKey = cartGenKey(items);
      var already = false;
      try { already = localStorage.getItem(GEN_KEY) === genKey; } catch (e) {}
      drawer.classList.remove('ready');
      drawer.classList.add('open');
      document.documentElement.classList.add('kpd-lock');
      if (dNum) dNum.textContent = autoNum() + ' · ' + today().split('-').reverse().join('.');
      genTimers.forEach(clearTimeout); genTimers = [];

      // Первая генерация: документ «печатается» потоково прямо в КП (стрим из iframe),
      // повтор того же состава — открывается сразу, без генератора.
      lastGenKey = genKey;
      var minDone = false, loaded = false, revealed = false;
      function tryReveal() {
        if (revealed || !loaded || !minDone) return;
        revealed = true;
        if (already) {
          if (dProg) dProg.style.width = '100%';
          if (dStatus) dStatus.textContent = 'Документ готов';
          try { localStorage.setItem(GEN_KEY, genKey); } catch (e) {}
        } else if (dGenbar) {
          dGenbar.hidden = false; dGenbar.classList.remove('off', 'done');
        }
        genTimers.push(setTimeout(function () { drawer.classList.add('ready'); if (dPlayer) dPlayer.stop(); }, already ? 380 : 150));
      }

      if (already) {
        // повторное открытие того же КП: генератор не запускается, документ сразу
        if (dFilm) dFilm.innerHTML = '';
        if (dStage) dStage.innerHTML = '';
        if (dStatus) dStatus.textContent = 'КП уже собрано — открываем…';
        if (dProg) { dProg.style.transition = 'none'; dProg.style.width = '100%'; }
        genTimers.push(setTimeout(function () { minDone = true; tryReveal(); }, 400));
      } else {
        // первая генерация: короткая заставка, дальше документ СОБИРАЕТСЯ плавно в самом КП
        minDone = true;
        pendingBuilt = null;
        if (dFilm) dFilm.innerHTML = '';
        if (dPlayer) { dPlayer.set(items); dPlayer.show(0); }
        if (dStatus) dStatus.textContent = 'Запускаем генератор…';
        if (dProg) { dProg.style.transition = 'none'; dProg.style.width = '0'; void dProg.offsetWidth; dProg.style.transition = 'width 2.5s ease'; dProg.style.width = '40%'; }
        gbReset(items.length);
        // когда iframe сообщит «макет готов» — показываем документ и командуем начать плавную сборку
        pendingBuilt = function () {
          loaded = true; tryReveal();
          setTimeout(function () { try { dFrame.contentWindow.postMessage({ kpGo: true }, location.origin); } catch (e2) {} }, 220);
        };
      }

      // настоящее КП грузится параллельно; тот же состав уже загружен (в т.ч. после стрима) — не перезагружаем
      var target = new URL('kp/index.html?embed=1' + (already ? '' : '&stream=1') + '&_=' + genKey, base).href;
      if (dFrame.dataset.loaded === '1' && dFrame.src.indexOf('_=' + genKey) > -1) {
        loaded = true; tryReveal();
        if (!already) setTimeout(function () { try { dFrame.contentWindow.postMessage({ kpGo: true }, location.origin); } catch (e2) {} }, 220);
      } else {
        dFrame.dataset.loaded = '';
        dFrame.onload = function () { dFrame.dataset.loaded = '1'; loaded = true; tryReveal(); };
        dFrame.src = target;
      }
      genTimers.push(setTimeout(function () { loaded = true; tryReveal(); }, 12000)); // страховка
      var tab = document.getElementById('kpdOpenTab');
      if (tab) tab.href = new URL('kp/index.html', base).href;
    }
    function closeDrawer() {
      if (!drawer) return;
      drawer.classList.remove('open');
      document.documentElement.classList.remove('kpd-lock');
      genTimers.forEach(clearTimeout); genTimers = [];
      if (dPlayer) dPlayer.stop();
    }
    var xBtn = document.getElementById('kpdClose'), backEl = document.getElementById('kpdBack');
    if (xBtn) xBtn.addEventListener('click', closeDrawer);
    if (backEl) backEl.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
    var pdfBtn = document.getElementById('kpdPdf');
    if (pdfBtn) pdfBtn.addEventListener('click', function () {
      try { dFrame.contentWindow.focus(); dFrame.contentWindow.print(); } catch (e) { window.open(new URL('kp/index.html', base).href, '_blank'); }
    });
    var reopen = document.getElementById('kpReopen');
    if (reopen) reopen.addEventListener('click', function (e) { e.preventDefault(); openDrawer(); });

    function digits(s) { return (s || '').replace(/\D/g, ''); }
    function markInvalid(el) { el.classList.add('kp-invalid'); setTimeout(function () { el.classList.remove('kp-invalid'); }, 2500); }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = (nameEl.value || '').trim(), phone = (phoneEl.value || '').trim(), company = (addrEl.value || '').trim();
      var email = emailEl ? (emailEl.value || '').trim() : '';
      var bad = null;
      if (!name) { markInvalid(nameEl); bad = bad || nameEl; }
      if (digits(phone).length < 10) { markInvalid(phoneEl); bad = bad || phoneEl; }
      if (emailEl && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { markInvalid(emailEl); bad = bad || emailEl; }
      if (bad) { bad.focus(); return; }

      // шапка КП: адресат = компания или имя; №/дата — авто
      var head = { name: name, phone: phone, email: email, addressee: company || name, object: '', number: autoNum(), date: today() };
      try { localStorage.setItem(HEAD_KEY, JSON.stringify(head)); } catch (e2) {}

      // лид: отправляем на e-mail/Telegram + дублируем локально как резерв
      try {
        var items = C.read(), grand = 0, anyReq = false;
        var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
        var itemsTxt = (items || []).map(function (it) {
          var u = it.price > 0 ? it.price : (it.priceFrom || 0), q = it.qty || 1;
          if (u > 0) grand += u * q; else anyReq = true;
          return '• ' + (it.name || it.id) + (it.ral ? ' (' + it.ral + ')' : '') + ' — ' + q + ' шт' + (u > 0 ? ' × ' + fmt(u) + ' = ' + fmt(u * q) + ' ₽' : ' · по запросу');
        }).join('\n');
        var totalTxt = grand > 0 ? (anyReq ? '≈ ' + fmt(grand) + ' ₽ (часть по запросу)' : fmt(grand) + ' ₽') : 'по запросу';
        if (window.__sendLead) window.__sendLead({ 'Имя': name, 'Телефон': phone, 'E-mail': email, 'Компания': company, 'Позиции': '\n' + itemsTxt, 'Итого': totalTxt, '№ КП': head.number }, 'КП');
      } catch (e3) {}
      try {
        var leads = JSON.parse(localStorage.getItem(LEADS_KEY)) || [];
        leads.push({ ts: Date.now(), name: name, phone: phone, email: email, company: company, items: C.read() });
        localStorage.setItem(LEADS_KEY, JSON.stringify(leads));
      } catch (e4) {}

      openDrawer();
      if (okBox) okBox.style.display = 'block';
    });
  })();

  render();
})();

/* ── главная: колесо заказа v3 ──
   ОСНОВНАЯ информация шага (номер + заголовок) закреплена НА колесе и уезжает
   вместе с его вращением; следующая подъезжает по дуге. Когда шаг встал в паз —
   проявляется ДОП (описание + смета/форма/чертёж/фото).
   Десктоп: колесо слева. Мобилка: колесо ВНИЗУ, блоки едут по дуге горизонтально. */
(function () {
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

  function chips(a) { return '<div class="fw-chips">' + a.map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</div>'; }
  function mediaFor(k) {
    var cur = '<div class="fw-cur" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 3l14 8-6.5 1.5L16 19l-3 1.6-3.4-6.4L5 18z"/></svg></div>';
    if (k === 'choose') {
      // каркас: корзина в углу (вне камеры) + камера с сеткой + УПРОЩЁННАЯ страница товара (по клику) + крупный курсор
      var A = 'assets/img/artdeco/skamejki/a1-101/';
      return '<div class="fw-catalog">' +
        '<button class="fw-catcart" type="button" aria-label="Перейти к заявке и расчёту">' +
          '<svg viewBox="0 0 24 24"><path d="M3.5 5h2.2l2 10h9.4l1.9-7.2H7"/><circle cx="9.5" cy="19" r="1.35"/><circle cx="16.5" cy="19" r="1.35"/></svg>' +
          '<b class="fw-catcart-cnt" data-cnt>0</b></button>' +
        '<div class="fw-cam"><div class="fw-cgrid"></div></div>' +
        '<div class="fw-pp" aria-hidden="true"><div class="fw-pp-scroll">' +
          '<div class="fw-pp-top">' +
            '<div class="fw-pp-gallery">' +
              '<div class="fw-pp-hero"><img class="fw-pp-heroimg" src="' + A + 'hero.webp?i15" alt="Скамейка A1-101 Art Déco"><span class="fw-pp-hlabel">A1-101 · карточка</span></div>' +
              '<div class="fw-pp-thumbs">' +
                '<span class="fw-pp-th on" data-cap="A1-101 · карточка"><img src="' + A + 'hero.webp?i15" alt="Скамейка A1-101 — карточка"><i>карточка</i></span>' +
                '<span class="fw-pp-th" data-cap="A1-101 · на объекте"><img src="' + A + 'life1.webp" alt="Скамейка A1-101 — на объекте"><i>на объекте</i></span>' +
                '<span class="fw-pp-th" data-cap="A1-101 · фасад"><img src="' + A + 'facade1.webp?i15" alt="Скамейка A1-101 — фасад"><i>фасад</i></span>' +
                '<span class="fw-pp-th" data-cap="A1-101 · в среде"><img src="' + A + 'life2.webp" alt="Скамейка A1-101 — в среде"><i>в среде</i></span>' +
              '</div>' +
            '</div>' +
            '<div class="fw-pp-info">' +
              '<em class="fw-pp-tag">Art Déco · коллекция A</em>' +
              '<b class="fw-pp-title">Скамейка A1-101</b>' +
              '<span class="fw-pp-art">Артикул A1-101 · сталь · порошок RAL</span>' +
              '<span class="fw-pp-price">от 44 500 ₽</span>' +
              '<span class="fw-pp-note">точная цена — по цвету RAL, комплектации и партии</span>' +
              '<div class="fw-pp-ral"><span class="on" style="background:#383E42"></span><span style="background:#0A0A0C"></span><span style="background:#8d8577"></span><span style="background:#114232"></span></div>' +
              '<span class="fw-pp-cta">В корзину</span>' +
            '</div>' +
          '</div>' +
          '<div class="fw-pp-3d"><div class="fw-pp-3d-bar"><b>3D-визуализация · чертёж</b><span>тяните ⇄ вращайте</span></div>' +
            '<div class="fw-pp-3d-stage" data-glb="assets/models/a1101-web.glb">' +
              '<img class="fw-pp-3dimg" src="' + A + 'drawing-line.svg" alt="3D-чертёж A1-101">' +
              '<span class="fw-pp-3dhint">живой 3D · тяните, чтобы вращать</span>' +
            '</div></div>' +
        '</div></div>' +
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
    if (k === 'contract') return '<div class="fw-flow2 fw-ctr">' +
      '<div class="fw-att-zone"><div class="ctr-cart">' +
        '<div class="ctr-cart-h"><b>Корзина</b><span>3 позиции · 26 ед.</span></div>' +
        '<div class="ctr-item" data-row="0"><span class="ctr-th"><img src="assets/img/artdeco/lezhaki/a1-2661/card.webp?i10" alt="Лежак Art Déco A1-2661" loading="lazy"></span><div class="ctr-it-tx"><b>Лежак A1-2661</b><span>Art Déco · RAL 6021 · 12 шт</span></div><i class="ctr-dot"></i></div>' +
        '<div class="ctr-item" data-row="1"><span class="ctr-th"><img src="assets/img/maf/skamejki/9467/main.webp" alt="Скамейка A4-2641" loading="lazy"></span><div class="ctr-it-tx"><b>Скамейка A4-2641</b><span>RAL 7016 · 8 шт</span></div><i class="ctr-dot"></i></div>' +
        '<div class="ctr-item" data-row="2"><span class="ctr-th"><img src="assets/img/korziny/standart/STN03-treugolnik/main.webp" alt="Корзина STN-03" loading="lazy"></span><div class="ctr-it-tx"><b>Корзина STN-03</b><span>RAL 9005 · 6 шт</span></div><i class="ctr-dot"></i></div>' +
        '<div class="fw-checklist">' +
          '<div class="fw-ck"><i></i>Работа по 44-ФЗ и 223-ФЗ · НДС 22%</div>' +
          '<div class="fw-ck"><i></i>Спецификация и КМД в приложении</div>' +
          '<div class="fw-ck"><i></i>Гарантия 24 месяца</div>' +
        '</div>' +
      '</div></div>' +
      '<div class="fw-win fw-docwin"><div class="fw-win-bar"><i></i><i></i><i></i><b>договор.pdf</b><span class="ctr2-pg">формируется…</span></div>' +
      '<div class="fw-win-body"><div class="ctr2-track"><span class="ctr2-fill"></span></div>' +
        '<div class="ctr2-stack">' +
          '<div class="ctr2-page" data-p="0"><b class="ctr2-h">Договор поставки № 214</b>' +
            '<u class="ctr2-l" style="width:96%"></u><u class="ctr2-l" style="width:90%"></u><u class="ctr2-l" style="width:82%"></u><u class="ctr2-l" style="width:88%"></u><u class="ctr2-l" style="width:64%"></u>' +
            '<span class="ctr2-stamp">EGOE</span></div>' +
          '<div class="ctr2-page" data-p="1"><b class="ctr2-h">Спецификация · Прил.&nbsp;№1</b>' +
            '<span class="ctr2-row"><i class="ctr2-th"></i><u class="ctr2-l" style="width:72%"></u></span>' +
            '<span class="ctr2-row"><i class="ctr2-th"></i><u class="ctr2-l" style="width:64%"></u></span>' +
            '<span class="ctr2-row"><i class="ctr2-th"></i><u class="ctr2-l" style="width:56%"></u></span>' +
            '<u class="ctr2-l ctr2-sum" style="width:78%"></u>' +
            '<span class="ctr2-stamp">EGOE</span></div>' +
          '<div class="ctr2-page" data-p="2"><b class="ctr2-h">Гарантия · Прил.&nbsp;№2</b>' +
            '<u class="ctr2-l" style="width:92%"></u><u class="ctr2-l" style="width:80%"></u><u class="ctr2-l" style="width:86%"></u><u class="ctr2-l" style="width:70%"></u>' +
            '<span class="ctr2-stamp">EGOE</span></div>' +
        '</div>' +
      '</div></div></div>';
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
  track.style.height = (N * 92 + 16) + 'vh';
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
    var i = Math.round(pf), f = pf - i;            // -0.5..0.5
    return i + f * (0.9 + 0.1 * Math.min(1, Math.abs(f) * 2));
  }
  var tickEls = [], tickDefs = [];

  function layout() {
    W = innerWidth; H = innerHeight;
    mobile = W < 900;
    if (mobile) {
      // колесо опущено ниже (лайфхак юзера) → больше вертикального места сцене-анимации
      var crestGap = Math.min(170, Math.max(120, Math.round(H * 0.17)));
      var crest = H - crestGap;                  // верхняя точка нижнего колеса
      R = Math.max(Math.round(W * 0.8), 360);
      CX = Math.round(W / 2); CY = crest + R;
      BASE = -90; CARD_R = R + 46;
      marker.className = 'fw-marker down';
      marker.style.left = CX + 'px'; marker.style.top = (crest - 24) + 'px';
      marker.style.display = '';       // на мобиле указатель нужен (шайба стоит ниже, на диске)
      // карточка стоит на 46px выше crest и сама ~60px высотой → низ контента держим выше её верха
      sticky.style.setProperty('--fwbot', (H - crest + 104) + 'px');
      if (apBtn) { apBtn.style.left = CX + 'px'; apBtn.style.top = (crest + 24) + 'px'; }   // шайба автоплея на диске под гребнем
    } else {
      EDGE = Math.round(Math.max(150, Math.min(0.15 * W, 225)));
      R = Math.round(Math.max(H * 0.78, 540));
      CX = EDGE - R; CY = Math.round(H / 2);
      BASE = 0; CARD_R = R + 28;
      marker.className = 'fw-marker';
      marker.style.left = (EDGE + 6) + 'px'; marker.style.top = CY + 'px';
      marker.style.display = 'none';   // на ПК роль указателя берёт на себя шайба-хаб в центре дуги
      sticky.style.setProperty('--fwleft', (EDGE + 330) + 'px');
      sticky.style.setProperty('--fwbot', '90px');
      if (apBtn) { apBtn.style.left = EDGE + 'px'; apBtn.style.top = CY + 'px'; }   // шайба автоплея — в центре полукруга (на выступе дуги)
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
  // Плавная инерция (lerp) — колесо мягко, «по-масляному» догоняет цель. Без пружины и доводки.
  function frame() {
    raf = null;
    if (liteOff) return;                          /* lite: колесо заморожено в статик */
    if (reduced) { theta = targetTheta; vel = 0; apply(); return; }
    var disp = targetTheta - theta;
    theta += disp * 0.12;
    apply();
    if (Math.abs(disp) < 0.02) { theta = targetTheta; vel = 0; }
    else raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  /* ── демо-сцены шагов: печать, курсор, PDF, штамп ── */
  function makeScene(root, kind, idx) {
    var timers = [], running = false;
    // авто-переход на следующий шаг после проигрыша демо (гид-облёт: 0→1→2→3→4); на последнем шаге стоп.
    // Переход отрабатывает ТОЛЬКО при включённом автоплее (autoplayOn) — иначе шаг листает пользователь сам.
    function advance() { if (running && autoplayOn && idx != null && idx < N - 1) scrollToStep(idx + 1); }
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
      cur.style.setProperty('--cms', ms + 'ms');   // длительность только для left/top — press-скейл остаётся быстрым
      cur.style.left = (r.left - p.left + r.width * (dx == null ? 0.5 : dx)) + 'px';
      cur.style.top = (r.top - p.top + r.height * (dy == null ? 0.6 : dy)) + 'px';
    }
    var api = { start: function () {}, stop: function () {}, dur: 0 };   // dur = длительность сцены (мс) для кольца автоплея

    if (kind === 'choose') {
      var catalog = root.querySelector('.fw-catalog');
      var cam = root.querySelector('.fw-cam');
      var grid = root.querySelector('.fw-cgrid');
      var cart = root.querySelector('.fw-catcart');
      var cnt = root.querySelector('.fw-catcart-cnt');
      var ccur = root.querySelector('.fw-cur');
      var mq = window.matchMedia('(max-width:900px)');
      var PRODUCTS = [
        { cls: 'std', tag: 'Стандарт', name: 'Скамейка «Колледж»', price: 'от 19 600 ₽', img: 'assets/img/maf/skamejki/9467/white.webp', alt: 'Скамейка «Колледж» — Стандарт' },
        { cls: 'art', tag: 'Art Déco', name: 'Скамейка A1-101', price: 'от 44 500 ₽', img: 'assets/img/artdeco/skamejki/a1-101/hero.webp?i12', alt: 'Скамейка A1-101 — Art Déco' }
      ];
      function realCell(p, i) {
        return '<div class="fw-cell fw-real ' + p.cls + '" data-pk="' + i + '" style="--rd:0">' +
          '<span class="fw-thumb"><img src="' + p.img + '" alt="' + p.alt + '" loading="lazy"></span>' +
          '<em class="fw-tag">' + p.tag + '</em>' +
          '<div class="fw-pan"><b>' + p.name + '</b>' +
          '<div class="fw-pfoot"><span class="fw-price">' + p.price + '</span>' +
          '<i class="fw-add" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h2l1.7 8.5h9L18.5 8H7"/><circle cx="9.5" cy="18" r="1.3"/><circle cx="16" cy="18" r="1.3"/></svg></i></div></div></div>';
      }
      function buildGrid() {
        var m = mq.matches;
        var cols = m ? 4 : 7, rows = m ? 7 : 5, cRow = m ? 3 : 2, cA = m ? 1 : 3, cB = m ? 2 : 4;
        var html = '';
        for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
          var ring = Math.max(Math.abs(r - cRow), Math.min(Math.abs(c - cA), Math.abs(c - cB)));
          if (r === cRow && c === cA) html += realCell(PRODUCTS[0], 0);
          else if (r === cRow && c === cB) html += realCell(PRODUCTS[1], 1);
          else html += '<div class="fw-cell" style="--rd:' + ring + '"></div>';
        }
        grid.innerHTML = html;
        grid.setAttribute('data-cols', cols);
        catalog.classList.toggle('is-mobile', m);
      }
      function reals() { return grid.querySelectorAll('.fw-real'); }
      var pp = root.querySelector('.fw-pp');
      var ppScroll = root.querySelector('.fw-pp-scroll');
      var heroImg = root.querySelector('.fw-pp-heroimg');
      var thumbs = root.querySelectorAll('.fw-pp-th');
      var stage3d = root.querySelector('.fw-pp-3d-stage');
      var hlabel = root.querySelector('.fw-pp-hlabel');
      var heroSrc = heroImg ? heroImg.getAttribute('src') : '';
      var hlabelSrc = hlabel ? hlabel.textContent : '';
      var viewer = null;   // живой Three.js-объект (ленивая загрузка при первом запуске сцены)
      function ensureViewer() {
        if (viewer || !stage3d || !window.FW3D) return;
        var glb = stage3d.getAttribute('data-glb'); if (!glb) return;
        viewer = window.FW3D.mount(stage3d, glb);
      }
      function setCnt(n) {
        if (cnt) { cnt.textContent = String(n); cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump'); }
        cart.classList.toggle('has', n > 0);
      }
      function selectThumb(i) {
        var th = thumbs[i]; if (!th || !heroImg) return;
        var src = th.querySelector('img').getAttribute('src');
        var cap = th.getAttribute('data-cap');
        heroImg.classList.add('swapping');
        // смена фото не «супер-быстрая»: даём кадру мягко раствориться и проявиться
        t(function () { heroImg.src = src; if (hlabel && cap) hlabel.textContent = cap; heroImg.classList.remove('swapping'); }, 300);
        thumbs.forEach(function (x, j) { x.classList.toggle('on', j === i); });
      }
      var cta = root.querySelector('.fw-pp-cta');
      // «камера» плавно следует за курсором: параллакс-сдвиг + лёгкий наклон к цели
      function camFollow(el) {
        if (!el || !cam) return;
        var cr = catalog.getBoundingClientRect(), er = el.getBoundingClientRect();
        if (!cr.width) return;
        var cx = (er.left + er.width / 2 - cr.left) / cr.width - 0.5;
        var cy = (er.top + er.height / 2 - cr.top) / cr.height - 0.5;
        cam.style.transform = 'perspective(1000px) translate(' + (-cx * 66).toFixed(1) + 'px,' + (-cy * 46).toFixed(1) + 'px) rotateY(' + (cx * 10).toFixed(1) + 'deg) rotateX(' + (-cy * 8).toFixed(1) + 'deg) scale(1.07)';
      }
      // центральная пара стоит ВСЕГДА (её видно сразу, до анимации); каталог радиально доезжает вокруг неё
      function resetChoose() {
        grid.classList.remove('in');
        cam.classList.remove('dolly', 'will'); cam.style.transformOrigin = ''; cam.style.transform = '';
        // фото НЕ проявлены: карточки-скелетоны стоят, снимки аккуратно появятся на подъезде камеры
        reals().forEach(function (el) { el.classList.remove('filled', 'tapped'); var ad = el.querySelector('.fw-add'); if (ad) ad.classList.remove('on'); });
        if (cnt) cnt.textContent = '0';
        cart.classList.remove('has', 'press');
        ccur.classList.remove('show', 'press', 'big');
        catalog.classList.remove('to-pp');
        if (pp) pp.classList.remove('open', 'scrolled', 'spin3d');
        if (heroImg) { heroImg.classList.remove('swapping'); if (heroSrc) heroImg.src = heroSrc; }
        if (hlabel && hlabelSrc) hlabel.textContent = hlabelSrc;
        thumbs.forEach(function (x, j) { x.classList.toggle('on', j === 0); });
        if (cta) { cta.classList.remove('added'); cta.textContent = 'В корзину'; }
        if (viewer) { viewer.pause(); viewer.reset(); }
      }
      function finalState() {   // покой: видна пара карточек-скелетонов; фото проявятся при подъезде камеры
        grid.classList.remove('in');
        cam.classList.remove('dolly', 'will'); cam.style.transformOrigin = ''; cam.style.transform = '';
        reals().forEach(function (el) { el.classList.remove('filled', 'tapped'); var ad = el.querySelector('.fw-add'); if (ad) ad.classList.remove('on'); });
        if (cnt) cnt.textContent = '0';
        cart.classList.remove('has', 'press');
        ccur.classList.remove('show', 'press', 'big');
        catalog.classList.remove('to-pp');
        if (pp) pp.classList.remove('open', 'scrolled', 'spin3d');
        if (viewer) { viewer.pause(); viewer.reset(); }
      }
      var lastMob = mq.matches;
      buildGrid();
      finalState();   // сцена НЕ пустая до старта: сразу видна пара товаров
      if (reduced) { grid.classList.add('in'); reals().forEach(function (el) { el.classList.add('filled'); }); }   // без анимации — сразу весь каталог с фото
      // пересобираем сетку при смене брейкпоинта (resize/поворот) — window.resize надёжнее matchMedia change
      function onRz() { var m = mq.matches; if (m !== lastMob) { lastMob = m; buildGrid(); if (!running) finalState(); } }
      addEventListener('resize', onRz);
      if (mq.addEventListener) mq.addEventListener('change', onRz);
      // реальный клик по корзине пользователем → аккуратно доводит на шаг 2 «Заявка и расчёт»
      cart.addEventListener('click', function () { scrollToStep(1); });
      api.start = function () {
        running = true;
        ensureViewer();   // ленивая загрузка Three.js только сейчас, когда колесо доехало и играет
        (function loop() {
          if (!running) return;
          resetChoose();
          var rr = reals();
          var m = catalog.classList.contains('is-mobile');
          var T = m
            ? { addShow: 280, fillA: 430, fillB: 610, add0: 720, click: 1360, ppOpen: 1700, swap: 2320, swap2: 3080, swap3: 3820, scroll: 4300, d3d: 5100, cta: 13940, toCart: 14560, cartPress: 14840, loop: 15040 }
            : { addShow: 320, fillA: 480, fillB: 680, add0: 800, click: 1440, ppOpen: 1800, swap: 2440, swap2: 3220, swap3: 3980, scroll: 4460, d3d: 5260, cta: 14100, toCart: 14720, cartPress: 15020, loop: 15240 };
          api.dur = T.loop;   // длительность сцены выбора для кольца автоплея
          // 1) каталог радиально доезжает вокруг пары карточек-скелетонов
          grid.classList.add('in');
          // 2) камера мягко приближается к паре → фото АККУРАТНО проявляются (как было ранее)
          t(function () { if (!running) return; if (rr[0]) camFollow(rr[0]); if (cam) cam.classList.add('will'); }, T.addShow - 120);
          t(function () { if (!running) return; if (rr[0]) rr[0].classList.add('filled'); }, T.fillA);
          t(function () { if (!running) return; if (rr[1]) rr[1].classList.add('filled'); }, T.fillB);
          // крупный курсор добавляет ТОЛЬКО «Стандарт» (камера едет за курсором)
          t(function () { if (!running) return; ccur.classList.add('show', 'big'); if (rr[0]) curTo(ccur, rr[0].querySelector('.fw-add'), 440, 0.5, 0.5); }, T.addShow);
          t(function () { if (!running) return; ccur.classList.add('press'); if (rr[0]) rr[0].querySelector('.fw-add').classList.add('on'); setCnt(1); }, T.add0);
          // 3) Art Déco НЕ добавляем — курсор жмёт саму карточку → страница товара «перестраивается»
          t(function () { if (!running) return; ccur.classList.remove('press'); if (rr[1]) { curTo(ccur, rr[1], 480, 0.5, 0.42); camFollow(rr[1]); } }, T.add0 + 260);
          t(function () { if (!running) return; ccur.classList.add('press'); if (rr[1]) rr[1].classList.add('tapped'); }, T.click);
          t(function () { if (!running) return; ccur.classList.remove('press'); if (rr[1]) rr[1].classList.remove('tapped'); cam.style.transform = ''; catalog.classList.add('to-pp'); if (pp) pp.classList.add('open'); }, T.ppOpen);
          // 4) на странице товара НЕ спеша смотрит несколько фото (плавная, не супер-быстрая смена)
          t(function () { if (!running) return; if (thumbs[1]) curTo(ccur, thumbs[1], 520, 0.5, 0.5); }, T.ppOpen + 460);
          t(function () { if (!running) return; ccur.classList.add('press'); selectThumb(1); }, T.swap);
          t(function () { if (!running) return; ccur.classList.remove('press'); }, T.swap + 200);
          t(function () { if (!running) return; if (thumbs[2]) curTo(ccur, thumbs[2], 520, 0.5, 0.5); }, T.swap2 - 240);
          t(function () { if (!running) return; ccur.classList.add('press'); selectThumb(2); }, T.swap2);
          t(function () { if (!running) return; ccur.classList.remove('press'); }, T.swap2 + 200);
          t(function () { if (!running) return; if (thumbs[3]) curTo(ccur, thumbs[3], 520, 0.5, 0.5); }, T.swap3 - 240);
          t(function () { if (!running) return; ccur.classList.add('press'); selectThumb(3); }, T.swap3);
          t(function () { if (!running) return; ccur.classList.remove('press'); }, T.swap3 + 200);
          // 5) листает ниже → 3D-акт (~8.4 c, тайминги = SEGS в fw3d.js; d3d — ПОСЛЕ доезда панели .75s):
          //    900 загрузка · 2600 драг№1 (1050) · 4030 драг№2 (1150) · 5480 наезд к детали (1350) · 6830 осмотр (800)
          //    вертикаль драгов согласована с OrbitControls: курсор вниз → камера выше (ph меньше), влево → th растёт
          t(function () { if (!running) return; if (pp) pp.classList.add('scrolled'); }, T.scroll);
          t(function () { if (!running) return; if (stage3d) curTo(ccur, stage3d, 600, 0.5, 0.45); if (viewer) viewer.play(); else if (pp) pp.classList.add('spin3d'); }, T.d3d);
          t(function () { if (!running) return; ccur.classList.add('press'); if (stage3d) curTo(ccur, stage3d, 1050, 0.28, 0.52); }, T.d3d + 2600);   // драг №1: тянет влево-вниз
          t(function () { if (!running) return; ccur.classList.remove('press'); }, T.d3d + 3650);
          t(function () { if (!running) return; ccur.classList.add('press'); if (stage3d) curTo(ccur, stage3d, 1150, 0.74, 0.44); }, T.d3d + 4030);   // драг №2: обратно вправо-вверх
          t(function () { if (!running) return; ccur.classList.remove('press'); }, T.d3d + 5180);
          t(function () { if (!running) return; if (stage3d) curTo(ccur, stage3d, 1350, 0.58, 0.34); }, T.d3d + 5480);                                 // подводит взгляд к детали
          t(function () { if (!running) return; ccur.classList.add('press'); if (stage3d) curTo(ccur, stage3d, 800, 0.50, 0.35); }, T.d3d + 6830);    // рассматривает вблизи (влево = th растёт)
          t(function () { if (!running) return; ccur.classList.remove('press'); }, T.d3d + 7630);
          // 6) добавляет Art Déco В КОРЗИНУ прямо со страницы товара
          t(function () { if (!running) return; if (cta) curTo(ccur, cta, 560, 0.5, 0.5); }, T.cta - 320);
          t(function () { if (!running) return; ccur.classList.add('press'); if (cta) { cta.classList.add('added'); cta.textContent = 'Добавлено ✓'; } setCnt(2); }, T.cta);
          t(function () { if (!running) return; ccur.classList.remove('press'); }, T.cta + 170);
          // 7) идёт к корзине → нажатие → СРАЗУ на шаг 2, без промедления
          t(function () { if (!running) return; curTo(ccur, cart, 520, 0.3, 0.16); }, T.toCart);
          t(function () { if (!running) return; ccur.classList.add('press'); cart.classList.add('press'); }, T.cartPress);
          t(function () { if (!running) return; ccur.classList.remove('press'); cart.classList.remove('press'); advance(); }, T.loop);
          // страховка: если авто-переход не увёл со слайда (пользователь удержал скролл) — демо начинается заново
          t(function () { if (!running) return; loop(); }, T.loop + 3200);
        })();
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; if (viewer) { viewer.pause(); viewer.reset(); } finalState(); };
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
          api.dur = 13400;
          t(advance, 13400);
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
      var cks   = root.querySelectorAll('.fw-ck');
      var items = root.querySelectorAll('.ctr-item');
      var pages = root.querySelectorAll('.ctr2-page');
      var fill  = root.querySelector('.ctr2-fill');
      var pgLbl = root.querySelector('.ctr2-pg');
      var cflow = root.querySelector('.fw-flow2');
      var cwin  = root.querySelector('.fw-win');
      var NP = pages.length, allLines = 0;
      pages.forEach(function (p) { allLines += p.querySelectorAll('.ctr2-l, .ctr2-row').length; });
      function stackPos(active) {
        pages.forEach(function (p, i) { var dd = i - active; p.style.zIndex = (NP - Math.abs(dd));
          p.style.transform = dd < 0 ? 'translateY(-9px) scale(.965)' : dd > 0 ? 'translateY(' + (7 * dd) + 'px) scale(' + (1 - .03 * dd) + ')' : 'none';
          p.style.opacity = (dd < 0 || dd > 2) ? 0 : 1; });
      }
      function reset() {
        cks.forEach(function (c) { c.classList.remove('in'); });
        items.forEach(function (it) { it.classList.remove('lit'); });
        pages.forEach(function (p) { p.querySelectorAll('.ctr2-l, .ctr2-row').forEach(function (l) { l.classList.remove('in'); }); var s = p.querySelector('.ctr2-stamp'); if (s) s.classList.remove('on'); });
        if (fill) fill.style.width = '0'; if (pgLbl) pgLbl.textContent = 'формируется…';
        stackPos(0);
      }
      api.start = function () {
        running = true; cflow.classList.add('opened'); winShow(cwin, true);
        (function loop() {
          if (!running) return; reset();
          var T = 320, drawn = 0;
          // данные заказа слева подсвечиваются
          items.forEach(function (it, i) { t(function () { if (running) it.classList.add('lit'); }, 420 + i * 220); });
          cks.forEach(function (c, i) { t(function () { if (running) c.classList.add('in'); }, 760 + i * 260); });
          // договор пишется по страницам — строки проявляются одна за другой
          pages.forEach(function (p, pi) {
            t(function () { if (!running) return; stackPos(pi); if (pgLbl) pgLbl.textContent = 'стр. ' + (pi + 1) + '/' + NP; }, T); T += 300;
            [].slice.call(p.querySelectorAll('.ctr2-l, .ctr2-row')).forEach(function (l) {
              t(function () { if (!running) return; l.classList.add('in'); drawn++; if (fill) fill.style.width = Math.round(drawn / allLines * 100) + '%'; }, T); T += 150;
            });
            t(function () { if (!running) return; var s = p.querySelector('.ctr2-stamp'); if (s) s.classList.add('on'); }, T); T += 360;
          });
          t(function () { if (running && pgLbl) pgLbl.textContent = 'готово · 3 стр.'; }, T); T += 500;
          api.dur = T + 1500;
          t(advance, T + 1500);
        })();
      };
      api.stop = function () {
        running = false; timers.forEach(function (x) { clearTimeout(x); clearInterval(x); }); timers = [];
        cflow.classList.add('opened'); winShow(cwin, true);
        cks.forEach(function (c) { c.classList.add('in'); });
        items.forEach(function (it) { it.classList.add('lit'); });
        stackPos(NP - 1);
        pages.forEach(function (p) { p.querySelectorAll('.ctr2-l, .ctr2-row').forEach(function (l) { l.classList.add('in'); }); var s = p.querySelector('.ctr2-stamp'); if (s) s.classList.add('on'); });
        if (fill) fill.style.width = '100%'; if (pgLbl) pgLbl.textContent = 'готово · 3 стр.';
      };
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
        api.dur = pchips.length * 1100 + 1400;
        t(advance, api.dur);   // прошлись по операциям → переход на «Отгрузку»
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
          api.dur = 6400;
          t(advance, 6400);   // последний шаг: advance() на idx=N-1 ничего не делает → демо замирает на «Доставлено»
        })();
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; logi.classList.remove('play'); stage(3); truck.classList.remove('go'); };
    }

    return api;
  }
  var sceneOf = {};
  steps.forEach(function (s, i) { var k = items[i].k; if (k) sceneOf[i] = makeScene(s, k, i); });
  var playingScene = -1;
  var inView = false;   // колесо реально закреплено во вьюпорте (иначе демо/авто-переход НЕ запускаем — иначе страница уедет с hero)

  /* ── Автоплей: шайба ▶/⏸ на дуге + кольцо прогресса текущей сцены (сцены разные по длительности,
        кольцо синхронно с авто-переходом — «реклама, которую нельзя пролистнуть»). Включён по умолчанию. ── */
  var autoplayOn = !reduced;
  var apBtn = document.createElement('button');
  apBtn.type = 'button';
  apBtn.className = 'fw-autoplay' + (autoplayOn ? ' on' : '');
  apBtn.setAttribute('aria-label', 'Автопоказ шагов заказа');
  apBtn.setAttribute('aria-pressed', autoplayOn ? 'true' : 'false');
  apBtn.innerHTML =
    '<svg class="fw-ap-ring" viewBox="0 0 44 44" aria-hidden="true"><circle class="fw-ap-trk" cx="22" cy="22" r="19"/>' +
      '<circle class="fw-ap-prg" cx="22" cy="22" r="19"/></svg>' +
    '<span class="fw-ap-ico" aria-hidden="true">' +
      '<svg class="ic-pause" viewBox="0 0 24 24"><rect x="7" y="5" width="3.6" height="14" rx="1.1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.1"/></svg>' +
      '<svg class="ic-play" viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12z"/></svg></span>' +
    '<span class="fw-ap-label">Автопоказ</span>';
  if (reduced) apBtn.style.display = 'none';
  sticky.appendChild(apBtn);
  var apPrg = apBtn.querySelector('.fw-ap-prg');
  var AP_CIRC = 2 * Math.PI * 19;
  apPrg.style.strokeDasharray = AP_CIRC.toFixed(2);
  apPrg.style.strokeDashoffset = AP_CIRC.toFixed(2);
  function setProg(f) { f = f < 0 ? 0 : f > 1 ? 1 : f; apPrg.style.strokeDashoffset = (AP_CIRC * (1 - f)).toFixed(2); }
  var apRAF = null, apStartAt = 0, apDur = 0;
  function apCancel() { if (apRAF) { cancelAnimationFrame(apRAF); apRAF = null; } }
  function apTick(now) {
    apRAF = null;
    if (!autoplayOn || playingScene < 0 || !apDur) return;
    var f = (now - apStartAt) / apDur;
    setProg(f);
    if (f < 1) apRAF = requestAnimationFrame(apTick);
  }
  // старт кольца с начала сцены (apStartAt — реальное время старта сцены, синхронно с её setTimeout-переходом)
  function apBegin(dur) {
    apCancel(); apDur = dur || 0; apStartAt = performance.now(); setProg(0);
    if (autoplayOn && apDur) apRAF = requestAnimationFrame(apTick);
  }
  apBtn.addEventListener('click', function () {
    autoplayOn = !autoplayOn;
    apBtn.classList.toggle('on', autoplayOn);
    apBtn.setAttribute('aria-pressed', autoplayOn ? 'true' : 'false');
    if (autoplayOn) { apCancel(); apRAF = requestAnimationFrame(apTick); }   // возобновляем от реального времени сцены
    else apCancel();                                                          // пауза: кольцо и авто-переход замирают
  });

  function updateScene() {
    if (liteOff) return;                          /* lite: демо-сцены шагов выключены */
    var want = (sticky.classList.contains('settle') && inView) ? active : -1;
    if (want === playingScene) return;
    if (playingScene >= 0 && sceneOf[playingScene]) sceneOf[playingScene].stop();
    playingScene = want;
    apCancel(); setProg(0);
    if (want >= 0 && sceneOf[want] && !reduced) { sceneOf[want].start(); apBegin(sceneOf[want].dur); }
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    steps.forEach(function (s) { s.classList.toggle('on', +s.dataset.i === i); });
    if (ghost) ghost.textContent = pad2(i + 1);
  }
  var snapT = null, snapping = false;
  function onScroll() {
    if (liteOff) return;                          /* lite: скролл-драйвер колеса выключен */
    var r = track.getBoundingClientRect();
    var total = track.offsetHeight - H;
    var p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
    var pf = p * (N - 1);
    var mf = pf;                                      // «Плавная инерция»: линейный маппинг, без магнита
    var idx = Math.max(0, Math.min(N - 1, Math.round(pf)));
    inView = r.top <= 4 && r.bottom >= H - 4;         // секция закреплена и заполняет вьюпорт
    targetTheta = -mf * SP;
    setActive(idx);
    // контент шага виден ВСЕГДА (ближайший шаг) — переключение чётко на середине, без «мёртвого» пространства
    sticky.classList.add('settle');
    updateScene();
    kick();
    // Программная доводка страницы (scheduleSnap) отключена: именно она дёргала скролл и
    // залипала на концах. Магнит остаётся в маппинге (мягкое притяжение к шагам без рывка).
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
    }, 150);
  }
  function scrollToStep(i) {
    var top = track.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop);
    var total = track.offsetHeight - H;
    window.scrollTo({ top: Math.round(top + (i / (N - 1)) * total) + 2, behavior: reduced ? 'auto' : 'smooth' });
  }
  window.__fwSet = function (p) { // отладочный хук 0..1
    var pf = p * (N - 1); var mf = pf; var idx = Math.max(0, Math.min(N - 1, Math.round(pf)));
    targetTheta = -mf * SP; theta = targetTheta; vel = 0;
    inView = true;
    setActive(idx); sticky.classList.add('settle'); updateScene(); apply();
  };

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', layout);
  layout(); onScroll();

  /* ── lite-режим (слабое устройство): замораживаем колесо в статичный читаемый список.
        Срабатывает ТОЛЬКО по событию от lite-движка → мощные телефоны/ПК не затрагиваются. ── */
  var liteOff = false;
  function goStatic() {
    if (liteOff) return;
    liteOff = true;
    try {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      apCancel(); if (apBtn) apBtn.style.display = 'none';
      if (playingScene >= 0 && sceneOf[playingScene]) sceneOf[playingScene].stop();
      // схлопываем колесо и прячем всю анимационную машинерию
      if (track) { track.style.setProperty('height', 'auto', 'important'); track.style.minHeight = '0'; }
      if (sticky) { sticky.style.setProperty('position', 'static', 'important'); sticky.style.setProperty('height', 'auto', 'important'); sticky.style.removeProperty('--th'); }
      ['.fw-arc', '.fw-cards', '.fw-marker', '.fw-ghost', '.fw-sheets', '.fw-body'].forEach(function (sel) {
        var e = track && track.querySelector(sel); if (e) e.style.display = 'none';
      });
      // вместо колеса — простой читаемый список шагов «полоской» из тех же данных
      var ol = document.createElement('ol');
      ol.className = 'fw-lite-steps';
      ol.innerHTML = items.map(function (s) {
        return '<li><span class="fw-lite-n">' + pad2(s.n) + '</span><div class="fw-lite-tx">' +
          '<h4>' + s.t + '</h4>' + (s.d ? '<p>' + s.d + '</p>' : '') + '</div></li>';
      }).join('');
      var head = track && track.querySelector('.fw-head');
      if (head && head.parentNode) head.parentNode.insertBefore(ol, head.nextSibling);
      else (sticky || host).appendChild(ol);
      host.classList.add('fw-lite');
    } catch (e) {}
  }
  document.addEventListener('egoe:lite', goStatic);
  if (document.documentElement.hasAttribute('data-lite')) goStatic();
})();


/* ── cookie-уведомление (один раз, путь к политике берём из подвала) ── */
(function () {
  try { if (localStorage.getItem('egoe_cookie_ok')) return; } catch (e) {}
  if (!document.body || document.querySelector('.cookie-bar')) return;
  var pl = document.querySelector('.foot-bot a[href*="privacy"]');
  var href = pl ? pl.getAttribute('href') : 'privacy/index.html';
  var bar = document.createElement('div');
  bar.className = 'cookie-bar';
  bar.innerHTML = '<div class="cookie-in"><p>Мы используем файлы cookie для работы сайта (например, чтобы сохранять список изделий). Продолжая пользоваться сайтом, вы соглашаетесь с <a href="' + href + '">политикой обработки персональных данных</a>.</p><button class="btn btn-primary btn-sm" type="button">Принять</button></div>';
  document.body.appendChild(bar);
  setTimeout(function () { bar.classList.add('show'); }, 60);
  bar.querySelector('button').addEventListener('click', function () {
    try { localStorage.setItem('egoe_cookie_ok', '1'); } catch (e) {}
    bar.classList.remove('show');
    setTimeout(function () { if (bar.parentNode) bar.remove(); }, 500);
  });
})();

/* ── лайтбокс просмотра сертификатов/документов (страница корзин, о компании) ── */
(function () {
  var cards = document.querySelectorAll('.cert-card[href]');
  if (!cards.length) return;
  var lb = document.createElement('div');
  lb.className = 'cert-lb';
  lb.innerHTML = '<button class="cert-lb-x" type="button" aria-label="Закрыть">×</button><img alt="Документ"><span class="cert-lb-hint">Клик вне документа или Esc — закрыть</span>';
  document.body.appendChild(lb);
  var img = lb.querySelector('img');
  function open(src) { img.src = src; lb.classList.add('on'); document.documentElement.style.overflow = 'hidden'; }
  function close() { lb.classList.remove('on'); document.documentElement.style.overflow = ''; setTimeout(function () { if (!lb.classList.contains('on')) img.removeAttribute('src'); }, 280); }
  cards.forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); open(a.getAttribute('href')); }); });
  lb.addEventListener('click', function (e) { if (e.target === lb || e.target.classList.contains('cert-lb-x')) close(); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape' && lb.classList.contains('on')) close(); });
})();

/* ══════════════════════════════════════════════════════════════════════
   EGOE lite-режим — авто-упрощение сайта ТОЛЬКО для телефонов.
   Принцип «fail-open»: по умолчанию всегда ПОЛНАЯ версия. Понижаем лишь
   при явном доказательстве слабости (медленная сеть ИЛИ устойчивый джанк).
   Отсутствующий/капнутый сигнал = НЕ повод понижать (защита мощных телефонов).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var doc = document.documentElement;

  /* 1) Только телефоны. ПК, ноуты и планшеты не трогаем. */
  var coarse = matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches;
  var minDim = Math.min(screen.width || 9999, screen.height || 9999);
  if (!coarse || minDim > 560 || innerWidth > 900) return;

  /* 2) Уважаем выбор пользователя: вручную вернул полную — в этой сессии не лезем.
        Флаг дублируем в памяти, чтобы он пережил ошибку записи в sessionStorage (приватный режим). */
  var OPTOUT = 'egoe_lite_optout', userOptedOut = false;
  function optedOut(){ if (userOptedOut) return true; try { return sessionStorage.getItem(OPTOUT) === '1'; } catch (e) { return false; } }

  var STATE = null;              /* null | 'net' | 'perf' */
  var bar = null, barDismissed = false;
  var perfLocked = false;        /* после авто-возврата из perf по perf больше не понижаем сами */
  var netCooldownUntil = 0;      /* анти-мигание для сети */
  var probeUrl = null;           /* крупный ресурс для активного пере-замера скорости */

  /* ── сеть: дешёвый строгий сигнал (Chromium/Android). null = неизвестно (iOS/3g). ── */
  function fastNetSignal(){
    var c = navigator.connection;
    if (!c) return null;
    if (c.saveData === true) return 'weak';                 /* пользователь сам просил экономию */
    if (c.effectiveType === '2g' || c.effectiveType === 'slow-2g') return 'weak';
    if (c.effectiveType === '4g') return 'ok';
    return null;                                            /* 3g → меряем реально */
  }

  /* Оценка скорости по УЖЕ загруженным крупным ресурсам (буфер растёт при подгрузке картинок). */
  function bufferNetWeak(){
    try {
      var res = performance.getEntriesByType('resource'), sp = [], big = null, bigSz = 0;
      for (var i = 0; i < res.length; i++){
        var e = res[i];
        if ((e.initiatorType === 'img' || e.initiatorType === 'css') && e.transferSize > 20000 && e.duration > 0){
          sp.push((e.transferSize * 8 / 1e6) / (e.duration / 1000));
          if (e.transferSize > bigSz){ bigSz = e.transferSize; big = e.name; }
        }
      }
      if (big) probeUrl = big;
      if (sp.length < 4) return false;                       /* мало данных → не судим (fail-open) */
      sp.sort(function (a, b){ return a - b; });
      return sp[Math.floor(sp.length / 2)] < 1.0;            /* медиана < ~1 Мбит/с = слабо */
    } catch (e) { return false; }
  }

  /* Активный замер скорости: тянем ~64КБ реального ресурса с cache-bust. cb(Мбит/с | null). */
  function activeNetProbe(cb){
    var url = probeUrl;
    if (!url){ var im = document.images; for (var i = 0; i < im.length; i++){ if (im[i].currentSrc && im[i].naturalWidth > 0){ url = im[i].currentSrc; break; } } }
    if (!url) return cb(null);
    var t0 = performance.now();
    fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + 'nt=' + t0, { cache: 'no-store', headers: { 'Range': 'bytes=0-65535' } })
      .then(function (r){ return r && (r.ok || r.status === 206) ? r.blob() : null; })
      .then(function (b){
        var sec = (performance.now() - t0) / 1000;
        if (!b || b.size < 8000 || sec <= 0) return cb(null);   /* мелко/мгновенно → недостоверно */
        cb((b.size * 8 / 1e6) / sec);
      }).catch(function (){ cb(null); });
  }

  /* ── FPS-проба: меряем ВРЕМЯ кадра (median + доля кадров >33мс). Порог АБСОЛЮТНЫЙ,
        не зависит от частоты экрана — иначе 120Гц-айфон держался бы к более строгой планке. ── */
  function fpsProbe(cb){
    if (document.visibilityState !== 'visible') return cb(null);
    var deltas = [], start = 0, last = 0, warmEnd = 0;
    function tick(now){
      var dt = now - last; last = now;
      if (now > warmEnd && dt > 0 && dt < 250) deltas.push(dt);   /* после разогрева, без столлов резюме/GC */
      if (now - start < 2600) return requestAnimationFrame(tick);
      if (document.visibilityState !== 'visible' || deltas.length < 24) return cb(null);  /* мало данных → fail-open */
      deltas.sort(function (a, b){ return a - b; });
      var median = deltas[deltas.length >> 1], slow = 0;
      for (var i = 0; i < deltas.length; i++){ if (deltas[i] > 33) slow++; }   /* >33мс = кадр ниже 30fps */
      cb({ medianMs: median, slowRatio: slow / deltas.length });
    }
    requestAnimationFrame(function (t){ start = last = t; warmEnd = t + 500; requestAnimationFrame(tick); });
  }
  function janky(r){ return r.medianMs > 22 || r.slowRatio > 0.30; }   /* медиана ниже ~45fps ИЛИ >30% кадров ниже 30fps */

  /* «Не тянет» подтверждаем ДВУМЯ близкими окнами (иначе одиночный столл не в счёт). */
  function evalPerf(){
    if (STATE || optedOut() || perfLocked) return;
    fpsProbe(function (r){
      if (!r || !janky(r)) return;                        /* недостоверно/плавно → выходим */
      setTimeout(function (){
        if (STATE || optedOut() || perfLocked) return;
        fpsProbe(function (r2){ if (r2 && janky(r2)) enterLite('perf'); });
      }, 2500);
    });
  }

  /* Джанк ИМЕННО на скролле — главный признак «телефон не тянет» (idle-проба его не ловит).
     Меряем время кадра во время активной прокрутки; 2 тяжёлых берста подряд
     (>40% кадров ниже 30fps на ≥15 кадрах) → lite. Мощный телефон скроллит гладко → не сработает. */
  function scrollJankWatch(){
    var lastScroll = 0, watching = false, last = 0, jank = 0, total = 0, badBursts = 0;
    addEventListener('scroll', function (){
      lastScroll = performance.now();
      if (!watching && !STATE && !optedOut() && !perfLocked && document.visibilityState === 'visible'){
        watching = true; last = lastScroll; requestAnimationFrame(tick);
      }
    }, { passive: true });
    function tick(now){
      if (STATE || optedOut() || perfLocked){ watching = false; return; }
      var dt = now - last; last = now;
      if ((now - lastScroll) < 180 && dt > 0 && dt < 400){    /* только во время активного скролла */
        total++; if (dt > 33) jank++;
      }
      if (now - lastScroll > 500){                            /* скролл-берст закончился */
        watching = false;
        if (total >= 15){
          if (jank / total > 0.4) badBursts++; else badBursts = 0;
          if (badBursts >= 2) enterLite('perf');
        }
        jank = total = 0;
        return;
      }
      requestAnimationFrame(tick);
    }
  }

  /* ── вход/выход. Все упрощения делает CSS через [data-lite] — JS их не трогает,
        поэтому выход чисто восстанавливает полную версию. ── */
  function enterLite(reason){
    if (STATE || optedOut()) return;
    STATE = reason;
    if (reason === 'net') netCooldownUntil = performance.now() + 60000;
    doc.setAttribute('data-lite', reason);
    try { document.dispatchEvent(new CustomEvent('egoe:lite', { detail: { reason: reason } })); } catch (e) {}
    showBar(reason);
  }
  function exitLite(manual){
    STATE = null;
    doc.removeAttribute('data-lite');
    if (bar) bar.classList.remove('on');
    if (manual){ userOptedOut = true; try { sessionStorage.setItem(OPTOUT, '1'); } catch (e) {} }
  }

  /* ── плашка снизу ── */
  function showBar(reason){
    if (barDismissed) return;
    if (!bar){
      bar = document.createElement('div');
      bar.className = 'lite-bar';
      bar.innerHTML = '<span class="lite-ic" aria-hidden="true"></span>' +
        '<span class="lite-tx"></span>' +
        '<button class="lite-back" type="button">Вернуть полную</button>' +
        '<button class="lite-x" type="button" aria-label="Скрыть уведомление">×</button>';
      document.body.appendChild(bar);
      bar.querySelector('.lite-back').addEventListener('click', function (){ exitLite(true); });
      bar.querySelector('.lite-x').addEventListener('click', function (){ barDismissed = true; bar.classList.remove('on'); });
    }
    bar.querySelector('.lite-tx').textContent = reason === 'net'
      ? 'Медленное соединение — включили лёгкую версию, чтобы сайт грузился быстрее.'
      : 'Телефон не справляется с анимацией — включили лёгкую версию.';
    var ck = document.querySelector('.cookie-bar.show');
    bar.style.bottom = (ck ? ck.offsetHeight + 10 : 0) + 'px';
    requestAnimationFrame(function (){ bar.classList.add('on'); });
  }

  function toast(msg){
    var t = document.createElement('div');
    t.className = 'lite-toast'; t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function (){ t.classList.add('on'); });
    setTimeout(function (){ t.classList.remove('on'); setTimeout(function (){ if (t.parentNode) t.remove(); }, 400); }, 3500);
  }
  function recoverNet(){ exitLite(false); netCooldownUntil = performance.now() + 60000; toast('Соединение восстановилось — вернули полную версию.'); }

  /* ── периодическая перепроверка (вдруг просадка кратковременная) ── */
  setInterval(function (){
    if (optedOut()) return;
    if (STATE === 'net'){
      if (performance.now() < netCooldownUntil) return;
      var fs = fastNetSignal();
      if (fs === 'weak') return;                          /* всё ещё слабо */
      if (fs === 'ok'){ recoverNet(); return; }           /* явно 4g → возвращаем */
      activeNetProbe(function (mbps){ if (mbps != null && mbps > 2.5) recoverNet(); });  /* гистерезис: нужно уверенно быстро */
    } else if (STATE === 'perf'){
      fpsProbe(function (r){                               /* возвращаем только при уверенно ровной картине (~60fps+) */
        if (r && r.medianMs <= 16 && r.slowRatio < 0.08){
          exitLite(false); perfLocked = true; toast('Стало плавно — вернули полную версию.');
        }
      });
    } else {
      var f = fastNetSignal();
      if (f === 'weak'){ enterLite('net'); return; }
      if (f === null && bufferNetWeak()){ enterLite('net'); return; }   /* iOS/3g: пере-читаем буфер */
      evalPerf();
    }
  }, 25000);

  /* ── старт: сперва проверка сети, затем FPS после «устаканивания» страницы ── */
  function boot(){
    if (optedOut()) return;
    scrollJankWatch();                                                  /* ловим лаги на скролле — главный сигнал */
    var f = fastNetSignal();
    if (f === 'weak'){ enterLite('net'); return; }
    if (f === null && bufferNetWeak()){ enterLite('net'); return; }     /* iOS/3g: замер по загрузке */
    setTimeout(evalPerf, 1200);
  }
  if (document.readyState === 'complete') boot();
  else addEventListener('load', boot);
})();

/* ── плавное появление фото карточек (.ph.has-img): серый пульс → fade-in ── */
(function () {
  function done(img){ var ph=img.closest && img.closest('.ph.has-img'); if(ph) ph.classList.add('loaded'); }
  function scan(){
    document.querySelectorAll('.ph.has-img img').forEach(function(img){
      if(img.dataset.fadeBound) return; img.dataset.fadeBound='1';
      if(img.complete && img.naturalWidth>0){ done(img); }
      else { img.addEventListener('load', function(){ done(img); }); img.addEventListener('error', function(){ done(img); }); }
    });
  }
  if(document.readyState!=='loading') scan(); else addEventListener('DOMContentLoaded', scan);
  addEventListener('load', scan);
})();
