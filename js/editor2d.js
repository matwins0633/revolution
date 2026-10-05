/*
 * 左側：方眼の上に平面図形と回転の軸をかく部分
 *
 * 座標は「1ます = 1」。頂点・円の中心・軸の点は方眼の交点に、円の半径は 0.5 ます刻みに吸いつく。
 * 軸を引いたあとは、図形の点が軸にも吸い付く（計算は snap.js）。
 * 指・タッチペン・マウスは、すべて Pointer Events で同じように扱う。
 */
(function (root) {
  'use strict';

  var HIT_PX = 26;          // つかめる範囲（画面上の大きさ）
  var HALF_UNITS = 7;       // 横方向に、中心から何ますずつ見せるか
  var HALF_UNITS_Y = 5;     // 縦方向に、少なくとも何ますずつ見せるか

  var COLORS = {
    grid: '#e3e8ef',
    gridBold: '#c4cdd8',
    fill: 'rgba(245, 158, 11, 0.35)',
    stroke: '#d97706',
    handle: '#ffffff',
    axis: '#dc2626',
    fit: '#16a34a',                        // 軸にぴったり合った点
    fitGlow: 'rgba(22, 163, 74, 0.25)'
  };
  var SAME_EPS = 1e-6;
  var Snap = root.Snap;

  function P(x, y) { return { x: x, y: y }; }
  function clonePts(pts) { return pts.map(function (p) { return P(p.x, p.y); }); }

  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }

  // 軸に吸い付いた点は小数になるので、ごく小さな誤差は 0 とみなす
  function sign(v) { return v > 1e-9 ? 1 : (v < -1e-9 ? -1 : 0); }

  function segmentsTouch(a, b, c, d) {
    var d1 = sign(cross(c, d, a)), d2 = sign(cross(c, d, b)), d3 = sign(cross(a, b, c)), d4 = sign(cross(a, b, d));
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    function onSeg(p, q, r) {
      return Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 &&
             Math.min(p.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-9;
    }
    if (d1 === 0 && onSeg(c, d, a)) return true;
    if (d2 === 0 && onSeg(c, d, b)) return true;
    if (d3 === 0 && onSeg(a, b, c)) return true;
    if (d4 === 0 && onSeg(a, b, d)) return true;
    return false;
  }

  function polygonArea(pts) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  /* つぶれたり、辺が交差したりしていない図形か */
  function isValidPolygon(pts) {
    if (Math.abs(polygonArea(pts)) < 0.25) return false;
    for (var i = 0; i < pts.length; i++) {
      for (var j = i + 1; j < pts.length; j++) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < SAME_EPS) return false;
      }
    }
    if (pts.length === 4) {
      if (segmentsTouch(pts[0], pts[1], pts[2], pts[3])) return false;
      if (segmentsTouch(pts[1], pts[2], pts[3], pts[0])) return false;
    }
    return true;
  }

  function pointInPolygon(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function Editor2D(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks || {};
    this.shape = null;
    this.axis = null;
    this.mode = 'edit';        // 'edit' | 'axis1' | 'axis2'
    this.pendingPoint = null;  // 軸の1つ目の点
    this.drag = null;
    this.hover = null;
    this.width = 0;
    this.height = 0;
    this.scale = 30;

    var self = this;
    canvas.addEventListener('pointerdown', function (e) { self.onDown(e); });
    canvas.addEventListener('pointermove', function (e) { self.onMove(e); });
    canvas.addEventListener('pointerup', function (e) { self.onUp(e); });
    canvas.addEventListener('pointercancel', function (e) { self.onUp(e); });
    canvas.addEventListener('pointerleave', function () { if (!self.drag) { self.hover = null; self.draw(); } });

    if (root.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(canvas.parentElement);
    root.addEventListener('resize', function () { self.resize(); });
    this.resize();
  }

  Editor2D.prototype.resize = function () {
    var rect = this.canvas.parentElement.getBoundingClientRect();
    var w = Math.max(50, Math.floor(rect.width)), h = Math.max(50, Math.floor(rect.height));
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = w;
    this.height = h;
    this.scale = Math.min(w / (2 * HALF_UNITS + 1), h / (2 * HALF_UNITS_Y + 1));
    this.draw();
  };

  /* 方眼の座標 ↔ 画面の座標 */
  Editor2D.prototype.toScreen = function (p) {
    return P(this.width / 2 + p.x * this.scale, this.height / 2 - p.y * this.scale);
  };
  Editor2D.prototype.toWorld = function (sx, sy) {
    return P((sx - this.width / 2) / this.scale, -(sy - this.height / 2) / this.scale);
  };
  /* 画面の中に入る、方眼の範囲 */
  Editor2D.prototype.limits = function () {
    return {
      x: Math.floor(this.width / 2 / this.scale - 0.3),
      y: Math.floor(this.height / 2 / this.scale - 0.3)
    };
  };
  Editor2D.prototype.snap = function (p) {
    var L = this.limits();
    return P(Math.max(-L.x, Math.min(L.x, Math.round(p.x))), Math.max(-L.y, Math.min(L.y, Math.round(p.y))));
  };

  /* 吸い付きの計算（snap.js）に渡す情報 */
  Editor2D.prototype.snapCtx = function () {
    var self = this, L = this.limits();
    return {
      axis: this.axis,
      scale: this.scale,
      maxR: HALF_UNITS,
      allowCrossing: !!(root.Rev && root.Rev.ALLOW_AXIS_CROSSING),
      gridSnap: function (p) { return self.snap(p); },
      inBounds: function (p) { return Math.abs(p.x) <= L.x + 1e-9 && Math.abs(p.y) <= L.y + 1e-9; }
    };
  };

  /* 円の半径を決める点の位置 */
  function radiusPoint(circle) {
    var a = circle.a || 0;
    return P(circle.c.x + circle.r * Math.cos(a), circle.c.y + circle.r * Math.sin(a));
  }

  /* 今、軸にぴったり合っている点があるか（案内メッセージ用） */
  Editor2D.prototype.snapState = function () {
    var sh = this.shape, axis = this.axis;
    if (!sh || !axis) return { fit: false };
    if (sh.type === 'polygon') return { fit: sh.pts.some(function (p) { return Snap.isOnAxis(p, axis); }) };
    return { fit: Snap.isTangent(sh, axis) };
  };

  Editor2D.prototype.eventWorld = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    return this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  /* ---------- 図形と軸の操作（ボタンから呼ばれる） ---------- */

  Editor2D.prototype.placeShape = function (kind) {
    if (kind === 'triangle') {
      this.shape = { type: 'polygon', kind: kind, pts: [P(1, -2), P(4, -2), P(1, 2)] };
    } else if (kind === 'quad') {
      this.shape = { type: 'polygon', kind: kind, pts: [P(1, -2), P(4, -2), P(4, 2), P(1, 2)] };
    } else {
      this.shape = { type: 'circle', kind: 'circle', c: P(3, 0), r: 1.5, a: 0 };
    }
    this.cancelAxis();
    this.changed('shape');
  };

  Editor2D.prototype.startAxis = function () {
    this.mode = 'axis1';
    this.pendingPoint = null;
    this.draw();
    if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
  };

  Editor2D.prototype.cancelAxis = function () {
    if (this.mode === 'edit') return;
    this.mode = 'edit';
    this.pendingPoint = null;
    this.draw();
    if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
  };

  Editor2D.prototype.clear = function () {
    this.shape = null;
    this.axis = null;
    this.drag = null;
    this.cancelAxis();
    this.changed('clear');
  };

  Editor2D.prototype.changed = function (what) {
    this.draw();
    if (this.cb.onChange) this.cb.onChange(what);
  };

  /* ---------- 指・マウスの操作 ---------- */

  /* 指の位置にある「つかめるもの」を探す */
  Editor2D.prototype.hitTest = function (e) {
    var w = this.eventWorld(e);
    var s = this.toScreen(w);
    var best = null, bestD = HIT_PX;
    var self = this;
    function consider(p, info) {
      var q = self.toScreen(p);
      var d = Math.hypot(q.x - s.x, q.y - s.y);
      if (d < bestD) { bestD = d; best = info; }
    }
    if (this.shape) {
      if (this.shape.type === 'polygon') {
        this.shape.pts.forEach(function (p, i) { consider(p, { kind: 'vertex', index: i }); });
      } else {
        consider(this.shape.c, { kind: 'center' });
        consider(radiusPoint(this.shape), { kind: 'radius' });
      }
    }
    if (best) return best;
    if (this.axis) {
      consider(this.axis.p1, { kind: 'axis', index: 1 });
      consider(this.axis.p2, { kind: 'axis', index: 2 });
    }
    if (best) return best;
    if (this.shape) {
      if (this.shape.type === 'polygon' ? pointInPolygon(w, this.shape.pts)
        : Math.hypot(w.x - this.shape.c.x, w.y - this.shape.c.y) <= this.shape.r) {
        return { kind: 'move' };
      }
    }
    return null;
  };

  Editor2D.prototype.onDown = function (e) {
    if (this.drag) return;           // 2本目の指は使わない
    e.preventDefault();
    var w = this.eventWorld(e);

    if (this.mode === 'axis1' || this.mode === 'axis2') {
      var p = this.snap(w);
      if (this.mode === 'axis1') {
        this.pendingPoint = p;
        this.mode = 'axis2';
        this.draw();
        if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
      } else if (p.x !== this.pendingPoint.x || p.y !== this.pendingPoint.y) {
        this.axis = { p1: this.pendingPoint, p2: p };
        this.mode = 'edit';
        this.pendingPoint = null;
        if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
        this.changed('axis');
      }
      return;
    }

    var hit = this.hitTest(e);
    if (!hit) return;
    this.drag = {
      id: e.pointerId,
      hit: hit,
      start: w,
      shape: this.shape ? JSON.parse(JSON.stringify(this.shape)) : null
    };
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
    this.draw();
  };

  Editor2D.prototype.onMove = function (e) {
    if (!this.drag) {
      if (e.pointerType === 'mouse') {
        var h = this.mode === 'edit' ? this.hitTest(e) : null;
        this.canvas.style.cursor = this.mode !== 'edit' ? 'crosshair' : (h ? (h.kind === 'move' ? 'move' : 'grab') : 'default');
        var key = h ? keyOf(h) : null;
        if (key !== this.hover) { this.hover = key; this.draw(); }
      }
      return;
    }
    if (e.pointerId !== this.drag.id) return;
    e.preventDefault();
    var w = this.eventWorld(e);
    var d = this.drag, hit = d.hit, orig = d.shape;
    var moved = false;

    if (hit.kind === 'axis') {
      var p = this.snap(w);
      var other = hit.index === 1 ? this.axis.p2 : this.axis.p1;
      var cur = hit.index === 1 ? this.axis.p1 : this.axis.p2;
      if ((p.x !== other.x || p.y !== other.y) && (p.x !== cur.x || p.y !== cur.y)) {
        if (hit.index === 1) this.axis.p1 = p; else this.axis.p2 = p;
        this.changed('axis');
      }
      return;
    }

    var ctx = this.snapCtx();
    var raw = P(w.x - d.start.x, w.y - d.start.y);           // 指が動いた量
    var gridOff = P(Math.round(raw.x), Math.round(raw.y));   // 方眼の目の数だけずらす量
    var snapped = false;

    if (orig.type === 'polygon') {
      var pts;
      if (hit.kind === 'vertex') {
        var sv = Snap.snapVertex(w, ctx);
        pts = clonePts(orig.pts);
        pts[hit.index] = sv.p;
        snapped = sv.onAxis;
      } else {
        var st = Snap.snapTranslation(orig.pts, raw, ctx);
        pts = st ? st.pts : this.clampMove(clonePts(orig.pts), gridOff);
        snapped = !!st;
      }
      if (isValidPolygon(pts) && !samePts(pts, this.shape.pts)) {
        this.shape.pts = pts;
        moved = true;
      }
    } else {
      var sh = this.shape;
      if (hit.kind === 'radius') {
        var sr = Snap.snapRadiusHandle(w, sh, ctx);
        snapped = sr.onAxis;
        if (Math.abs(sr.r - sh.r) > 1e-12) { sh.r = sr.r; moved = true; }
        sh.a = sr.a;   // 向きだけが変わっても立体は変わらないので、画面をかき直すだけ
      } else {
        var rawC = hit.kind === 'center' ? w : P(orig.c.x + raw.x, orig.c.y + raw.y);
        var sc = Snap.snapCircleCenter(rawC, sh.r, ctx);
        var nc = sc ? sc.c : (hit.kind === 'center' ? this.snap(w) : this.clampMove([orig.c], gridOff)[0]);
        snapped = !!sc;
        if (nc.x !== sh.c.x || nc.y !== sh.c.y) { sh.c = nc; moved = true; }
      }
    }
    d.snapped = snapped;
    if (moved) this.changed('shape'); else this.draw();
  };

  /* 図形が画面の外に出ないように、平行移動の量を調整する */
  Editor2D.prototype.clampMove = function (pts, off) {
    var L = this.limits();
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var ox = Math.max(-L.x - minX, Math.min(L.x - maxX, off.x));
    var oy = Math.max(-L.y - minY, Math.min(L.y - maxY, off.y));
    return pts.map(function (p) { return P(p.x + ox, p.y + oy); });
  };

  function keyOf(hit) { return hit.kind + (hit.index !== undefined ? hit.index : ''); }

  function samePts(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
    return true;
  }

  Editor2D.prototype.onUp = function (e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.drag = null;
    this.draw();
  };

  /* ---------- 描画 ---------- */

  Editor2D.prototype.draw = function () {
    var ctx = this.ctx, W = this.width, H = this.height, s = this.scale;
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 方眼（5ますごとに少し濃い線）
    var nx = Math.ceil(W / 2 / s) + 1, ny = Math.ceil(H / 2 / s) + 1;
    ctx.lineWidth = 1;
    for (var i = -nx; i <= nx; i++) {
      var x = Math.round(W / 2 + i * s) + 0.5;
      ctx.strokeStyle = i % 5 === 0 ? COLORS.gridBold : COLORS.grid;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (var j = -ny; j <= ny; j++) {
      var y = Math.round(H / 2 + j * s) + 0.5;
      ctx.strokeStyle = j % 5 === 0 ? COLORS.gridBold : COLORS.grid;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // 図形の面 → 軸 → つまみ の順にかく（つまみが軸の線にかくれないように）
    if (this.shape) this.drawShapeBody();
    if (this.axis) this.drawAxis(this.axis.p1, this.axis.p2);
    if (this.shape && this.mode === 'edit') this.drawShapeHandles();   // 軸を引いている間は、つまみを出さない
    if (this.pendingPoint) this.drawDiamond(this.pendingPoint, true);
  };

  Editor2D.prototype.drawShapeBody = function () {
    var ctx = this.ctx, sh = this.shape, self = this;
    ctx.beginPath();
    if (sh.type === 'polygon') {
      sh.pts.forEach(function (p, i) {
        var q = self.toScreen(p);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
    } else {
      var c = this.toScreen(sh.c);
      ctx.arc(c.x, c.y, sh.r * this.scale, 0, Math.PI * 2);
    }
    ctx.fillStyle = COLORS.fill;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.stroke;
    ctx.stroke();
  };

  Editor2D.prototype.drawShapeHandles = function () {
    var ctx = this.ctx, sh = this.shape, self = this, axis = this.axis;
    if (sh.type === 'polygon') {
      sh.pts.forEach(function (p, i) {
        self.drawHandle(p, 'vertex' + i, { fit: Snap.isOnAxis(p, axis) });
      });
      return;
    }
    var rp = radiusPoint(sh);
    var a = this.toScreen(sh.c), b = this.toScreen(rp);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.stroke;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
    var tangent = Snap.isTangent(sh, axis);
    var touch = tangent ? Snap.footOnAxis(sh.c, axis) : null;   // 円と軸が接する点
    var handleAtTouch = touch && Math.hypot(rp.x - touch.x, rp.y - touch.y) < 1e-6;
    if (touch && !handleAtTouch) this.drawFitDot(touch);
    this.drawHandle(sh.c, 'center', { filled: true });
    this.drawHandle(rp, 'radius', { fit: handleAtTouch });
  };

  Editor2D.prototype.isActive = function (key) {
    if (this.drag) return keyOf(this.drag.hit) === key;
    return this.hover === key;
  };

  /* つまみ（●）。opts.fit … 軸にぴったり合っている（緑）、opts.filled … 塗りつぶし（円の中心） */
  Editor2D.prototype.drawHandle = function (p, key, opts) {
    opts = opts || {};
    var ctx = this.ctx, q = this.toScreen(p);
    var big = this.isActive(key);
    var color = opts.fit ? COLORS.fit : COLORS.stroke;
    // ドラッグ中に軸へ吸い付いたら、まわりに緑の輪
    if (big && this.drag && this.drag.snapped) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 24, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.fitGlow;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(q.x, q.y, big ? 14 : 11, 0, Math.PI * 2);
    ctx.fillStyle = opts.filled || opts.fit ? color : COLORS.handle;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (opts.filled || opts.fit) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  };

  /* 円と軸が接している点の印 */
  Editor2D.prototype.drawFitDot = function (p) {
    var ctx = this.ctx, q = this.toScreen(p);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.fit;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  };

  Editor2D.prototype.drawAxis = function (p1, p2) {
    var ctx = this.ctx;
    var a = this.toScreen(p1), b = this.toScreen(p2);
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    var k = (this.width + this.height) * 2 / len;
    ctx.save();
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 10]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x - dx * k, a.y - dy * k);
    ctx.lineTo(b.x + dx * k, b.y + dy * k);
    ctx.stroke();
    ctx.restore();
    if (this.mode === 'edit') {
      this.drawDiamond(p1, this.isActive('axis1'));
      this.drawDiamond(p2, this.isActive('axis2'));
    }
  };

  Editor2D.prototype.drawDiamond = function (p, big) {
    var ctx = this.ctx, q = this.toScreen(p), r = big ? 14 : 11;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.axis;
    ctx.stroke();
  };

  root.Editor2D = Editor2D;
})(window);
