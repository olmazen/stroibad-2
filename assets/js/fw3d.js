/* EGOE — реальный 3D для «Колеса заказа» (шаг «Выбор изделия»).
   FW3D.mount(stageEl, glbUrl) → живой Three.js-объект (грани как на чертеже) на плашке 3D.
   Мышь реально вращает объект (drag). Демо-режим сам крутит и «приближает» (spin()).
   Three.js и модель тянутся ЛЕНИВО — только когда колесо доехало и сцена запущена,
   поэтому главная страница не тяжелеет. Требует <script type="importmap"> с 'three' и 'three/addons/'. */
(function () {
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
    var inst = { core: null, want: false, dead: false };
    inst.resume = function () { inst.want = true; if (inst.core) inst.core.start(); };
    inst.pause = function () { inst.want = false; if (inst.core) inst.core.stop(); };
    inst.spin = function () { if (inst.core) inst.core.spin(); };
    inst.reset = function () { if (inst.core) inst.core.reset(); };
    inst.destroy = function () { inst.dead = true; if (inst.core) inst.core.destroy(); };
    loadMods().then(function (m) { if (!inst.dead) build(m, stage, glb, inst); })
      .catch(function (e) { console.warn('FW3D modules', e); });
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
    var controls = new OC(cam, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.09; controls.enablePan = false;
    controls.enableZoom = false;              /* колесо мыши НЕ перехватываем — иначе ловушка при прокрутке страницы */
    controls.rotateSpeed = 0.85;
    controls.autoRotate = true; controls.autoRotateSpeed = 1.0;   /* ненавязчивое вращение */
    var running = false, loaded = false, raf = null, W = 1, H = 1, D = 1, edgeMats = [], zoomTgt = 1;

    function fit() { var a = W / H, f = D * 0.66; cam.left = -f * a; cam.right = f * a; cam.top = f; cam.bottom = -f; cam.updateProjectionMatrix(); }
    function resize() { W = stage.clientWidth || 1; H = stage.clientHeight || 1; renderer.setSize(W, H, false); edgeMats.forEach(function (lm) { lm.resolution.set(W, H); }); fit(); }
    function tick() {
      if (Math.abs(cam.zoom - zoomTgt) > 0.002) { cam.zoom += (zoomTgt - cam.zoom) * 0.08; cam.updateProjectionMatrix(); }
      controls.update(); renderer.render(scene, cam);
    }
    function loop() { if (!running) { raf = null; return; } raf = requestAnimationFrame(loop); tick(); }
    function startLoop() { if (running && loaded && raf == null) raf = requestAnimationFrame(loop); }
    function reveal() { if (loaded) stage.classList.add('has3d'); }   /* показываем живой холст, скрываем чертёж-заглушку */

    var spinTimers = [];
    function clearSpin() { spinTimers.forEach(clearTimeout); spinTimers = []; }
    var core = {
      start: function () { running = true; startLoop(); reveal(); },
      stop: function () { running = false; if (raf) { cancelAnimationFrame(raf); raf = null; } },
      /* демо: активнее крутит + «приближает» объект, потом мягко возвращается */
      spin: function () {
        clearSpin();
        controls.autoRotateSpeed = 2.6; zoomTgt = 1.72;
        spinTimers.push(setTimeout(function () { zoomTgt = 1.12; }, 1500));
        spinTimers.push(setTimeout(function () { controls.autoRotateSpeed = 1.0; zoomTgt = 1; }, 2900));
      },
      reset: function () { clearSpin(); controls.autoRotateSpeed = 1.0; zoomTgt = 1; if (loaded) { cam.zoom = 1; cam.updateProjectionMatrix(); } stage.classList.remove('has3d'); },
      destroy: function () {
        clearSpin(); running = false; if (raf) cancelAnimationFrame(raf);
        removeEventListener('resize', resize);
        try { controls.dispose(); renderer.dispose(); } catch (e) {}
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        stage.classList.remove('has3d');
      }
    };
    inst.core = core;

    var draco = new DL(); draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    var loader = new GL(); loader.setDRACOLoader(draco);
    loader.load(glb, function (g) {
      g.scene.updateWorldMatrix(true, true);
      var group = new THREE.Group();
      var fillMat = new THREE.MeshBasicMaterial({ color: 0x0c2136, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      g.scene.traverse(function (o) {
        if (o.isMesh && o.geometry) {
          var q = o.geometry.clone(); q.applyMatrix4(o.matrixWorld);
          group.add(new THREE.Mesh(q, fillMat));
          var lsg = new LSG().fromEdgesGeometry(new THREE.EdgesGeometry(q, 18));
          var lm = new LM({ color: 0xEDEFF1, linewidth: 1.5, transparent: true }); lm.resolution.set(W || 1, H || 1);
          edgeMats.push(lm); group.add(new LS2(lsg, lm));
        }
      });
      var box = new THREE.Box3().setFromObject(group);
      var c = box.getCenter(new THREE.Vector3()); group.position.set(-c.x, -c.y, -c.z);
      var size = box.getSize(new THREE.Vector3()); D = Math.max(size.x, size.y, size.z) || 1;
      scene.add(group);
      cam.position.set(-D * 2, D * 1.5, D * 2.3); controls.target.set(0, 0, 0);
      resize(); addEventListener('resize', resize);
      loaded = true; renderer.render(scene, cam);   /* тёплый первый кадр */
      startLoop(); if (running) reveal();
    }, undefined, function (err) { console.warn('FW3D glb', err); });

    if (inst.want) core.start();
  }

  window.FW3D = { mount: mount };
})();
