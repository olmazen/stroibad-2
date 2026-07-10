/* EGOE — 3D-чертёж для страниц Art Déco.
   На .ad-plate[data-glb] добавляет 3D-модель (грани как на чертеже) с ленивой загрузкой
   по кнопке «3D-модель». Three.js и модель тянутся ТОЛЬКО при клике — страница не тяжелеет.
   Требует на странице <script type="importmap"> с 'three' и 'three/addons/'. */
(function () {
  var plate = document.querySelector('.ad-plate[data-glb]');
  if (!plate) return;
  var toggle = document.querySelector('.ad-viewtoggle');
  var v3d = plate.querySelector('.ad-3d');
  if (!toggle || !v3d) return;
  var GLB = plate.getAttribute('data-glb');
  var inited = false, api = null;

  toggle.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    toggle.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    if (b.getAttribute('data-view') === '3d') {
      plate.classList.add('is3d'); v3d.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function () { v3d.classList.add('show'); });
      if (!inited) { inited = true; boot(); } else if (api) { api.resume(); }
    } else {
      plate.classList.remove('is3d'); v3d.classList.remove('show'); v3d.setAttribute('aria-hidden', 'true');
      if (api) { api.pause(); }
    }
  });

  async function boot() {
    try {
      var THREE = await import('three');
      var OC = (await import('three/addons/controls/OrbitControls.js')).OrbitControls;
      var GL = (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader;
      var DL = (await import('three/addons/loaders/DRACOLoader.js')).DRACOLoader;
      var LS2 = (await import('three/addons/lines/LineSegments2.js')).LineSegments2;
      var LSG = (await import('three/addons/lines/LineSegmentsGeometry.js')).LineSegmentsGeometry;
      var LM = (await import('three/addons/lines/LineMaterial.js')).LineMaterial;
      build(THREE, OC, GL, DL, LS2, LSG, LM);
    } catch (err) {
      console.error('3D load', err); var l = v3d.querySelector('.ad-3d-load'); if (l) l.textContent = '3D недоступно';
    }
  }

  function build(THREE, OC, GL, DL, LS2, LSG, LM) {
    var canvas = document.createElement('canvas'); v3d.insertBefore(canvas, v3d.firstChild);
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    var scene = new THREE.Scene();
    var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
    var controls = new OC(cam, canvas); controls.enableDamping = true; controls.enablePan = false; controls.rotateSpeed = 0.9;
    var running = false, raf = null, lines = null, D = 1, W = 1, H = 1;
    function fit() { var a = W / H, f = D * 0.72; cam.left = -f * a; cam.right = f * a; cam.top = f; cam.bottom = -f; cam.updateProjectionMatrix(); }
    function resize() { W = plate.clientWidth; H = plate.clientHeight; renderer.setSize(W, H, false); if (lines) lines.material.resolution.set(W, H); fit(); }
    function loop() { if (!running) return; raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, cam); }
    api = { pause: function () { running = false; if (raf) cancelAnimationFrame(raf); raf = null; },
            resume: function () { if (!running) { running = true; loop(); } } };
    var draco = new DL(); draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    var loader = new GL(); loader.setDRACOLoader(draco);
    loader.load(GLB, function (g) {
      var geos = []; g.scene.updateWorldMatrix(true, true);
      g.scene.traverse(function (o) { if (o.isMesh) { var q = o.geometry.clone(); q.applyMatrix4(o.matrixWorld); geos.push(q); } });
      var geo = geos[0]; if (!geo) return;
      geo.computeBoundingBox(); var c = geo.boundingBox.getCenter(new THREE.Vector3()); geo.translate(-c.x, -c.y, -c.z);
      var size = geo.boundingBox.getSize(new THREE.Vector3()); D = Math.max(size.x, size.y, size.z) || 1;
      var fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0c2136, transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      scene.add(fill);
      var lsg = new LSG().fromEdgesGeometry(new THREE.EdgesGeometry(geo, 9));
      var lm = new LM({ color: 0xEDEFF1, linewidth: 1.7 }); lm.resolution.set(W || 1, H || 1);
      lines = new LS2(lsg, lm); scene.add(lines);
      cam.position.set(-D * 2, D * 1.6, D * 2.3); controls.target.set(0, 0, 0);
      resize();
      v3d.classList.add('ready');
      running = true; loop();
    });
    addEventListener('resize', resize); resize();
  }
})();
