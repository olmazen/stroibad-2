/* EGOE — 3D-чертёж для страниц Art Déco.
   На .ad-plate[data-glb] добавляет 3D-модель (грани как на чертеже) с ленивой загрузкой
   по кнопке «3D-модель». Three.js и модель тянутся ТОЛЬКО при клике — страница не тяжелеет.
   Пока грузится (8-15с) — анимация «сборки» каркаса: точки → грани.
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

  /* ── анимация загрузки: каркас-скамейка «собирается» из точек и граней ── */
  function startLoader(host) {
    host.textContent = '';
    var wrap = document.createElement('div'); wrap.className = 'ad3d-load-wrap';
    var cv = document.createElement('canvas'); cv.className = 'ad3d-load-cv';
    var lbl = document.createElement('div'); lbl.className = 'ad3d-load-lbl'; lbl.textContent = 'Подготовка модели…';
    var barw = document.createElement('div'); barw.className = 'ad3d-load-bar'; var bar = document.createElement('i'); barw.appendChild(bar);
    wrap.appendChild(cv); wrap.appendChild(lbl); wrap.appendChild(barw); host.appendChild(wrap);
    var ctx = cv.getContext('2d'), dpr = Math.min(devicePixelRatio, 2), CW = 210, CH = 150;
    cv.width = CW * dpr; cv.height = CH * dpr; cv.style.width = CW + 'px'; cv.style.height = CH + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* стилизованный слатовый каркас-скамейка */
    var V = [
      [-1, 0, -0.5], [1, 0, -0.5], [1, 0, 0.5], [-1, 0, 0.5],            /* 0-3 сиденье */
      [-0.9, -0.62, -0.4], [0.9, -0.62, -0.4], [0.9, -0.62, 0.4], [-0.9, -0.62, 0.4], /* 4-7 низ ног */
      [-1, 0.82, -0.72], [1, 0.82, -0.72]                                 /* 8-9 верх спинки */
    ];
    var E = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [2, 6], [3, 7], [4, 5], [5, 6], [6, 7], [7, 4], [0, 8], [1, 9], [8, 9]];
    var i, zi, f, y, z;
    for (i = 0; i < 3; i++) { zi = -0.25 + i * 0.25; var a = V.length; V.push([-1, 0, zi], [1, 0, zi]); E.push([a, a + 1]); }        /* слаты сиденья */
    for (i = 0; i < 3; i++) { f = 0.3 + i * 0.26; y = f * 0.82; z = -0.5 + f * (-0.72 + 0.5); var b2 = V.length; V.push([-1, y, z], [1, y, z]); E.push([b2, b2 + 1]); } /* слаты спинки */

    var cx = CW / 2, cy = CH / 2 + 16, S = CH * 0.30;
    function proj(v, ry) {
      var c = Math.cos(ry), s = Math.sin(ry);
      var x = v[0] * c - v[2] * s, z2 = v[0] * s + v[2] * c;
      var ce = Math.cos(0.42), se = Math.sin(0.42), y2 = v[1] * ce - z2 * se;
      return [cx + x * S, cy - y2 * S];
    }
    var start = performance.now(), raf = null, stopped = false, prog = 0.05, target = 0.08, dotT = V.length * 0.045;
    function draw(now) {
      if (stopped) return;
      var t = (now - start) / 1000, ry = 0.5 + t * 0.5;
      prog += (target - prog) * 0.07; bar.style.width = (prog * 100).toFixed(1) + '%';
      ctx.clearRect(0, 0, CW, CH);
      for (var j = 0; j < E.length; j++) {
        var et = dotT + 0.1 + j * 0.03, k = (t - et) / 0.4; if (k <= 0) continue; if (k > 1) k = 1;
        var a = proj(V[E[j][0]], ry), b = proj(V[E[j][1]], ry);
        ctx.strokeStyle = 'rgba(228,232,238,' + (0.25 + 0.5 * k) + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k); ctx.stroke();
      }
      for (var q = 0; q < V.length; q++) {
        var ft = (t - q * 0.045) / 0.3; if (ft <= 0) continue; if (ft > 1) ft = 1;
        var p = proj(V[q], ry), r = 2.1 * ft;
        ctx.fillStyle = 'rgba(242,111,29,' + (0.16 * ft) + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], r * 2.6, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(242,111,29,' + (0.92 * ft) + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return {
      stage: function (txt, p) { lbl.textContent = txt; target = p; },
      stop: function () { stopped = true; if (raf) cancelAnimationFrame(raf); target = 1; if (wrap.parentNode) setTimeout(function () { if (wrap.parentNode) wrap.remove(); }, 300); }
    };
  }

  async function boot() {
    var ld = startLoader(v3d.querySelector('.ad-3d-load'));
    try {
      ld.stage('Загрузка 3D-движка…', 0.2);
      var THREE = await import('three'); ld.stage('Загрузка 3D-движка…', 0.42);
      var OC = (await import('three/addons/controls/OrbitControls.js')).OrbitControls; ld.stage('Загрузчик модели…', 0.55);
      var GL = (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader;
      var DL = (await import('three/addons/loaders/DRACOLoader.js')).DRACOLoader; ld.stage('Декодер геометрии…', 0.68);
      var LS2 = (await import('three/addons/lines/LineSegments2.js')).LineSegments2;
      var LSG = (await import('three/addons/lines/LineSegmentsGeometry.js')).LineSegmentsGeometry;
      var LM = (await import('three/addons/lines/LineMaterial.js')).LineMaterial; ld.stage('Построение граней…', 0.82);
      build(THREE, OC, GL, DL, LS2, LSG, LM, ld);
    } catch (err) {
      console.error('3D load', err); ld.stop(); var l = v3d.querySelector('.ad-3d-load'); if (l) l.textContent = '3D недоступно';
    }
  }

  function build(THREE, OC, GL, DL, LS2, LSG, LM, ld) {
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
      var geo = geos[0]; if (!geo) { if (ld) ld.stop(); return; }
      geo.computeBoundingBox(); var c = geo.boundingBox.getCenter(new THREE.Vector3()); geo.translate(-c.x, -c.y, -c.z);
      var size = geo.boundingBox.getSize(new THREE.Vector3()); D = Math.max(size.x, size.y, size.z) || 1;
      var fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0c2136, transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      scene.add(fill);
      var lsg = new LSG().fromEdgesGeometry(new THREE.EdgesGeometry(geo, 9));
      var lm = new LM({ color: 0xEDEFF1, linewidth: 1.7 }); lm.resolution.set(W || 1, H || 1);
      lines = new LS2(lsg, lm); scene.add(lines);
      cam.position.set(-D * 2, D * 1.6, D * 2.3); controls.target.set(0, 0, 0);
      resize();
      if (ld) ld.stop();
      v3d.classList.add('ready');
      running = true; loop();
    }, undefined, function () { if (ld) ld.stop(); var l = v3d.querySelector('.ad-3d-load'); if (l) l.textContent = 'Не удалось загрузить модель'; });
    addEventListener('resize', resize); resize();
  }
})();
