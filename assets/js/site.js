/* СТАЛЬПРОМ — общий скрипт сайта v3: навигация, формы, корзина-страница, микроанимации */
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

  // отправка любой формы-заявки -> показываем «спасибо»
  // (на боевом сайте сюда подключается e-mail / CRM)
  window.submitLead = function (form) {
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
  // первичные проверки после загрузки
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
    + '<div class="mnav-head"><b>СТАЛЬПРОМ</b><button class="mnav-x" type="button" aria-label="Закрыть меню">×</button></div>'
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

  window.addToCart = function (item) {
    if (!item || !item.id) return;
    var c = read(); var f = c.filter(function (x) { return x.id === item.id; })[0];
    if (f) f.qty += (item.qty || 1);
    else c.push({ id: item.id, name: item.name || item.id, url: item.url || '', img: item.img || '', qty: item.qty || 1 });
    write(c); toast();
  };
  window.addToCartFromPage = function (btn) {
    var pp = document.querySelector('.pp-info') || document;
    var h = pp.querySelector('h1') || document.querySelector('h1');
    var art = (pp.querySelector('.pp-art') || {}).textContent || '';
    var m = art.match(/Артикул\s*([A-Za-zА-Яа-я0-9\-]+)/);
    var mainImg = document.querySelector('.gallery .ph.main img');
    var qtyInp = document.querySelector('.pp-info .qty input') || document.querySelector('.qty input');
    var id = (m ? m[1] : (h ? h.textContent.trim() : location.pathname)).trim();
    addToCart({
      id: id,
      name: h ? h.textContent.trim() : id,
      url: location.href,                                        // абсолютный — работает со страницы корзины
      img: mainImg ? abs(mainImg.getAttribute('src')) : '',      // абсолютный — картинка не ломается на /cart/
      qty: qtyInp ? Math.max(1, parseInt(qtyInp.value, 10) || 1) : 1
    });
  };
  // общий API для страницы корзины
  window.__spCart = { read: read, write: write, count: count, setQty: setQty, del: del, clear: clearAll, esc: esc, cartURL: cartURL, siteBase: siteBase.href };

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
  }

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

  function lineList(c) {
    return 'Список для расчёта:\n' + c.map(function (i) { return '• ' + i.name + ' — ' + i.qty + ' шт'; }).join('\n');
  }
  function render() {
    var c = C.read();
    var n = C.count();
    if (titleCount) titleCount.textContent = c.length ? c.length + ' поз. · ' + n + ' шт' : '';
    if (sumPos) sumPos.textContent = c.length;
    if (sumQty) sumQty.textContent = n + ' шт';
    if (itemsTa) itemsTa.value = lineList(c);
    if (side) side.classList.toggle('is-empty', !c.length);

    if (!c.length) {
      itemsBox.innerHTML =
        '<div class="cartp-empty reveal in">' +
        '<svg viewBox="0 0 24 24"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>' +
        '<h2>Список пока пуст</h2>' +
        '<p>Добавляйте изделия кнопкой «В корзину» — соберём их в одну заявку<br>и рассчитаем КП по объёму, цвету RAL и доставке.</p>' +
        '<div class="cartp-empty-act"><a class="btn btn-primary" href="' + new URL('maf/index.html', C.siteBase).href + '">Каталог МАФ</a>' +
        '<a class="btn" href="' + new URL('ograzhdeniya/index.html', C.siteBase).href + '">Ограждения</a></div></div>';
      return;
    }
    itemsBox.innerHTML = c.map(function (i, idx) {
      var img = i.img ? '<img src="' + C.esc(i.img) + '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'noimg\')">' : '';
      var open = i.url ? ' href="' + C.esc(i.url) + '"' : '';
      return '<div class="cartp-item" data-id="' + C.esc(i.id) + '" style="--i:' + idx + '">' +
        '<a class="ci-ph' + (i.img ? '' : ' noimg') + '"' + open + '>' + img + '</a>' +
        '<div class="ci-main">' +
          '<a class="ci-name"' + open + '>' + C.esc(i.name) + '</a>' +
          '<small>Артикул ' + C.esc(i.id) + ' · цена по запросу</small>' +
          '<div class="ci-ctrl">' +
            '<span class="cart-qty"><button type="button" data-q="-1" aria-label="Меньше">−</button><span>' + i.qty + '</span><button type="button" data-q="1" aria-label="Больше">+</button></span>' +
            '<button class="ci-del" type="button" data-del>Убрать</button>' +
          '</div>' +
        '</div></div>';
    }).join('') +
    '<div class="cartp-tools"><button class="ci-del" type="button" id="cartClear">Очистить весь список</button></div>';
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

  render();
})();

/* ── переключатель «Завод vs Посредник» ── */
(function () {
  document.querySelectorAll('.versus').forEach(function (box) {
    var btns = box.querySelectorAll('.vs-btn');
    var slide = box.querySelector('.vs-slide');
    if (!btns.length || !slide) return;

    function place(btn) {
      slide.style.left = btn.offsetLeft + 'px';
      slide.style.width = btn.offsetWidth + 'px';
    }
    function setMode(mode, btn) {
      box.dataset.mode = mode;
      btns.forEach(function (b) { b.classList.toggle('on', b === btn); });
      place(btn);
    }
    btns.forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode, b); });
    });
    // стартовое положение
    var start = box.querySelector('.vs-btn.on') || btns[0];
    requestAnimationFrame(function () { setMode(start.dataset.mode, start); });
    addEventListener('resize', function () {
      var cur = box.querySelector('.vs-btn.on');
      if (cur) place(cur);
    });
  });
})();
