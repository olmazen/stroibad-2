/* EGOE — реальный 3D для «Колеса заказа» (шаг «Выбор изделия»).
   FW3D.mount(stageEl, glbUrl) → ленивый Three.js-вьюер: объект гранями «как на чертеже».
   viewer.play() запускает раскадровку «человек рассматривает модель» (~8.4 с):
     ~1 с загрузка (полоска над чертежом) → подлёт камеры к объекту → мышь кружит его
     влево-вправо с лёгким «дрожанием руки» → наезд к детали, медленный осмотр → возврат.
   Кадрирование — по реальным габаритам модели: объект ЦЕЛИКОМ в кадре в обзорных фазах,
   срез допускается только в осознанном крупном плане. Настоящая мышь работает тоже:
   первый же drag по холсту прерывает демо и отдаёт вращение пользователю (OrbitControls).
   Three.js и модель тянутся ЛЕНИВО — главная не тяжелеет. Требует importmap 'three'.
   ВНИМАНИЕ: тайминги SEGS синхронизированы с движениями курсора сцены 'choose' в site.js. */
(function () {
  var D2R = Math.PI / 180;
  var LOAD_MS = 900;                                   // «1 секунда на загрузку»
  var BASE_TH = -38 * D2R, BASE_PH = 66 * D2R;         // базовый трёхчетвертной ракурс
  /* Раскадровка после загрузки (суммарно 7530 мс):
     0     подлёт (1100) — объект материализуется, камера наезжает издалека
     1100  мягкая посадка (350)
     1450  рука замерла (250)
     1700  драг №1 (1050) — кружит влево, лёгкий перелёт как у живой руки
     2750  пауза (380)
     3130  драг №2 (1150) — обратно через центр, чуть с другим наклоном
     4280  пауза (300)
     4580  наезд к детали (1350) — приближение, взгляд к верхнему узлу
     5930  осмотр (800) — медленно ведёт вдоль детали
     6730  отъезд (800) — возврат в красивый финальный ракурс */
  var SEGS = [
    { dur: 1100, th: 18, zoom: 1.05, mat: 1, ease: 'io' },
    { dur: 350, zoom: 1.0, ease: 'o' },
    { dur: 250, tremor: 1 },
    { dur: 1050, th: 42, ph: -5, ease: 'hu', tremor: 1 },
    { dur: 380, tremor: 1 },
    { dur: 1150, th: -68, ph: 7, ease: 'hu', tremor: 1 },
    { dur: 300, tremor: 1 },
    { dur: 1350, zoom: 1.58, tx: 1, th: 10, ph: 3, ease: 'io' },
    { dur: 800, th: 9, ease: 'io', tremor: 1 },
    { dur: 800, zoom: 1.0, tx: 0, th: -14, ease: 'io' }
  ];
  var EASE = {
    io: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    o: function (t) { return 1 - Math.pow(1 - t, 3); },
    /* «по-человечески»: медленный старт, разгон, мягкая посадка с крошечным перелётом */
    hu: function (t) { t = 0.5 - 0.5 * Math.cos(Math.PI * t); var s = 0.9, u = t - 1; return 1 + u * u * ((s + 1) * u + s); }
  };
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var modsP = null;
  function loadMods() {
    if (modsP) return modsP;
    modsP = (async function () {
      var THREE = await import('three');
      var OC = (await import('three/addons/controls/OrbitControls.js')).OrbitControls;
      var GL = (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader;
      var DL = (await import('three/addons/loaders/DRACOLoader.js')).DRACOLoader;
      var LS2 = (await import('three/addons/lines/LineSegments2.js')).LineSegments2;
      var LSG = (await import('three/addons/lines/LineSegmentsGeometry.js')).LineSegmentsGeometry;
      var LM = (await import('three/addons/lines/LineMaterial.js')).LineMaterial;
      return { THREE: THREE, OC: OC, GL: GL, DL: DL, LS2: LS2, LSG: LSG, LM: LM };
    })();
    return modsP;
  }

  function mount(stage, glb) {
    if (!stage) return null;
    var inst = { core: null, want: false, wantPlay: false, played: false, failedMods: false, dead: false };
    inst.resume = function () { inst.want = true; if (inst.core) inst.core.start(); };
    inst.pause = function () { inst.want = false; if (inst.core) inst.core.stop(); };
    inst.play = function () {
      inst.played = true;
      if (inst.core) { inst.wantPlay = false; inst.core.play(); }
      else if (inst.failedMods) { stage.classList.remove('ld'); stage.classList.add('fw3d-fb'); }  // модули не встали → покачиваем чертёж
      else { inst.wantPlay = true; inst.want = true; }
    };
    inst.spin = function () { inst.play(); };   // совместимость со старым API
    inst.reset = function () {
      inst.wantPlay = false; inst.played = false;
      stage.classList.remove('fw3d-fb');
      if (inst.core) inst.core.reset(); else stage.classList.remove('ld', 'has3d');
    };
    inst.state = function () { return inst.core ? inst.core.state() : null; };
    inst.destroy = function () { inst.dead = true; if (inst.core) inst.core.destroy(); };
    loadMods().then(function (m) { if (!inst.dead) build(m, stage, glb, inst); })
      .catch(function (e) {
        console.warn('FW3D modules', e); inst.failedMods = true;
        stage.classList.remove('ld');
        // fallback-покачивание НЕ на монтировании, а только когда демо реально дошло до 3D-акта
        if (inst.played || inst.wantPlay) stage.classList.add('fw3d-fb');
      });
    return inst;
  }

  function build(m, stage, glb, inst) {
    var THREE = m.THREE, OC = m.OC, GL = m.GL, DL = m.DL, LS2 = m.LS2, LSG = m.LSG, LM = m.LM;
    var canvas = document.createElement('canvas'); canvas.className = 'fw-pp-3dcv';
    stage.insertBefore(canvas, stage.firstChild);
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    var scene = new THREE.Scene();
    var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);

    var running = false, loaded = false, failed = false, waitLoad = false, raf = null, pend = null;
    var W = 1, H = 1, halfY = 0.5, halfDiag = 0.7, dist = 10;
    var sph = { th: BASE_TH, ph: BASE_PH }, zoomCur = 1, txCur = 0, matK = 1;
    var C0 = new THREE.Vector3(), CD = new THREE.Vector3(), tgt = new THREE.Vector3();
    var fillMats = [], edgeMats = [];
    var choreo = null, userTook = false, playAt = 0, lastNow = 0;

    /* наш pointerdown ДО OrbitControls: первый же захват мышью прерывает демо и отдаёт вращение.
       Гасим и отложенные фазы (pend/waitLoad), чтобы begin() не отобрал управление обратно. */
    canvas.addEventListener('pointerdown', function () {
      userTook = true; choreo = null;
      if (pend) { clearTimeout(pend); pend = null; }
      waitLoad = false; stage.classList.remove('ld');
      if (loaded) stage.classList.add('has3d');
      controls.enabled = true; controls.autoRotate = false;
    });
    var controls = new OC(cam, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
    controls.enableZoom = false;   /* колесо мыши не перехватываем — иначе ловушка при прокрутке страницы */
    controls.rotateSpeed = 0.85; controls.enabled = false;

    /* кадрирование: по высоте объекта и его «худшему» горизонтальному повороту — целиком в кадре при zoom ≤ 1 */
    function fit() {
      var a = W / H || 1;
      var f = Math.max(halfY * 1.9, (halfDiag / a) * 1.18, 0.001);
      cam.left = -f * a; cam.right = f * a; cam.top = f; cam.bottom = -f; cam.updateProjectionMatrix();
    }
    function resize() { W = stage.clientWidth || 1; H = stage.clientHeight || 1; renderer.setSize(W, H, false); edgeMats.forEach(function (lm) { lm.resolution.set(W, H); }); fit(); }
    function setMat(k) { matK = k; fillMats.forEach(function (mm) { mm.opacity = 0.92 * k; }); edgeMats.forEach(function (mm) { mm.opacity = k; }); }
    function applyCam(tr) {
      tgt.lerpVectors(C0, CD, txCur);
      var th = sph.th + (tr || 0), ph = Math.min(1.35, Math.max(0.25, sph.ph));
      var sp = Math.sin(ph);
      cam.position.set(tgt.x + Math.sin(th) * sp * dist, tgt.y + Math.cos(ph) * dist, tgt.z + Math.cos(th) * sp * dist);
      cam.lookAt(tgt); cam.zoom = zoomCur; cam.updateProjectionMatrix();
      controls.target.copy(tgt);
    }

    function nextSeg(now) {
      choreo.i++;
      if (choreo.i >= SEGS.length) {   // хореография кончилась: объект остаётся живым, чуть вращается
        choreo = null; controls.enabled = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.55;
        return;
      }
      choreo.t0 = now;
      choreo.from = { th: sph.th, ph: sph.ph, zm: zoomCur, tx: txCur, mat: matK };
    }
    function stepChoreo(now) {
      var s = SEGS[choreo.i], f = choreo.from;
      var k = Math.min(1, (now - choreo.t0) / s.dur);
      var e = (EASE[s.ease] || EASE.io)(k);
      if (s.th != null) sph.th = f.th + s.th * D2R * e;
      if (s.ph != null) sph.ph = f.ph + s.ph * D2R * e;
      if (s.zoom != null) zoomCur = f.zm + (s.zoom - f.zm) * e;
      if (s.tx != null) txCur = f.tx + (s.tx - f.tx) * e;
      if (s.mat != null && matK !== 1) setMat(f.mat + (s.mat - f.mat) * e);
      /* «дрожание руки»: два несинхронных синуса, гаснут на краях сегмента */
      var tr = s.tremor ? (Math.sin(now * 0.013) * 0.5 + Math.sin(now * 0.0029 * 10) * 0.3) * Math.sin(Math.PI * k) * 0.006 : 0;
      applyCam(tr);
      if (k >= 1) { if (choreo) nextSeg(now); }
    }
    function loop() {
      if (!running) { raf = null; lastNow = 0; return; }
      raf = requestAnimationFrame(loop);
      var now = performance.now();
      /* вкладку скрывали / rAF стоял: сдвигаем t0, чтобы раскадровка продолжилась, а не прыгнула */
      if (lastNow && choreo && now - lastNow > 400) choreo.t0 += (now - lastNow);
      lastNow = now;
      if (choreo) stepChoreo(now);
      else {
        /* самолечение после перехвата мышью посреди фазы: доводим прозрачность и «далёкий» зум */
        if (loaded && matK < 1) setMat(Math.min(1, matK + 0.08));
        if (loaded && zoomCur < 1) { zoomCur = Math.min(1, zoomCur + 0.015); cam.zoom = zoomCur; cam.updateProjectionMatrix(); }
        if (controls.enabled) controls.update();
      }
      if (loaded) renderer.render(scene, cam);
    }
    function startLoop() { if (running && raf == null) raf = requestAnimationFrame(loop); }

    function begin() {   // старт раскадровки: издалека, полупрозрачный, вне базового угла
      if (userTook) { stage.classList.add('has3d'); controls.enabled = true; return; }   // мышь уже у пользователя — не отбираем
      resize();          // плашка могла быть display:none при загрузке GLB (мобилка) — пересчитать размер
      stage.classList.add('has3d');
      controls.enabled = false; controls.autoRotate = false;
      sph.th = BASE_TH - 18 * D2R; sph.ph = BASE_PH; zoomCur = 0.52; txCur = 0; setMat(0); applyCam(0);
      choreo = { i: -1, t0: 0, from: null }; nextSeg(performance.now());
    }
    function revealStatic() {   // без раскадровки: статичный красивый ракурс (reduced-motion / поздняя загрузка)
      resize();
      stage.classList.add('has3d');
      sph.th = BASE_TH; sph.ph = BASE_PH; zoomCur = 1; txCur = 0; setMat(1); applyCam(0);
      controls.enabled = true; controls.autoRotate = false;
    }

    var core = {
      start: function () { running = true; startLoop(); },
      stop: function () { running = false; if (raf) { cancelAnimationFrame(raf); raf = null; } },
      play: function () {
        core.start();
        if (userTook) return;   // мышь у пользователя — демо не вмешивается до следующего цикла
        if (pend) clearTimeout(pend);
        choreo = null; waitLoad = false; playAt = performance.now();
        stage.classList.remove('has3d', 'fw3d-fb');
        stage.classList.add('ld');
        pend = setTimeout(function () {
          pend = null;
          if (failed) { stage.classList.remove('ld'); stage.classList.add('fw3d-fb'); return; }
          if (!loaded) { waitLoad = true; return; }   // полоска остаётся, пока модель реально грузится
          stage.classList.remove('ld');
          if (reduced) revealStatic(); else begin();
        }, LOAD_MS);
      },
      reset: function () {
        if (pend) { clearTimeout(pend); pend = null; }
        waitLoad = false; choreo = null; userTook = false; lastNow = 0;
        stage.classList.remove('has3d', 'ld', 'fw3d-fb');
        controls.enabled = false; controls.autoRotate = false;
        sph.th = BASE_TH; sph.ph = BASE_PH; zoomCur = 1; txCur = 0;
        if (loaded) { setMat(1); applyCam(0); }
      },
      state: function () {   // для отладки/проверки хореографии
        return { loaded: loaded, failed: failed, seg: choreo ? choreo.i : -1, th: +(sph.th / D2R).toFixed(1), ph: +(sph.ph / D2R).toFixed(1), zoom: +zoomCur.toFixed(3), tx: +txCur.toFixed(2), user: controls.enabled };
      },
      destroy: function () {
        core.reset(); running = false; if (raf) cancelAnimationFrame(raf);
        removeEventListener('resize', resize);
        try { controls.dispose(); renderer.dispose(); } catch (e) {}
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
    inst.core = core;

    var draco = new DL(); draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    var loader = new GL(); loader.setDRACOLoader(draco);
    loader.load(glb, function (g) {
      if (inst.dead) return;   // уничтожили до прихода модели — не строим сцену и не вешаем слушатели
      g.scene.updateWorldMatrix(true, true);
      var group = new THREE.Group();
      g.scene.traverse(function (o) {
        if (o.isMesh && o.geometry) {
          var q = o.geometry.clone(); q.applyMatrix4(o.matrixWorld);
          var fm = new THREE.MeshBasicMaterial({ color: 0x0c2136, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
          fillMats.push(fm); group.add(new THREE.Mesh(q, fm));
          var lsg = new LSG().fromEdgesGeometry(new THREE.EdgesGeometry(q, 18));
          var lm = new LM({ color: 0xEDEFF1, linewidth: 1.5, transparent: true, opacity: 1 }); lm.resolution.set(W || 1, H || 1);
          edgeMats.push(lm); group.add(new LS2(lsg, lm));
        }
      });
      var box = new THREE.Box3().setFromObject(group);
      var c = box.getCenter(new THREE.Vector3()); group.position.set(-c.x, -c.y, -c.z);
      var s = box.getSize(new THREE.Vector3());
      halfY = (s.y / 2) || 0.5;
      halfDiag = (Math.sqrt(s.x * s.x + s.z * s.z) / 2) || 0.7;
      dist = s.length() * 2 || 10;
      C0.set(0, 0, 0);
      CD.set(s.x * 0.18, s.y * 0.22, s.z * 0.05);   // «деталь» — верхний узел для крупного плана
      scene.add(group);
      addEventListener('resize', resize); resize(); applyCam(0);
      loaded = true;
      renderer.render(scene, cam);   // тёплый первый кадр
      if (waitLoad) {
        waitLoad = false; stage.classList.remove('ld');
        if (userTook) { stage.classList.add('has3d'); controls.enabled = true; }                       // мышь уже у пользователя
        else if (reduced || performance.now() - playAt > LOAD_MS + 1600) revealStatic();               // сильно опоздали — курсор ушёл вперёд, без раскадровки
        else begin();
      }
      startLoop();
    }, undefined, function (err) {
      console.warn('FW3D glb', err); failed = true;
      if (waitLoad || pend) { if (pend) { clearTimeout(pend); pend = null; } waitLoad = false; stage.classList.remove('ld'); stage.classList.add('fw3d-fb'); }
    });

    if (inst.wantPlay) { inst.wantPlay = false; core.play(); }
    else if (inst.want) core.start();
  }

  window.FW3D = { mount: mount };
})();
