/*
 * 右側：回転体の3D表示（three.js を使用）
 *
 * 左でかいた図形は、同じ向き（右が x、上が y）のまま空間に置き、実際に引いた軸のまわりに回す。
 * 視点の操作：1本指（マウスのドラッグ）で回転、2本指のピンチ（マウスのホイール）で拡大・縮小。
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  var DURATION = 4000;       // アニメーションの長さ（ミリ秒）
  var VIEW_AZIMUTH = 0.6;    // はじめの向き（横の角度）
  var VIEW_ELEVATION = 0.35; // はじめの向き（上からの角度）
  var FOV = 40;

  var COLORS = {
    background: 0xf4f7fb,
    solid: 0x4f9de8,
    shape: 0xf59e0b,
    shapeEdge: 0xb45309,
    axis: 0xdc2626
  };

  function View3D(container, callbacks) {
    this.container = container;
    this.cb = callbacks || {};
    this.ok = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
      container.innerHTML = '<p class="no3d">この端末では3Dを表示できません。<br>別のブラウザか端末でためしてください。</p>';
      return;
    }
    this.ok = true;
    this.renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(COLORS.background);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 1000);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a8, 1.6));
    var light = new THREE.DirectionalLight(0xffffff, 1.8);
    light.position.set(3, 4, 2);
    light.target.position.set(0, 0, -5);
    this.camera.add(light);
    this.camera.add(light.target);

    this.translucent = false;
    this.solidMaterial = new THREE.MeshPhongMaterial({
      color: COLORS.solid, shininess: 50, specular: 0x333333, side: THREE.DoubleSide
    });
    this.shapeMaterial = new THREE.MeshLambertMaterial({
      color: COLORS.shape, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.shapeEdge });
    this.axisMaterial = new THREE.MeshLambertMaterial({ color: COLORS.axis });

    this.preview = new THREE.Group();   // 元の平面図形と軸
    this.scene.add(this.preview);
    this.solid = null;                   // 回転体
    this.moving = null;                  // 回っている図形
    this.analysis = null;
    this.anim = null;

    this.target = new THREE.Vector3();
    this.azimuth = VIEW_AZIMUTH;
    this.elevation = VIEW_ELEVATION;
    this.distance = 20;
    this.fitDistance = 20;

    this.setupControls();
    var self = this;
    if (root.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(container);
    root.addEventListener('resize', function () { self.resize(); });
    this.resize();
  }

  /* ---------- 表示の更新 ---------- */

  View3D.prototype.resize = function () {
    if (!this.ok) return;
    var rect = this.container.getBoundingClientRect();
    var w = Math.max(50, Math.floor(rect.width)), h = Math.max(50, Math.floor(rect.height));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  };

  View3D.prototype.requestRender = function () {
    if (!this.ok || this.renderPending) return;
    this.renderPending = true;
    var self = this;
    root.requestAnimationFrame(function (now) {
      self.renderPending = false;
      self.tick(now);
      self.render();
    });
  };

  View3D.prototype.render = function () {
    var c = this.camera, ce = Math.cos(this.elevation);
    c.position.set(
      this.target.x + this.distance * Math.sin(this.azimuth) * ce,
      this.target.y + this.distance * Math.sin(this.elevation),
      this.target.z + this.distance * Math.cos(this.azimuth) * ce
    );
    c.lookAt(this.target);
    this.renderer.render(this.scene, c);
  };

  function disposeTree(obj) {
    obj.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
  }

  function clearGroup(g) {
    while (g.children.length) {
      var ch = g.children[0];
      g.remove(ch);
      disposeTree(ch);
    }
  }

  /* 平面図形（面と輪郭線）をつくる */
  View3D.prototype.makeShape = function (shape) {
    var s = new THREE.Shape();
    if (shape.type === 'polygon') {
      s.moveTo(shape.pts[0].x, shape.pts[0].y);
      for (var i = 1; i < shape.pts.length; i++) s.lineTo(shape.pts[i].x, shape.pts[i].y);
      s.closePath();
    } else {
      s.absarc(shape.c.x, shape.c.y, shape.r, 0, Math.PI * 2, false);
    }
    var g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.ShapeGeometry(s, 48), this.shapeMaterial));
    var pts = s.getPoints(64).map(function (p) { return new THREE.Vector3(p.x, p.y, 0); });
    g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), this.edgeMaterial));
    return g;
  };

  /* 軸：赤い点線を細い棒で表す（普通の線は細すぎて見えにくいため） */
  View3D.prototype.makeAxis = function (axis, t0, t1, size) {
    var f = root.Rev.axisFrame(axis);
    var g = new THREE.Group();
    if (!f) return g;
    var radius = Math.max(0.04, size * 0.012);
    var dash = Math.max(0.3, size * 0.06), gap = dash * 0.6;
    var geom = new THREE.CylinderGeometry(radius, radius, 1, 10);
    var dir = new THREE.Vector3(f.u.x, f.u.y, 0);
    var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    for (var t = t0; t < t1; t += dash + gap) {
      var len = Math.min(dash, t1 - t);
      var m = new THREE.Mesh(geom, this.axisMaterial);
      m.scale.set(1, len, 1);
      m.quaternion.copy(q);
      var mid = t + len / 2;
      m.position.set(f.A.x + f.u.x * mid, f.A.y + f.u.y * mid, 0);
      g.add(m);
    }
    return g;
  };

  /* 図形と軸が変わったとき：完成した立体は消して、平面図形と軸だけを表示する */
  View3D.prototype.setScene = function (shape, axis) {
    if (!this.ok) return;
    this.stopAnimation();
    this.removeSolid();
    clearGroup(this.preview);
    this.shapeData = shape;
    this.axisData = axis;

    var pts = this.shapePoints(shape);
    if (axis) { pts.push(axis.p1, axis.p2); }
    if (!pts.length) { this.requestRender(); return; }
    var box = boundsOf(pts);
    var size = Math.max(box.maxX - box.minX, box.maxY - box.minY, 2);

    if (shape) this.preview.add(this.makeShape(shape));
    if (axis) {
      var tr = this.tRange(axis, pts);
      this.preview.add(this.makeAxis(axis, tr[0] - size * 0.3, tr[1] + size * 0.3, size));
    }
    this.fitTo(new THREE.Vector3((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0), size * 0.75, false);
  };

  View3D.prototype.shapePoints = function (shape) {
    if (!shape) return [];
    if (shape.type === 'polygon') return shape.pts.slice();
    var c = shape.c, r = shape.r;
    return [{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r }];
  };

  /* 点を軸に投影したときの範囲 */
  View3D.prototype.tRange = function (axis, pts) {
    var f = root.Rev.axisFrame(axis);
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) {
      var t = (p.x - f.A.x) * f.u.x + (p.y - f.A.y) * f.u.y;
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    });
    if (this.shapeData && this.shapeData.type === 'circle') {
      var c = this.shapeData.c, tc = (c.x - f.A.x) * f.u.x + (c.y - f.A.y) * f.u.y;
      lo = Math.min(lo, tc - this.shapeData.r); hi = Math.max(hi, tc + this.shapeData.r);
    }
    return [lo, hi];
  };

  function boundsOf(pts) {
    var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    pts.forEach(function (p) {
      b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
      b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y);
    });
    return b;
  }

  View3D.prototype.removeSolid = function () {
    if (this.solid) { this.scene.remove(this.solid); this.solid.geometry.dispose(); this.solid = null; }
    if (this.moving) { this.scene.remove(this.moving); disposeTree(this.moving); this.moving = null; }
    this.analysis = null;
  };

  /* ---------- 回転体とアニメーション ---------- */

  /* analysis は Rev.analyze() の結果（ok: true のもの） */
  View3D.prototype.play = function (analysis) {
    if (!this.ok) return;
    this.stopAnimation();
    this.removeSolid();
    this.analysis = analysis;

    var surf = root.Rev.buildSurface(analysis);
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(surf.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(surf.normals, 3));
    geom.computeBoundingSphere();
    this.surface = surf;
    this.solid = new THREE.Mesh(geom, this.solidMaterial);
    this.scene.add(this.solid);

    this.moving = this.makeShape(this.shapeData);
    this.moving.matrixAutoUpdate = false;
    this.scene.add(this.moving);

    // 軸を立体より長く引き直す
    clearGroup(this.preview);
    this.preview.add(this.makeShape(this.shapeData));
    var sph = geom.boundingSphere;
    var f = analysis.frame;
    var tc = (sph.center.x - f.A.x) * f.u.x + (sph.center.y - f.A.y) * f.u.y;
    this.preview.add(this.makeAxis(this.axisData, tc - sph.radius * 1.35, tc + sph.radius * 1.35, sph.radius * 2));

    this.azimuth = VIEW_AZIMUTH;
    this.elevation = VIEW_ELEVATION;
    this.fitTo(sph.center.clone(), sph.radius * 1.15, true);
    this.replay();
  };

  View3D.prototype.replay = function () {
    if (!this.solid) return;
    this.anim = { start: null };
    this.setProgress(0);
    this.requestRender();
  };

  View3D.prototype.stopAnimation = function () {
    this.anim = null;
  };

  View3D.prototype.hasSolid = function () { return !!this.solid; };

  /* progress: 0（回し始め）〜 1（1周） */
  View3D.prototype.setProgress = function (progress) {
    var surf = this.surface;
    var k = Math.round(progress * surf.segments);
    this.solid.geometry.setDrawRange(0, k * surf.vertsPerSegment);

    var f = this.analysis.frame;
    var theta = progress * Math.PI * 2;
    var u = new THREE.Vector3(f.u.x, f.u.y, 0);
    // 軸のまわりに θ 回す：点 A へ移して回し、もとに戻す
    var m = new THREE.Matrix4().makeTranslation(f.A.x, f.A.y, 0)
      .multiply(new THREE.Matrix4().makeRotationAxis(u, theta))
      .multiply(new THREE.Matrix4().makeTranslation(-f.A.x, -f.A.y, 0));
    this.moving.matrix.copy(m);
    this.moving.matrixWorldNeedsUpdate = true;
    this.moving.visible = progress > 0 && progress < 1;
  };

  View3D.prototype.tick = function (now) {
    if (!this.anim) return;
    if (this.anim.start === null) this.anim.start = now;
    var p = Math.min(1, (now - this.anim.start) / DURATION);
    this.setProgress(p);
    if (p >= 1) {
      this.anim = null;
      if (this.cb.onFinish) this.cb.onFinish();
    } else {
      this.requestRender();
    }
  };

  View3D.prototype.setTranslucent = function (on) {
    if (!this.ok) return;
    this.translucent = on;
    this.solidMaterial.transparent = on;
    this.solidMaterial.opacity = on ? 0.4 : 1;
    this.solidMaterial.depthWrite = !on;
    this.solidMaterial.needsUpdate = true;
    this.requestRender();
  };

  View3D.prototype.clear = function () {
    this.setScene(null, null);
  };

  /* ---------- 視点 ---------- */

  View3D.prototype.fitTo = function (center, radius, resetDistance) {
    this.target.copy(center);
    var fov = this.camera.fov * Math.PI / 180;
    var fovMin = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    this.fitDistance = Math.max(3, radius / Math.sin(fovMin / 2));
    if (resetDistance || !this.userZoomed) this.distance = this.fitDistance;
    this.requestRender();
  };

  View3D.prototype.resetView = function () {
    if (!this.ok) return;
    this.azimuth = VIEW_AZIMUTH;
    this.elevation = VIEW_ELEVATION;
    this.distance = this.fitDistance;
    this.userZoomed = false;
    this.requestRender();
  };

  View3D.prototype.zoomBy = function (factor) {
    this.distance = Math.max(this.fitDistance * 0.3, Math.min(this.fitDistance * 4, this.distance * factor));
    this.userZoomed = true;
    this.requestRender();
  };

  View3D.prototype.setupControls = function () {
    var el = this.renderer.domElement, self = this;
    var pointers = new Map();
    var pinchDist = 0;

    function pinchLength() {
      var ps = Array.from(pointers.values());
      return Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
    }

    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
      if (pointers.size === 2) pinchDist = pinchLength();
    });
    el.addEventListener('pointermove', function (e) {
      var prev = pointers.get(e.pointerId);
      if (!prev) return;
      e.preventDefault();
      var cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        self.azimuth -= (cur.x - prev.x) * 0.01;
        self.elevation = Math.max(-1.5, Math.min(1.5, self.elevation + (cur.y - prev.y) * 0.01));
        self.requestRender();
      } else if (pointers.size === 2) {
        var d = pinchLength();
        if (pinchDist > 0 && d > 0) self.zoomBy(pinchDist / d);
        pinchDist = d;
      }
    });
    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 2) pinchDist = pinchLength();
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.zoomBy(Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
  };

  root.View3D = View3D;
})(window);
