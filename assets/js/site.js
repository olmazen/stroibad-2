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
    function autoNum() { var d = new Date(); return 'КП-' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
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

      // фиксируем лид локально (сервер заберёт позже; TODO: POST на send-spec.php + письмо с КП)
      try {
        var leads = JSON.parse(localStorage.getItem(LEADS_KEY)) || [];
        leads.push({ ts: Date.now(), name: name, phone: phone, email: email, company: company, items: C.read() });
        localStorage.setItem(LEADS_KEY, JSON.stringify(leads));
      } catch (e3) {}

      openDrawer();
      if (okBox) okBox.style.display = 'block';
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
    if (k === 'choose') {
      // каркас: корзина в углу (вне камеры) + камера с сеткой (плитки строит makeScene по вьюпорту) + курсор
      return '<div class="fw-catalog">' +
        '<button class="fw-catcart" type="button" aria-label="Перейти к заявке и расчёту">' +
          '<svg viewBox="0 0 24 24"><path d="M3.5 5h2.2l2 10h9.4l1.9-7.2H7"/><circle cx="9.5" cy="19" r="1.35"/><circle cx="16.5" cy="19" r="1.35"/></svg>' +
          '<b class="fw-catcart-cnt" data-cnt>0</b></button>' +
        '<div class="fw-cam"><div class="fw-cgrid"></div></div>' +
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
      // карточка стоит на 46px выше crest и сама ~60px высотой → низ контента держим выше её верха
      sticky.style.setProperty('--fwbot', (H - crest + 104) + 'px');
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
  // Плавная инерция (lerp) — колесо мягко, «по-масляному» догоняет цель. Без пружины и доводки.
  function frame() {
    raf = null;
    if (reduced) { theta = targetTheta; vel = 0; apply(); return; }
    var disp = targetTheta - theta;
    theta += disp * 0.12;
    apply();
    if (Math.abs(disp) < 0.02) { theta = targetTheta; vel = 0; }
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
          '<em class="fw-tag">' + p.tag + '</em><i class="fw-add"></i>' +
          '<span class="fw-cap"><b>' + p.name + '</b><span class="fw-price">' + p.price + '</span></span></div>';
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
      function setCnt(n) {
        if (cnt) { cnt.textContent = String(n); cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump'); }
        cart.classList.toggle('has', n > 0);
      }
      function setDollyOrigin() {
        var rr = reals(); if (!rr[0] || !rr[1]) return;
        var a = rr[0].getBoundingClientRect(), b = rr[1].getBoundingClientRect(), pc = cam.getBoundingClientRect();
        cam.style.transformOrigin = ((a.left + a.right + b.left + b.right) / 4 - pc.left) + 'px ' + ((a.top + a.bottom) / 2 - pc.top) + 'px';
      }
      function resetChoose() {
        grid.classList.remove('in');
        cam.classList.remove('dolly', 'will'); cam.style.transformOrigin = '';
        reals().forEach(function (el) { el.classList.remove('filled'); var ad = el.querySelector('.fw-add'); if (ad) ad.classList.remove('on'); });
        if (cnt) cnt.textContent = '0';
        cart.classList.remove('has', 'press');
        ccur.classList.remove('show', 'press');
      }
      function finalState() {   // статичный «готовый» кадр (для stop() и prefers-reduced-motion)
        grid.classList.add('in');
        cam.classList.remove('dolly', 'will'); cam.style.transformOrigin = '';
        reals().forEach(function (el) { el.classList.add('filled'); var ad = el.querySelector('.fw-add'); if (ad) ad.classList.add('on'); });
        if (cnt) cnt.textContent = '2';
        cart.classList.add('has'); cart.classList.remove('press');
        ccur.classList.remove('show', 'press');
      }
      buildGrid();
      if (reduced) finalState();
      if (mq.addEventListener) mq.addEventListener('change', function () { buildGrid(); if (!running) finalState(); });
      // реальный клик по корзине пользователем → аккуратно доводит на шаг 2 «Заявка и расчёт»
      cart.addEventListener('click', function () { scrollToStep(1); });
      api.start = function () {
        running = true;
        (function loop() {
          if (!running) return;
          resetChoose();
          var rr = reals();
          var m = catalog.classList.contains('is-mobile');
          var T = m
            ? { fill: 1750, dolly: 2250, add0: 3300, add1: 4250, cart: 4780, press: 5320, go: 5580, loop: 8400 }
            : { fill: 2000, dolly: 2600, add0: 3850, add1: 4900, cart: 5960, press: 6650, go: 6960, loop: 9800 };
          // 1) плитки каталога появляются из центра (задержка = кольцо, чистый CSS)
          t(function () { if (!running) return; grid.classList.add('in'); }, 120);
          // 2) две центральные карточки заполняются данными
          t(function () { if (!running) return; rr.forEach(function (el) { el.classList.add('filled'); }); }, T.fill);
          // 3) «камера» приближается к паре (origin — по живым rect карточек)
          t(function () { if (!running) return; setDollyOrigin(); cam.classList.add('will', 'dolly'); }, T.dolly);
          // 4) курсор добавляет каждую карточку (строго ПОСЛЕ доводки камеры — цель не движется)
          t(function () { if (!running) return; ccur.classList.add('show'); if (rr[0]) curTo(ccur, rr[0].querySelector('.fw-add'), 540, 0.5, 0.5); }, T.add0);
          t(function () { if (!running) return; ccur.classList.add('press'); if (rr[0]) rr[0].querySelector('.fw-add').classList.add('on'); setCnt(1); }, T.add0 + 640);
          t(function () { if (!running) return; ccur.classList.remove('press'); }, T.add0 + 820);
          t(function () { if (!running) return; if (rr[1]) curTo(ccur, rr[1].querySelector('.fw-add'), 500, 0.5, 0.5); }, T.add1);
          t(function () { if (!running) return; ccur.classList.add('press'); if (rr[1]) rr[1].querySelector('.fw-add').classList.add('on'); setCnt(2); }, T.add1 + 600);
          t(function () { if (!running) return; ccur.classList.remove('press'); }, T.add1 + 780);
          // 5) курсор на корзину (в углу, вне камеры → всегда доступна) → нажатие → авто-переход на шаг 2
          t(function () { if (!running) return; curTo(ccur, cart, 620, 0.5, 0.5); }, T.cart);
          t(function () { if (!running) return; ccur.classList.add('press'); cart.classList.add('press'); }, T.press);
          t(function () { if (!running) return; ccur.classList.remove('press'); cart.classList.remove('press'); }, T.press + 240);
          t(function () { if (!running) return; scrollToStep(1); }, T.go);
          // резерв: если переход не случился (остались на шаге) — сброс и повтор
          t(function () { if (!running) return; loop(); }, T.loop);
        })();
      };
      api.stop = function () { running = false; timers.forEach(clearTimeout); timers = []; finalState(); };
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
    var mf = pf;                                      // «Плавная инерция»: линейный маппинг, без магнита
    var idx = Math.max(0, Math.min(N - 1, Math.round(pf)));
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
    setActive(idx); sticky.classList.add('settle'); updateScene(); apply();
  };

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', layout);
  layout(); onScroll();
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
