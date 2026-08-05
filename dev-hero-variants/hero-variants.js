(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;
  var stage = document.getElementById('showroom-stage');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.variant-tab[data-variant]'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('[data-variant-panel]'));
  var deviceButtons = Array.prototype.slice.call(document.querySelectorAll('[data-device-button]'));
  var stepButtons = Array.prototype.slice.call(document.querySelectorAll('[data-step]'));
  var copyButton = document.querySelector('[data-copy-link]');
  var liveRegion = document.querySelector('.sr-live');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarsePointer = window.matchMedia('(hover: none), (pointer: coarse)');
  var state = { variant: 1, device: 'desktop' };
  var transitionTimer = 0;
  var entranceTimer = 0;
  var ambientTimer = 0;
  var ambientResumeTimer = 0;
  var resizeFrame = 0;

  var variantMeta = {
    1: {
      kicker: 'ОБЪЕКТ КАК ДОКАЗАТЕЛЬСТВО',
      title: 'Живой объект + подписи к изделиям',
      description: 'Фото становится интерфейсом: световые метки показывают изделия EGOE прямо в архитектуре объекта.'
    },
    2: {
      kicker: 'СМЫСЛ ВМЕСТО КАТАЛОГА',
      title: 'Одна система. Один ответственный.',
      description: 'Монументальная типографика превращает главный бизнес-смысл в центральный образ первого экрана.'
    },
    3: {
      kicker: 'КАРТА КОМПЛЕКТАЦИИ',
      title: 'Весь объект как интерактивный план',
      description: 'Аэросъёмка раскрывает фасад, двор, МАФ и ограждения как части одной поставки.'
    },
    4: {
      kicker: 'ЧЕСТНОЕ ПРОИЗВОДСТВО',
      title: 'Цех как живой производственный ритм',
      description: 'Последовательность операций показывает реальный путь изделия от материала до партии на объект.'
    },
    5: {
      kicker: 'ВХОД ЧЕРЕЗ ЗАДАЧУ',
      title: 'Выбор зоны ведёт прямо в решение',
      description: 'Интерактивный экран одновременно объясняет ассортимент и направляет пользователя в нужную категорию.'
    }
  };

  var zoneData = {
    facade: {
      number: '01 / ФАСАД',
      title: 'Корзины и декоративные экраны',
      text: 'Размер, рисунок и RAL синхронизируются с архитектурой здания.',
      desktop: { x: '82%', y: '39%', shiftX: '-.4%', shiftY: '.2%' },
      mobile: { x: '58%', y: '45%', shiftX: '0px', shiftY: '0px' }
    },
    yard: {
      number: '02 / ДВОР',
      title: 'Элементы благоустройства',
      text: 'Скамьи, урны и навесы собираются в единую серию для территории.',
      desktop: { x: '17%', y: '44%', shiftX: '.7%', shiftY: '0%' },
      mobile: { x: '31%', y: '49%', shiftX: '12px', shiftY: '-3px' }
    },
    maf: {
      number: '03 / МАФ',
      title: 'Серийные и проектные решения',
      text: 'Типовые модели адаптируются по размерам, материалам и цвету объекта.',
      desktop: { x: '32%', y: '65%', shiftX: '.35%', shiftY: '-.6%' },
      mobile: { x: '61%', y: '57%', shiftX: '-8px', shiftY: '-7px' }
    },
    fence: {
      number: '04 / ОГРАЖДЕНИЯ',
      title: 'Контур и безопасность территории',
      text: 'Ограждения связываются с остальными изделиями геометрией и палитрой.',
      desktop: { x: '68%', y: '39%', shiftX: '-.25%', shiftY: '.25%' },
      mobile: { x: '71%', y: '38%', shiftX: '-14px', shiftY: '5px' }
    }
  };

  function clampVariant(value) {
    var number = parseInt(value, 10);
    return number >= 1 && number <= 5 ? number : 1;
  }

  function parseLocation() {
    var match = window.location.hash.match(/^#v([1-5])-(desktop|mobile)$/i);
    var params = new URLSearchParams(window.location.search);
    var variant = match ? clampVariant(match[1]) : clampVariant(params.get('variant'));
    var requestedDevice = match ? match[2].toLowerCase() : params.get('device');
    var device = requestedDevice === 'desktop' || requestedDevice === 'mobile'
      ? requestedDevice
      : (window.innerWidth <= 720 ? 'mobile' : 'desktop');
    return { variant: variant, device: device };
  }

  function updateUrl() {
    var nextHash = '#v' + state.variant + '-' + state.device;
    if (window.location.hash === nextHash) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search + nextHash);
  }

  function announce(message) {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    window.setTimeout(function () { liveRegion.textContent = message; }, 20);
  }

  function updateCaption() {
    var meta = variantMeta[state.variant];
    var number = document.querySelector('[data-caption-number]');
    var kicker = document.querySelector('[data-caption-kicker]');
    var title = document.querySelector('[data-caption-title]');
    var description = document.querySelector('[data-caption-description]');
    if (number) number.textContent = String(state.variant).padStart(2, '0');
    if (kicker) kicker.textContent = meta.kicker;
    if (title) title.textContent = meta.title;
    if (description) description.textContent = meta.description;
    root.style.setProperty('--active-index', String(state.variant));
  }

  function setPanelAvailability(panel, active, immediate) {
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    panel.inert = !active;
    if (active) {
      panel.hidden = false;
      return;
    }
    if (immediate || reducedMotion.matches) {
      panel.hidden = true;
      return;
    }
    window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(function () {
      panels.forEach(function (item) {
        if (!item.classList.contains('is-active')) item.hidden = true;
      });
    }, 470);
  }

  function triggerEntrance(panel) {
    window.clearTimeout(entranceTimer);
    panels.forEach(function (item) { item.classList.remove('is-entering'); });
    if (reducedMotion.matches) return;
    void panel.offsetWidth;
    panel.classList.add('is-entering');
    entranceTimer = window.setTimeout(function () { panel.classList.remove('is-entering'); }, 1250);
  }

  function triggerStageTransition() {
    if (!stage || reducedMotion.matches) return;
    stage.classList.remove('is-switching');
    void stage.offsetWidth;
    stage.classList.add('is-switching');
    window.setTimeout(function () { stage.classList.remove('is-switching'); }, 680);
  }

  function setVariant(nextVariant, options) {
    options = options || {};
    var variant = clampVariant(nextVariant);
    var changed = variant !== state.variant;
    state.variant = variant;
    body.dataset.variant = String(variant);

    panels.forEach(function (panel) {
      var active = Number(panel.dataset.variantPanel) === variant;
      if (active) setPanelAvailability(panel, true, true);
      panel.classList.toggle('is-active', active);
      if (!active) setPanelAvailability(panel, false, options.immediate);
    });

    tabs.forEach(function (tab) {
      var active = Number(tab.dataset.variant) === variant;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });

    updateCaption();
    updateUrl();
    scheduleScale();
    if (changed || options.enter) {
      var activePanel = panels.find(function (panel) { return Number(panel.dataset.variantPanel) === variant; });
      if (activePanel) triggerEntrance(activePanel);
      triggerStageTransition();
    }
    restartAmbient(options.userInitiated);
    if (!options.silent) announce('Вариант ' + variant + ' из 5. ' + variantMeta[variant].title + '. Режим ' + (state.device === 'mobile' ? 'mobile' : 'desktop') + '.');
  }

  function setDevice(nextDevice, options) {
    options = options || {};
    var device = nextDevice === 'mobile' ? 'mobile' : 'desktop';
    var changed = device !== state.device;
    state.device = device;
    body.dataset.device = device;
    deviceButtons.forEach(function (button) {
      var active = button.dataset.deviceButton === device;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    updateUrl();
    scheduleScale();
    if (changed) triggerStageTransition();
    restartAmbient(options.userInitiated);
    if (!options.silent) announce('Режим просмотра: ' + (device === 'mobile' ? 'mobile' : 'desktop') + '.');
  }

  function stepVariant(direction, userInitiated) {
    var next = ((state.variant - 1 + direction + 5) % 5) + 1;
    setVariant(next, { userInitiated: userInitiated });
  }

  function scaleFrames() {
    resizeFrame = 0;
    if (!stage) return;
    var rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var narrow = window.innerWidth <= 920;
    var edgeX = narrow ? 10 : 122;
    var edgeY = narrow ? 10 : 28;
    var desktopScale = Math.min(1, Math.max(.1, (rect.width - edgeX) / 1440), Math.max(.1, (rect.height - edgeY) / 810));
    var phone = document.querySelector('.concept.is-active .phone-preview') || document.querySelector('.phone-preview');
    var phoneWidth = phone && phone.offsetWidth ? phone.offsetWidth : 390;
    var phoneHeight = phone && phone.offsetHeight ? phone.offsetHeight : 784;
    var mobileEdgeX = window.innerWidth <= 720 ? 8 : 56;
    var mobileEdgeY = window.innerWidth <= 720 ? 8 : 26;
    var phoneScale = Math.min(1, Math.max(.1, (rect.width - mobileEdgeX) / phoneWidth), Math.max(.1, (rect.height - mobileEdgeY) / phoneHeight));
    root.style.setProperty('--desktop-scale', desktopScale.toFixed(4));
    root.style.setProperty('--phone-scale', phoneScale.toFixed(4));
  }

  function scheduleScale() {
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(scaleFrames);
  }

  function swapCopy(container, callback) {
    if (!container || reducedMotion.matches) {
      callback();
      return;
    }
    container.classList.add('is-updating');
    window.setTimeout(function () {
      callback();
      window.requestAnimationFrame(function () { container.classList.remove('is-updating'); });
    }, 130);
  }

  function selectObjectPin(pin, automatic) {
    var stageScope = pin.closest('.v1-desktop');
    if (!stageScope) return;
    var pins = Array.prototype.slice.call(stageScope.querySelectorAll('.object-pin'));
    pins.forEach(function (item) {
      var active = item === pin;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var note = stageScope.querySelector('.v1-note');
    swapCopy(note, function () {
      var title = stageScope.querySelector('[data-object-note-title]');
      var copy = stageScope.querySelector('[data-object-note-copy]');
      if (title) title.textContent = pin.dataset.objectNote || '';
      if (copy) copy.textContent = pin.dataset.objectCopy || '';
    });
    if (!automatic) restartAmbient(true);
  }

  function selectMobileObjectPin(pin, automatic) {
    var screen = pin.closest('.m1-screen');
    if (!screen) return;
    var pins = Array.prototype.slice.call(screen.querySelectorAll('.m1-pin'));
    var index = pins.indexOf(pin);
    pins.forEach(function (item) {
      var active = item === pin;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var sheet = screen.querySelector('.m1-sheet');
    swapCopy(sheet && sheet.querySelector('b'), function () {
      var copy = screen.querySelector('[data-mobile-object-copy]');
      var number = sheet && sheet.querySelector(':scope > span');
      if (copy) copy.textContent = pin.dataset.mobileObject || '';
      if (number) number.textContent = String(index + 1).padStart(2, '0') + ' / СОСТАВ ОБЪЕКТА';
    });
    if (!automatic) restartAmbient(true);
  }

  function selectZone(scope, key, automatic) {
    var data = zoneData[key];
    if (!data) return;
    scope.dataset.activeZone = key;
    scope.querySelectorAll('[data-zone]').forEach(function (item) {
      var active = item.dataset.zone === key;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var copyContainer = scope.querySelector('.v3-zone-copy') || scope.querySelector('.m3-card');
    swapCopy(copyContainer, function () {
      var number = scope.querySelector('[data-zone-number]');
      var title = scope.querySelector('[data-zone-title]');
      var text = scope.querySelector('[data-zone-text]');
      if (number) number.textContent = data.number;
      if (title) title.textContent = data.title;
      if (text) text.textContent = data.text;
    });
    if (scope.classList.contains('v3-desktop')) {
      scope.style.setProperty('--map-x', data.desktop.x);
      scope.style.setProperty('--map-y', data.desktop.y);
      scope.style.setProperty('--map-shift-x', data.desktop.shiftX);
      scope.style.setProperty('--map-shift-y', data.desktop.shiftY);
    } else {
      scope.style.setProperty('--target-x', data.mobile.x);
      scope.style.setProperty('--target-y', data.mobile.y);
      scope.style.setProperty('--mobile-map-x', data.mobile.shiftX);
      scope.style.setProperty('--mobile-map-y', data.mobile.shiftY);
    }
    if (!automatic) restartAmbient(true);
  }

  function selectDesktopCategory(tile, automatic) {
    var grid = tile.closest('.v5-grid');
    if (!grid) return;
    grid.classList.add('has-selection');
    grid.querySelectorAll('.v5-tile').forEach(function (item) {
      var active = item === tile;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-expanded', active ? 'true' : 'false');
    });
    if (!automatic) restartAmbient(true);
  }

  function selectMobileCategory(card, automatic) {
    var deck = card.closest('[data-category-deck]');
    if (!deck) return;
    var cards = Array.prototype.slice.call(deck.querySelectorAll('[data-category-card]'));
    var index = cards.indexOf(card);
    cards.forEach(function (item) {
      var active = item === card;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-expanded', active ? 'true' : 'false');
      if (item !== card || automatic) item.dataset.armed = 'false';
    });
    var screen = deck.closest('.m5-screen');
    var counter = screen && screen.querySelector('.m5-counter');
    if (counter) counter.textContent = String(index + 1).padStart(2, '0') + ' / ' + String(cards.length).padStart(2, '0');
    if (!automatic) restartAmbient(true);
  }

  function clearAmbient() {
    window.clearInterval(ambientTimer);
    window.clearTimeout(ambientResumeTimer);
    ambientTimer = 0;
    ambientResumeTimer = 0;
  }

  function startAmbient() {
    clearAmbient();
    if (reducedMotion.matches || document.hidden) return;
    if (state.variant === 1) {
      ambientTimer = window.setInterval(function () {
        var selector = state.device === 'mobile' ? '.concept-1 .m1-pin' : '.concept-1 .object-pin';
        var items = Array.prototype.slice.call(document.querySelectorAll(selector));
        var activeIndex = items.findIndex(function (item) { return item.classList.contains('is-active'); });
        var next = items[(activeIndex + 1) % items.length];
        if (!next) return;
        if (state.device === 'mobile') selectMobileObjectPin(next, true); else selectObjectPin(next, true);
      }, 5600);
    } else if (state.variant === 3) {
      ambientTimer = window.setInterval(function () {
        var scope = document.querySelector(state.device === 'mobile' ? '.m3-screen[data-map-scope]' : '.v3-desktop[data-map-scope]');
        if (!scope) return;
        var keys = Object.keys(zoneData);
        var current = keys.indexOf(scope.dataset.activeZone || 'facade');
        selectZone(scope, keys[(current + 1) % keys.length], true);
      }, 4700);
    } else if (state.variant === 5 && state.device === 'mobile') {
      ambientTimer = window.setInterval(function () {
        var cards = Array.prototype.slice.call(document.querySelectorAll('.concept-5 .m5-card'));
        var current = cards.findIndex(function (card) { return card.classList.contains('is-active'); });
        var next = cards[(current + 1) % cards.length];
        if (next) selectMobileCategory(next, true);
      }, 4400);
    }
  }

  function restartAmbient(userInitiated) {
    clearAmbient();
    if (userInitiated) {
      ambientResumeTimer = window.setTimeout(startAmbient, 9000);
    } else {
      startAmbient();
    }
  }

  function copyCurrentLink() {
    var url = window.location.href;
    var finish = function (success) {
      if (!copyButton) return;
      copyButton.classList.toggle('is-copied', success);
      copyButton.setAttribute('aria-label', success ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку');
      announce(success ? 'Ссылка на выбранный вариант скопирована.' : 'Не удалось скопировать ссылку.');
      window.setTimeout(function () {
        copyButton.classList.remove('is-copied');
        copyButton.setAttribute('aria-label', 'Скопировать ссылку на выбранный вариант');
      }, 1800);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(function () { finish(true); }, function () { finish(false); });
      return;
    }
    var area = document.createElement('textarea');
    area.value = url;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var success = false;
    try { success = document.execCommand('copy'); } catch (error) { success = false; }
    area.remove();
    finish(success);
  }

  function bindControls() {
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { setVariant(tab.dataset.variant, { userInitiated: true }); });
      tab.addEventListener('keydown', function (event) {
        var nextIndex = null;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        setVariant(tabs[nextIndex].dataset.variant, { userInitiated: true });
        tabs[nextIndex].focus();
      });
    });
    deviceButtons.forEach(function (button) {
      button.addEventListener('click', function () { setDevice(button.dataset.deviceButton, { userInitiated: true }); });
    });
    stepButtons.forEach(function (button) {
      button.addEventListener('click', function () { stepVariant(Number(button.dataset.step), true); });
    });
    if (copyButton) copyButton.addEventListener('click', copyCurrentLink);

    document.querySelectorAll('.object-pin').forEach(function (pin, index) {
      pin.setAttribute('aria-label', (index + 1) + '. ' + (pin.dataset.objectNote || 'Элемент объекта'));
      pin.setAttribute('aria-pressed', pin.classList.contains('is-active') ? 'true' : 'false');
      pin.addEventListener('click', function () { selectObjectPin(pin, false); });
    });
    document.querySelectorAll('.m1-pin').forEach(function (pin, index) {
      pin.setAttribute('aria-label', (index + 1) + '. ' + (pin.dataset.mobileObject || 'Элемент объекта'));
      pin.setAttribute('aria-pressed', pin.classList.contains('is-active') ? 'true' : 'false');
      pin.addEventListener('click', function () { selectMobileObjectPin(pin, false); });
    });
    document.querySelectorAll('[data-map-scope]').forEach(function (scope) {
      scope.querySelectorAll('[data-zone]').forEach(function (control) {
        control.addEventListener('click', function () { selectZone(scope, control.dataset.zone, false); });
      });
      selectZone(scope, 'facade', true);
    });

    document.querySelectorAll('.v5-grid').forEach(function (grid) {
      var tiles = Array.prototype.slice.call(grid.querySelectorAll('.v5-tile'));
      if (tiles[0]) selectDesktopCategory(tiles[0], true);
      tiles.forEach(function (tile) {
        tile.addEventListener('pointerenter', function () {
          if (!coarsePointer.matches) selectDesktopCategory(tile, true);
        });
        tile.addEventListener('focus', function () { selectDesktopCategory(tile, true); });
        tile.addEventListener('click', function (event) {
          if (!coarsePointer.matches) return;
          if (tile.dataset.armed !== 'true') {
            event.preventDefault();
            tiles.forEach(function (item) { item.dataset.armed = 'false'; });
            tile.dataset.armed = 'true';
            selectDesktopCategory(tile, false);
          }
        });
      });
    });

    document.querySelectorAll('[data-category-deck]').forEach(function (deck) {
      var cards = Array.prototype.slice.call(deck.querySelectorAll('[data-category-card]'));
      cards.forEach(function (card) {
        card.dataset.armed = 'false';
        card.addEventListener('click', function (event) {
          if (card.dataset.armed !== 'true') {
            event.preventDefault();
            cards.forEach(function (item) { item.dataset.armed = 'false'; });
            card.dataset.armed = 'true';
            selectMobileCategory(card, false);
          }
        });
      });
      if (cards[0]) selectMobileCategory(cards[0], true);
    });

    document.querySelectorAll('.desktop-preview a,.phone-preview a').forEach(function (link) {
      link.target = '_blank';
      link.rel = 'noopener';
    });
  }

  function bindGlobalInput() {
    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      var target = event.target;
      if (target && (target.matches('input,textarea,select,[contenteditable="true"]') || target.closest('[role="tablist"]'))) return;
      if (/^[1-5]$/.test(event.key)) {
        event.preventDefault();
        setVariant(Number(event.key), { userInitiated: true });
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepVariant(1, true);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepVariant(-1, true);
      } else if (event.key.toLowerCase() === 'd') {
        setDevice('desktop', { userInitiated: true });
      } else if (event.key.toLowerCase() === 'm') {
        setDevice('mobile', { userInitiated: true });
      }
    });

    if (stage) {
      var touchStart = null;
      stage.addEventListener('pointerdown', function (event) {
        if (event.pointerType !== 'touch' || event.target.closest('a,button')) return;
        touchStart = { x: event.clientX, y: event.clientY };
      }, { passive: true });
      stage.addEventListener('pointerup', function (event) {
        if (!touchStart || event.pointerType !== 'touch') return;
        var deltaX = event.clientX - touchStart.x;
        var deltaY = event.clientY - touchStart.y;
        touchStart = null;
        if (Math.abs(deltaX) < 54 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
        stepVariant(deltaX < 0 ? 1 : -1, true);
      }, { passive: true });
      stage.addEventListener('pointermove', function (event) {
        if (event.pointerType === 'touch') return;
        var rect = stage.getBoundingClientRect();
        stage.style.setProperty('--pointer-x', (event.clientX - rect.left) + 'px');
        stage.style.setProperty('--pointer-y', (event.clientY - rect.top) + 'px');
      }, { passive: true });
    }

    window.addEventListener('resize', scheduleScale, { passive: true });
    window.addEventListener('orientationchange', scheduleScale, { passive: true });
    window.addEventListener('hashchange', function () {
      var locationState = parseLocation();
      setDevice(locationState.device, { silent: true });
      setVariant(locationState.variant, { silent: true, enter: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) clearAmbient(); else startAmbient();
    });
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', startAmbient);
  }

  function initialise() {
    var locationState = parseLocation();
    state.variant = locationState.variant;
    state.device = locationState.device;
    bindControls();
    bindGlobalInput();
    setDevice(state.device, { silent: true });
    setVariant(state.variant, { silent: true, immediate: true, enter: true });
    scheduleScale();
    window.setTimeout(scheduleScale, 180);
    window.setTimeout(scheduleScale, 700);

    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([ready, new Promise(function (resolve) { window.setTimeout(resolve, 900); })]).then(function () {
      body.classList.remove('is-loading');
      body.classList.add('is-ready');
      scheduleScale();
    });
  }

  initialise();
})();
