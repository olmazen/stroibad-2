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

  /* ── генерация КП: шапка + режим + открытие /kp/ ── */
  (function wireKpGen() {
    var gen = document.getElementById('kpGen');
    if (!gen) return;
    var HEAD_KEY = 'sp_kp_head_v1';
    var F = {
      object: document.getElementById('kpObject'), addressee: document.getElementById('kpAddressee'),
      number: document.getElementById('kpNumber'), date: document.getElementById('kpDate'),
      reqNumber: document.getElementById('kpReqNumber'), reqDate: document.getElementById('kpReqDate'),
    };
    var seg = document.getElementById('kpSeg');
    var hint = document.getElementById('kpGenHint');
    var ledgerOnly = document.getElementById('kpLedgerOnly');
    var ndsRow = document.getElementById('kpNdsRow');
    var openBtn = document.getElementById('kpOpen');
    var kpMode = 'beauty';

    function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function autoNum() { var d = new Date(); return 'КП-' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }

    // префилл из сохранённого + дефолты
    var saved = {}; try { saved = JSON.parse(localStorage.getItem(HEAD_KEY)) || {}; } catch (e) {}
    F.object.value = saved.object || '';
    F.addressee.value = saved.addressee || '';
    F.number.value = saved.number || autoNum();
    F.date.value = saved.date || today();
    F.reqNumber.value = saved.reqNumber || '';
    F.reqDate.value = saved.reqDate || '';

    function saveHead() {
      var h = {}; for (var k in F) h[k] = F[k].value.trim();
      try { localStorage.setItem(HEAD_KEY, JSON.stringify(h)); } catch (e) {}
      return h;
    }
    for (var k in F) F[k].addEventListener('input', saveHead);
    saveHead(); // сразу зафиксировать дефолты (№/дата), иначе валидатор на /kp/ ругается на «пустые» при показанных автозначениях

    seg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-kpmode]'); if (!b) return;
      kpMode = b.dataset.kpmode;
      seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      gen.classList.toggle('is-tender', kpMode === 'tender');
      hint.textContent = kpMode === 'tender'
        ? 'Формальный документ под 44-ФЗ: реквизиты, НДС, подпись. Цены обязательны по всем позициям.'
        : 'Для клиента: обложка, фото, чертежи, цены.';
      if (kpMode === 'tender') ledgerOnly.checked = true;
    });

    openBtn.addEventListener('click', function () {
      var h = saveHead();
      // для тендера обязательные поля — не открываем /kp/ с пустыми (подсветка + подсказка)
      if (kpMode === 'tender') {
        var miss = [];
        if (!h.addressee) miss.push(F.addressee);
        if (!h.number) miss.push(F.number);
        if (!h.date) miss.push(F.date);
        if (miss.length) {
          miss.forEach(function (el) { el.classList.add('kp-invalid'); el.focus(); });
          setTimeout(function () { miss.forEach(function (el) { el.classList.remove('kp-invalid'); }); }, 3000);
          hint.textContent = 'Заполните обязательные поля со звёздочкой (заказчик, № и дата КП) — они нужны для тендерного КП.';
          return;
        }
      }
      var q = 'mode=' + kpMode;
      if (ledgerOnly.checked) q += '&ledger=1';
      if (kpMode === 'tender' && ndsRow.checked) q += '&nds=row';
      var base = C.siteBase || (location.origin + '/');
      window.open(new URL('kp/index.html?' + q, base).href, '_blank');
    });
  })();

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
    if (k === 'choose') return '<div class="fw-pick">' +
      '<div class="fw-pick-row">' +
      '<div class="fw-pk" data-pk="0"><img src="assets/img/artdeco/lezhaki/a1-2661/card.webp" alt="Лежак Art Déco"><b>Лежак A1-2661</b><span>от 21 700 ₽</span><i></i></div>' +
      '<div class="fw-pk" data-pk="1"><img src="assets/img/maf/skamejki/9467/main.webp" alt="Скамейка уличная"><b>Скамейка</b><span>от 4 500 ₽</span><i></i></div>' +
      '<div class="fw-pk" data-pk="2"><img src="assets/img/korziny/standart/STN03-treugolnik/main.webp" alt="Корзина для кондиционера"><b>Корзина</b><span>от 1 900 ₽</span><i></i></div>' +
      '</div><div class="fw-pick-cnt">В списке для расчёта: <b data-cnt>0</b></div>' + cur + '</div>';
    if (k === 'form') return '<div class="fw-form fw-demo" aria-hidden="true">' +
      '<div class="fw-push"><i>E</i><div><b>EGOE</b><span>Заявка № 214 принята — перезвоним сегодня</span></div><em>сейчас</em></div>' +
      '<div class="fw-form-row"><div class="field"><label>Имя</label><input type="text" readonly tabindex="-1" data-df="name" placeholder="Как к вам обращаться"></div>' +
      '<div class="field"><label>Телефон</label><input type="tel" readonly tabindex="-1" data-df="tel" placeholder="+7"></div></div>' +
      '<span class="btn btn-primary fw-demo-btn">Отправить заявку</span>' +
      '<div class="fw-form-ok"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 15-16"/></svg><b>Заявка принята</b><span>перезвоним в течение рабочего дня</span></div>' +
      cur + '</div>' +
      '<button class="fw-own" type="button" onclick="openModal()">Оставить свою заявку →</button>';
    if (k === 'calc') return '<div class="fw-flow2">' +
      '<div class="fw-att-zone">' +
      '<div class="fw-genline"><b data-pdf>Формируем PDF-смету…</b><span class="fw-pdf-bar"><u></u></span></div>' +
      '<div class="fw-att"><i>PDF</i><div class="fw-att-tx"><b>смета-214-МК.pdf</b><span>3 страницы · 214 КБ</span></div><em></em></div>' +
      '<div class="fw-att-hint">кликните — откроется смета</div>' +
      cur + '</div>' +
      '<div class="fw-win fw-pdfwin"><div class="fw-win-bar"><i></i><i></i><i></i><b>смета-214-МК.pdf</b><span data-pgind>1 / 3</span></div>' +
      '<div class="fw-win-body"><div class="fw-pages">' +
      '<div class="fw-pg on"><div class="pdf-logo"><s></s>EGOE</div>' +
        '<div class="pdf-cv"><em>Спецификация № 214-МК</em><b>Благоустройство<br>ЖК «Ваш объект»</b><span>3 позиции · 26 единиц</span></div>' +
        '<div class="pdf-foot">EGOE · завод металлоконструкций · egoe-life.ru</div></div>' +
      '<div class="fw-pg"><b class="pdf-h">Ведомость изделий</b><div class="pdf-t">' +
        '<div class="pdf-tr th"><span>Изделие</span><span>RAL</span><span>Кол-во</span><span>Цена, от</span></div>' +
        '<div class="pdf-tr"><span>Лежак Art Déco A1-2661</span><span>6021</span><span>12</span><span>21 700 ₽</span></div>' +
        '<div class="pdf-tr"><span>Скамейка A4-2641</span><span>7016</span><span>8</span><span>4 500 ₽</span></div>' +
        '<div class="pdf-tr"><span>Урна U3-600</span><span>9005</span><span>6</span><span>12 900 ₽</span></div>' +
        '</div><div class="pdf-sum"><span>ориентировочно, до расчёта КП</span><b>≈ 298 600 ₽</b></div></div>' +
      '<div class="fw-pg"><div class="pdf-h3"><b>Лежак A1-2661</b><i>Art Déco</i></div>' +
        '<div class="pdf-media"><img src="assets/img/artdeco/lezhaki/a1-2661/card.webp" alt=""><span class="pdf-draw"><img src="assets/img/artdeco/lezhaki/a1-2661/drawing-white.svg" alt=""></span></div>' +
        '<div class="pdf-spec"><span>Длина</span><b>1842 мм</b></div><div class="pdf-spec"><span>Высота</span><b>760 мм</b></div><div class="pdf-spec"><span>Материал · окраска</span><b>сталь · любой RAL</b></div></div>' +
      '</div><div class="fw-pgdots"><i class="on"></i><i></i><i></i></div></div></div></div>';
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
      '<div class="fw-ph fw-kb"><img src="assets/img/artdeco/lezhaki/i1-3651/facade2.webp" alt="Сталь изделия крупным планом — производство EGOE"><span>сталь · порошковая окраска RAL · свой цех</span></div>';
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
  track.style.height = (N * 88 + 16) + 'vh';
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
  var theta = 0, targetTheta = 0, active = 0, raf = null;
  var rad = function (a) { return a * Math.PI / 180; };

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
    var t = '';
    for (var b = -34; b <= (N - 1) * SP + 34; b += 3) {
      var mj = b >= -0.01 && b <= (N - 1) * SP + 0.01 && Math.abs(((b % SP) + SP) % SP) < 0.01;
      var A = BASE + b, len = mj ? 30 : 12, r1 = R - 4 - len, r2 = R - 4;
      t += '<line class="' + (mj ? 'mj' : '') + '" x1="' + (CX + r1 * Math.cos(rad(A))).toFixed(1) + '" y1="' + (CY + r1 * Math.sin(rad(A))).toFixed(1) +
        '" x2="' + (CX + r2 * Math.cos(rad(A))).toFixed(1) + '" y2="' + (CY + r2 * Math.sin(rad(A))).toFixed(1) + '"/>';
    }
    ticksG.innerHTML = t;
    apply();
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
    ticksG.setAttribute('transform', 'rotate(' + theta + ' ' + CX + ' ' + CY + ')');
    sticky.style.setProperty('--th', theta.toFixed(2) + 'deg');
  }
  function frame() {
    raf = null;
    var d = targetTheta - theta;
    theta = reduced ? targetTheta : theta + d * 0.16;
    if (Math.abs(targetTheta - theta) < 0.02) theta = targetTheta;
    apply();
    if (theta !== targetTheta) raf = requestAnimationFrame(frame);
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
      var picks = root.querySelectorAll('.fw-pk');
      var cnt = root.querySelector('[data-cnt]');
      var ccur = root.querySelector('.fw-cur');
      api.start = function () {
        running = true;
        (function loop() {
          if (!running) return;
          picks.forEach(function (p) { p.classList.remove('on'); });
          if (cnt) cnt.textContent = '0';
          ccur.classList.add('show');
          picks.forEach(function (p, i) {
            t(function () { curTo(ccur, p, 550, 0.62, 0.55); }, 500 + i * 1050);
            t(function () { ccur.classList.add('press'); p.classList.add('on'); if (cnt) cnt.textContent = String(i + 1); }, 1080 + i * 1050);
            t(function () { ccur.classList.remove('press'); }, 1260 + i * 1050);
          });
          t(function () { ccur.classList.remove('show'); }, 500 + picks.length * 1050 + 500);
          t(loop, 500 + picks.length * 1050 + 2600);
        })();
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; picks.forEach(function (p) { p.classList.remove('on'); }); if (cnt) cnt.textContent = '0'; ccur.classList.remove('show', 'press'); };
    }

    if (kind === 'form') {
      var nameI = root.querySelector('[data-df="name"]');
      var telI = root.querySelector('[data-df="tel"]');
      var btn = root.querySelector('.fw-demo-btn');
      var ok = root.querySelector('.fw-form-ok');
      var cur = root.querySelector('.fw-cur');
      var demo = root.querySelector('.fw-demo');
      api.start = function () {
        running = true;
        (function loop() {
          if (!running) return;
          nameI.value = ''; telI.value = '';
          demo.classList.remove('sent'); ok.classList.remove('show'); btn.classList.remove('press');
          root.querySelector('.fw-push').classList.remove('show');
          cur.classList.add('show'); curTo(cur, nameI, 10, 0.2, 0.7);
          t(function () { nameI.classList.add('focus'); typeVal(nameI, 'Алексей', 85); }, 600);
          t(function () { nameI.classList.remove('focus'); telI.classList.add('focus'); curTo(cur, telI, 500, 0.25, 0.7); }, 1600);
          t(function () { typeVal(telI, '+7 912 000-00-00', 55); }, 2200);
          t(function () { telI.classList.remove('focus'); curTo(cur, btn, 650, 0.5, 0.55); }, 3400);
          t(function () { btn.classList.add('press'); cur.classList.add('press'); }, 4150);
          t(function () { btn.classList.remove('press'); cur.classList.remove('press'); demo.classList.add('sent'); ok.classList.add('show'); cur.classList.remove('show'); }, 4420);
          t(function () { root.querySelector('.fw-push').classList.add('show'); }, 5250);
          t(loop, 9400);
        })();
      };
      api.stop = function () {
        running = false; timers.forEach(clearTimeout); timers = [];
        nameI.value = ''; telI.value = '';
        nameI.classList.remove('focus'); telI.classList.remove('focus');
        demo.classList.remove('sent'); ok.classList.remove('show'); btn.classList.remove('press'); cur.classList.remove('show', 'press');
        var pu = root.querySelector('.fw-push'); if (pu) pu.classList.remove('show');
      };
    }

    if (kind === 'calc') {
      var flow = root.querySelector('.fw-flow2');
      var gen = root.querySelector('.fw-genline');
      var genTx = root.querySelector('[data-pdf]');
      var att = root.querySelector('.fw-att');
      var win = root.querySelector('.fw-pdfwin');
      var pgs = root.querySelectorAll('.fw-pg');
      var dots = root.querySelectorAll('.fw-pgdots i');
      var pgInd = root.querySelector('[data-pgind]');
      var pcur = root.querySelector('.fw-att-zone .fw-cur');
      function showPg(n) {
        pgs.forEach(function (p, i) { p.classList.toggle('on', i === n); });
        dots.forEach(function (d, i) { d.classList.toggle('on', i === n); });
        if (pgInd) pgInd.textContent = (n + 1) + ' / ' + pgs.length;
      }
      api.start = function () {
        running = true;
        (function loop() {
          if (!running) return;
          flow.classList.remove('opened'); winShow(win, false);
          gen.classList.remove('go', 'ok'); att.classList.remove('ready', 'press');
          if (genTx) genTx.textContent = 'Формируем PDF-смету…';
          showPg(0);
          t(function () { gen.classList.add('go'); }, 350);
          t(function () { gen.classList.add('ok'); if (genTx) genTx.textContent = 'Смета готова ✓'; att.classList.add('ready'); }, 1700);
          t(function () { pcur.classList.add('show'); curTo(pcur, att, 10, 0.15, 1.25); curTo(pcur, att, 620, 0.55, 0.55); }, 2100);
          t(function () { pcur.classList.add('press'); att.classList.add('press'); }, 2850);
          t(function () { pcur.classList.remove('press'); att.classList.remove('press'); pcur.classList.remove('show'); flow.classList.add('opened'); winShow(win, true); }, 3100);
          t(function () { showPg(1); }, 5300);
          t(function () { showPg(2); }, 7500);
          t(loop, 10400);
        })();
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; gen.classList.add('ok'); att.classList.add('ready'); flow.classList.add('opened'); winShow(win, true); showPg(0); if (pcur) pcur.classList.remove('show', 'press'); };
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
  function onScroll() {
    var r = track.getBoundingClientRect();
    var total = track.offsetHeight - H;
    var p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
    var pf = p * (N - 1);
    var idx = Math.max(0, Math.min(N - 1, Math.round(pf)));
    targetTheta = -pf * SP;
    setActive(idx);
    // паз: главная встала на место → показываем доп; в движении — прячем
    sticky.classList.toggle('settle', Math.abs(pf - idx) < 0.24);
    updateScene();
    kick();
  }
  function scrollToStep(i) {
    var top = track.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop);
    var total = track.offsetHeight - H;
    window.scrollTo({ top: Math.round(top + (i / (N - 1)) * total) + 2, behavior: reduced ? 'auto' : 'smooth' });
  }
  window.__fwSet = function (p) { // отладочный хук 0..1
    var pf = p * (N - 1); var idx = Math.max(0, Math.min(N - 1, Math.round(pf)));
    targetTheta = -pf * SP; theta = targetTheta;
    setActive(idx); sticky.classList.toggle('settle', Math.abs(pf - idx) < 0.24); updateScene(); apply();
  };

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', layout);
  layout(); onScroll();
})();
