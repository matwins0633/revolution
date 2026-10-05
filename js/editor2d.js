/*
 * 左側：方眼の上に平面図形と回転の軸をかく部分
 *
 * 座標は「1ます = 1」。頂点・円の中心・軸の点は方眼の交点に、円の半径は 0.5 ます刻みに吸いつく。
 * 軸を引いたあとは、図形の点が軸にも吸い付く（計算は snap.js）。
 * 図形は 三角形・四角形（type 'polygon'）、円（'circle'）、半円（'semicircle'、直径の両端 pts と弧の側 side）、
 * フリーハンド（'freehand'、整えた点 pts と角の印 corners。かいた線を図形にする計算は freehand.js）。
 *
 * 操作（指・Apple Pencil・マウスを Pointer Events で同じように扱う）
 *   1本指・ペン・マウス : 図形や軸を動かす、図形を選ぶ、軸を引く（2点のタップ、またはドラッグ）、
 *                         フリーハンドでかく（「かく状態」のとき）
 *   2本指（指だけのとき）: 拡大・縮小、画面の移動
 *   マウス              : ホイールで拡大・縮小、何もない所のドラッグで画面の移動
 *   ペンが触れている間は、指の触れ（手のひら）を無視する。
 * 図形を選ぶと、まわりに「図形を回す」つまみと「裏返す」ボタンが出る（計算は transform.js）。
 * 図形と軸を変える操作は記録して、「元に戻す」で1つずつ戻せる（拡大・縮小、移動は記録しない）。
 */
(function (root) {
  'use strict';

  var Snap = root.Snap, Rev = root.Rev, Transform = root.Transform, Freehand = root.Freehand;

  var HIT_PX = 26;          // つかめる範囲（画面上の大きさ）
  var TAP_PX = 10;          // これより動かさずに離したら「タップ」
  var HALF_UNITS = 7;       // 最初の表示：横方向に、中心から何ますずつ見せるか
  var HALF_UNITS_Y = 5;     // 最初の表示：縦方向に、少なくとも何ますずつ見せるか
  var WORLD_LIMIT = 60;     // 方眼の交点に吸い付く範囲（±60ます）
  var MIN_SCALE = 8, MAX_SCALE = 160;   // 1ますの大きさ（ピクセル）の範囲
  var HISTORY_MAX = 100;
  var SAME_EPS = 1e-6;

  var COLORS = {
    paper: '#FFFFFF',
    grid: '#E4E9F0',
    gridBold: '#C9D2DE',
    fill: '#FFE2BF',          // 図形（オレンジ）
    stroke: '#D9730D',
    axis: '#D62839',          // 軸（赤）
    fit: '#13803C',           // 軸にぴったり合った点（緑）
    fitGlow: 'rgba(19, 128, 60, 0.22)',
    fold: '#1F5FD6',          // 折り返し（青）
    foldEdge: '#173F8F',
    ink: '#1F2A44',           // 選択の枠・つまみ
    strokeRing: 'rgba(217, 115, 13, 0.18)'   // かき始めの輪（指先が入ったとき）
  };
  // 回すつまみ・裏返すボタンの線画（ページの手順の列のアイコンと同じ形）
  var ICON = {
    turn: 'M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4',
    flip: 'M12 3v18M9 7L4 17h5zM15 7l5 10h-5z',
    flipSides: 'M9 7L4 17h5zM15 7l5 10h-5z',   // 軸で裏返すとき：まん中の線は軸の色の点線でかく
    flipLine: 'M12 3v18'
  };

  function P(x, y) { return { x: x, y: y }; }
  function clone(o) { return o ? JSON.parse(JSON.stringify(o)) : null; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function samePt(a, b) { return a.x === b.x && a.y === b.y; }

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
        if (dist(pts[i], pts[j]) < SAME_EPS) return false;
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

  /* 円の半径を決める点の位置 */
  function radiusPoint(circle) {
    var a = circle.a || 0;
    return P(circle.c.x + circle.r * Math.cos(a), circle.c.y + circle.r * Math.sin(a));
  }

  function keyOf(hit) { return hit.kind + (hit.index !== undefined ? hit.index : ''); }

  /* ================================================================ */

  function Editor2D(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks || {};
    this.shape = null;
    this.axis = null;
    this.mode = 'edit';        // 'edit' | 'axis1'（1点目を待つ）| 'axis2'（2点目を待つ）| 'draw'（フリーハンドでかく）
    this.pendingPoint = null;  // 軸の1つ目の点（タップで決めたとき）
    this.axisPreview = null;   // 軸を引いている途中の予告
    this.selected = false;     // 図形が選ばれているか
    this.showFold = false;     // 「折り返しを見る」
    this.history = [];         // 「元に戻す」のための記録（変える直前の状態）
    this.future = [];          // 「進む」のための記録（元に戻す直前の状態）
    this.pointers = {};        // 画面に触れている指・ペン・マウス
    this.ignored = {};         // 無視している指（手のひら・3本目の指など）
    this.op = null;            // 今している操作
    this.width = 0;
    this.height = 0;
    this.scale = 30;           // 1ますの大きさ（ピクセル）
    this.cx = 0;               // 画面の中央に来る方眼の位置
    this.cy = 0;
    this.customView = false;   // 拡大・縮小、移動をしたか
    this.avoid = null;         // つまみを置かない場所（「全体を表示」ボタンの場所。画面の座標）
    this.flash = null;         // 直線で閉じたとき、その直線をしばらく目立たせる { a, b, until }
    this.crossMark = null;     // 線が交わってかき直しになったとき、交わった所とかいた線をしばらく見せる { at, stroke, until }
    this.foldCache = null;     // 「折り返しを見る」の計算結果（図形と軸が変わるまで使い回す）
    this.paths = {};

    var self = this;
    canvas.addEventListener('pointerdown', function (e) { self.onDown(e); });
    canvas.addEventListener('pointermove', function (e) { self.onMove(e); });
    canvas.addEventListener('pointerup', function (e) { self.onUp(e); });
    canvas.addEventListener('pointercancel', function (e) { self.onCancel(e); });
    canvas.addEventListener('wheel', function (e) { self.onWheel(e); }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    if (root.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(canvas.parentElement);
    root.addEventListener('resize', function () { self.resize(); });
    this.resize();
  }

  /* ---------- 表示の大きさと位置 ---------- */

  Editor2D.prototype.defaultScale = function () {
    return Math.min(this.width / (2 * HALF_UNITS + 1), this.height / (2 * HALF_UNITS_Y + 1));
  };

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
    this.hatch = null;
    if (!this.customView) {   // まだ拡大・縮小していなければ、最初の大きさに合わせ直す
      this.scale = this.defaultScale();
      this.cx = 0;
      this.cy = 0;
    }
    this.draw();
  };

  /* 方眼の座標 ↔ 画面の座標 */
  Editor2D.prototype.toScreen = function (p) {
    return P(this.width / 2 + (p.x - this.cx) * this.scale, this.height / 2 - (p.y - this.cy) * this.scale);
  };
  Editor2D.prototype.toWorld = function (sx, sy) {
    return P(this.cx + (sx - this.width / 2) / this.scale, this.cy - (sy - this.height / 2) / this.scale);
  };

  /* 画面の点 (sx, sy) を動かさずに拡大・縮小する */
  Editor2D.prototype.zoomAt = function (sx, sy, factor) {
    var w = this.toWorld(sx, sy);
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));
    this.cx = w.x - (sx - this.width / 2) / this.scale;
    this.cy = w.y + (sy - this.height / 2) / this.scale;
    this.customView = true;
    this.draw();
  };

  Editor2D.prototype.panBy = function (dx, dy) {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
    this.customView = true;
    this.draw();
  };

  /* 最初の表示に戻す */
  Editor2D.prototype.resetView = function () {
    this.customView = false;
    this.scale = this.defaultScale();
    this.cx = 0;
    this.cy = 0;
    this.draw();
  };

  /* 「全体を表示」：図形と軸がすべて見える大きさと位置にする（最初の大きさより大きくはしない） */
  Editor2D.prototype.fitAll = function () {
    var pts = this.shape ? Rev.outline(this.shape).pts.slice() : [];
    if (this.axis) pts.push(this.axis.p1, this.axis.p2);
    if (!pts.length) return this.resetView();
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var m = 1.5;   // まわりの余白（ます）
    var s = Math.min(this.width / (maxX - minX + 2 * m), this.height / (maxY - minY + 2 * m), this.defaultScale());
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    this.cx = (minX + maxX) / 2;
    this.cy = (minY + maxY) / 2;
    this.customView = true;
    this.draw();
  };

  /* 方眼の交点に吸い付ける */
  Editor2D.prototype.snap = function (p) {
    return P(Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, Math.round(p.x))),
             Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, Math.round(p.y))));
  };

  /* 吸い付きの計算（snap.js）に渡す情報。scale は今の拡大率なので、吸い付く距離は画面上で一定 */
  Editor2D.prototype.snapCtx = function () {
    var self = this;
    return {
      axis: this.axis,
      scale: this.scale,
      maxR: HALF_UNITS,
      allowCrossing: !!(Rev && Rev.ALLOW_AXIS_CROSSING),
      gridSnap: function (p) { return self.snap(p); },
      inBounds: function (p) { return Math.abs(p.x) <= WORLD_LIMIT && Math.abs(p.y) <= WORLD_LIMIT; }
    };
  };

  /* ---------- 状態を調べる（案内メッセージ用） ---------- */

  /* 今、軸にぴったり合っている点があるか */
  Editor2D.prototype.snapState = function () {
    var sh = this.shape, axis = this.axis;
    if (!sh || !axis) return { fit: false };
    if (sh.type !== 'circle') return { fit: sh.pts.some(function (p) { return Snap.isOnAxis(p, axis); }) };
    return { fit: Snap.isTangent(sh, axis) || Snap.isOnAxis(sh.c, axis) || Snap.isOnAxis(radiusPoint(sh), axis) };
  };

  /* 軸が図形の中を通っているか */
  Editor2D.prototype.isCrossing = function () {
    if (!this.shape || !this.axis) return false;
    var f = Rev.axisFrame(this.axis);
    return !!f && Rev.axisSide(this.shape, f) === 'cross';
  };

  Editor2D.prototype.setShowFold = function (on) {
    this.showFold = on;
    this.draw();
  };

  /* ---------- 元に戻す ---------- */

  Editor2D.prototype.stateJSON = function () {
    return JSON.stringify({ shape: this.shape, axis: this.axis });
  };

  /* 変える直前の状態を記録する */
  Editor2D.prototype.record = function (json) {
    this.history.push(json || this.stateJSON());
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.future = [];   // 元に戻したあとに新しい操作をしたら、それより先には「進む」できない
    if (this.cb.onHistory) this.cb.onHistory(this.canUndo());
  };

  Editor2D.prototype.canUndo = function () { return this.history.length > 0; };
  Editor2D.prototype.canRedo = function () { return this.future.length > 0; };

  /* 記録した状態に移る（元に戻す・進む） */
  Editor2D.prototype.restore = function (json, what) {
    this.abortOp();
    var s = JSON.parse(json);
    this.shape = s.shape;
    this.axis = s.axis;
    if (!this.shape) this.selected = false;
    this.cancelAxis();
    if (this.cb.onHistory) this.cb.onHistory(this.canUndo());
    this.changed(what);
  };

  Editor2D.prototype.undo = function () {
    if (!this.history.length) return;
    this.future.push(this.stateJSON());
    if (this.future.length > HISTORY_MAX) this.future.shift();
    this.restore(this.history.pop(), 'undo');
  };

  Editor2D.prototype.redo = function () {
    if (!this.future.length) return;
    this.history.push(this.stateJSON());
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.restore(this.future.pop(), 'redo');
  };

  /* ---------- 図形と軸の操作（ボタンから呼ばれる） ---------- */

  Editor2D.prototype.placeShape = function (kind) {
    this.record();
    if (kind === 'triangle') {
      this.shape = { type: 'polygon', kind: kind, pts: [P(1, -2), P(4, -2), P(1, 2)] };
    } else if (kind === 'quad') {
      this.shape = { type: 'polygon', kind: kind, pts: [P(1, -2), P(4, -2), P(4, 2), P(1, 2)] };
    } else if (kind === 'semicircle') {
      // 直径は縦、弧は右側（side は p1→p2 の向きの左側なら +1）
      this.shape = { type: 'semicircle', kind: kind, pts: [P(1, -2), P(1, 2)], side: -1 };
    } else {
      this.shape = { type: 'circle', kind: 'circle', c: P(3, 0), r: 1.5, a: 0 };
    }
    this.selected = true;   // 置いた図形は選ばれた状態にして、回す・裏返すができることを見せる
    this.cancelAxis();
    this.changed('shape');
  };

  /* 選ばれている図形を裏返す（軸から離れていればその場で左右に、軸に接している・またぐときは軸で） */
  Editor2D.prototype.flipMode = function () {
    return this.shape ? Transform.flipMode(this.shape, this.axis) : null;
  };

  Editor2D.prototype.flipShape = function () {
    var mode = this.flipMode();
    if (!mode) return;
    this.record();
    this.shape = mode === 'axis' ? Transform.flipAcrossAxis(this.shape, this.axis) : Transform.flipInPlace(this.shape);
    this.changed(mode === 'axis' ? 'flipAxis' : 'shape');
  };

  /* 図形だけを消す（軸は残す） */
  Editor2D.prototype.clearShape = function () {
    this.abortOp();
    if (this.shape) {
      this.record();
      this.shape = null;
      this.selected = false;
    }
    this.cancelAxis();
    this.changed('clearShape');
  };

  /* フリーハンドでかく状態にする。前の図形の上に重ねてかくと「かき足し」に見えるので、今の図形は先に消す（元に戻すで戻せる） */
  Editor2D.prototype.startDraw = function () {
    this.abortOp();
    if (this.shape) {
      this.record();
      this.shape = null;
      this.selected = false;
      this.flash = null;
      if (this.cb.onChange) this.cb.onChange('clearShape');
    }
    this.mode = 'draw';
    this.pendingPoint = null;
    this.axisPreview = null;
    this.canvas.style.cursor = 'crosshair';
    this.draw();
    if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
  };

  Editor2D.prototype.startAxis = function () {
    this.abortOp();
    this.canvas.style.cursor = '';
    this.mode = 'axis1';
    this.pendingPoint = null;
    this.axisPreview = null;
    this.draw();
    if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
  };

  /* 軸をひく状態・かく状態を終える */
  Editor2D.prototype.cancelAxis = function () {
    if (this.mode === 'edit') return;
    if (this.op && (this.op.kind === 'draw' || this.op.kind === 'axis')) this.abortOp();
    this.canvas.style.cursor = '';
    this.mode = 'edit';
    this.pendingPoint = null;
    this.axisPreview = null;
    this.draw();
    if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
  };

  Editor2D.prototype.commitAxis = function (p1, p2) {
    this.record();
    this.axis = { p1: P(p1.x, p1.y), p2: P(p2.x, p2.y) };
    this.mode = 'edit';
    this.pendingPoint = null;
    this.axisPreview = null;
    if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
    this.changed('axis');
  };

  Editor2D.prototype.clear = function () {
    this.abortOp();
    if (this.shape || this.axis) this.record();
    this.shape = null;
    this.axis = null;
    this.selected = false;
    this.cancelAxis();
    this.changed('clear');
  };

  Editor2D.prototype.changed = function (what) {
    if (what !== 'draw') this.flash = null;   // 直線で閉じた所の強調は、図形や軸が変わったら消す
    this.crossMark = null;
    this.draw();
    if (this.cb.onChange) this.cb.onChange(what);
  };

  /* ---------- 選ばれた図形のまわりの表示の位置（画面の座標） ---------- */

  Editor2D.prototype.selectionUI = function () {
    var self = this, W = this.width, H = this.height;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    Rev.outline(this.shape).pts.forEach(function (p) {
      var s = self.toScreen(p);
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    });
    var pad = 12;
    var frame = { left: minX - pad, right: maxX + pad, top: minY - pad, bottom: maxY + pad };
    var flipMode = this.flipMode();   // null なら裏返すボタンを出さない（軸から離れた円）
    var isCircle = this.shape.type === 'circle';   // 円は回しても同じなので、回すつまみは出さない
    if (isCircle && !flipMode) return { frame: frame };
    function clampX(x) { return Math.max(26, Math.min(W - 26, x)); }
    function clampY(y) { return Math.max(26, Math.min(H - 26, y)); }
    var rx = (frame.left + frame.right) / 2, ry = frame.top - 34, below = false;
    if (ry < 26) { ry = frame.bottom + 34; below = true; }
    var rot = P(clampX(rx), clampY(ry));
    var fx = frame.right + 30, fy = below ? frame.bottom + 30 : frame.top - 30;
    if (fx > W - 26) fx = frame.left - 30;
    var flip = P(clampX(fx), clampY(fy));
    if (dist(rot, flip) < 50) flip = P(clampX(rot.x + 52), rot.y);
    // 図形が画面からはみ出して、つまみが「全体を表示」ボタンに重なるときは、ボタンの上にずらす
    var av = this.avoid;
    function clear(q) {
      if (av && q.x > av.left - 24 && q.x < av.right + 24 && q.y > av.top - 24 && q.y < av.bottom + 24) {
        return P(q.x, av.top - 28);
      }
      return q;
    }
    if (isCircle) return { frame: frame, flip: clear(rot), flipMode: flipMode, below: below };
    return { frame: frame, rotate: clear(rot), flip: clear(flip), flipMode: flipMode, below: below };
  };

  /* ---------- 指・ペン・マウスの操作 ---------- */

  Editor2D.prototype.local = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    return P(e.clientX - rect.left, e.clientY - rect.top);
  };

  Editor2D.prototype.penDown = function () {
    for (var id in this.pointers) if (this.pointers[id].type === 'pen') return true;
    return false;
  };

  Editor2D.prototype.touchIds = function () {
    var ids = [];
    for (var id in this.pointers) if (this.pointers[id].type === 'touch') ids.push(id);
    return ids;
  };

  /* 指の位置にある「つかめるもの」を探す（いちばん近いもの） */
  Editor2D.prototype.hitTest = function (sx, sy) {
    var s = P(sx, sy), self = this;
    var best = null, bestD = HIT_PX;
    function consider(q, info) {
      var d = dist(q, s);
      if (d < bestD) { bestD = d; best = info; }
    }
    if (this.shape) {
      if (this.selected) {
        var ui = this.selectionUI();
        if (ui.rotate) consider(ui.rotate, { kind: 'rotate' });
        if (ui.flip) consider(ui.flip, { kind: 'flip' });
      }
      if (this.shape.type === 'polygon' || this.shape.type === 'semicircle') {
        this.shape.pts.forEach(function (p, i) { consider(self.toScreen(p), { kind: 'vertex', index: i }); });
      } else if (this.shape.type === 'circle') {
        consider(this.toScreen(this.shape.c), { kind: 'center' });
        consider(this.toScreen(radiusPoint(this.shape)), { kind: 'radius' });
      }
    }
    if (this.axis) {
      consider(this.toScreen(this.axis.p1), { kind: 'axis', index: 1 });
      consider(this.toScreen(this.axis.p2), { kind: 'axis', index: 2 });
    }
    if (best) return best;
    if (this.shape) {
      var w = this.toWorld(sx, sy);
      if (this.shape.type !== 'circle' ? pointInPolygon(w, Rev.outline(this.shape).pts)
        : dist(w, this.shape.c) <= this.shape.r) {
        return { kind: 'move' };
      }
    }
    return null;
  };

  Editor2D.prototype.onDown = function (e) {
    e.preventDefault();
    var id = String(e.pointerId), type = e.pointerType || 'mouse', s = this.local(e);

    // Apple Pencil が触れている間は、指の触れ（手のひら）を無視する
    if (type === 'touch' && this.penDown()) { this.ignored[id] = true; return; }
    if (type === 'pen') {
      // 手のひらが先に触れて指の操作が始まっていたら、それを取り消してペンを優先する
      if (this.op && (this.op.type === 'touch' || this.op.kind === 'gesture')) this.abortOp();
      var self = this;
      this.touchIds().forEach(function (tid) { self.ignored[tid] = true; delete self.pointers[tid]; });
    }
    this.pointers[id] = { x: s.x, y: s.y, type: type };

    if (type === 'touch') {
      var ids = this.touchIds();
      if (ids.length >= 2) {   // 2本指：拡大・縮小と移動（途中の1本指の操作は取り消す）
        if (this.op && this.op.kind !== 'gesture') this.abortOp();
        if (!this.op) this.startGesture(ids[0], ids[1]);
        else this.ignored[id] = true;   // 3本目以降の指
        return;
      }
    }
    if (this.op) return;   // ほかの指・ペンで操作中
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
    this.startOp(id, type, s);
  };

  Editor2D.prototype.startGesture = function (a, b) {
    var pa = this.pointers[a], pb = this.pointers[b];
    var mid = P((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    this.op = {
      kind: 'gesture', type: 'touch', ids: [a, b],
      dist0: Math.max(1, dist(pa, pb)), scale0: this.scale, anchor: this.toWorld(mid.x, mid.y)
    };
  };

  Editor2D.prototype.updateGesture = function () {
    var op = this.op, pa = this.pointers[op.ids[0]], pb = this.pointers[op.ids[1]];
    if (!pa || !pb) return;
    var mid = P((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, op.scale0 * dist(pa, pb) / op.dist0));
    // 指を置いたときに2本の指の間にあった方眼の位置が、いまの2本の指の間に来るように
    this.cx = op.anchor.x - (mid.x - this.width / 2) / this.scale;
    this.cy = op.anchor.y + (mid.y - this.height / 2) / this.scale;
    this.customView = true;
    this.draw();
  };

  Editor2D.prototype.startOp = function (id, type, s) {
    var w = this.toWorld(s.x, s.y);
    var op = { id: id, type: type, start: s, last: s, moved: false, startWorld: w,
               snapshot: this.stateJSON(), recorded: false, snapped: false };
    if (this.mode === 'draw') {   // フリーハンドでかく
      op.kind = 'draw';
      op.pts = [w];
      op.screen = [s];
      op.length = 0;
      // 点の受け取り（iPad の Safari がペンの前の点を混ぜて渡しても、戻らないように。freehand.js）
      op.feed = Freehand.newFeed();
      Freehand.acceptPoints(op.feed, [{ x: s.x, y: s.y, t: 0 }]);
      this.crossMark = null;
      this.op = op;
      this.draw();
      return;
    }
    if (this.mode !== 'edit') {   // 軸を引く
      op.kind = 'axis';
      op.p0 = this.snap(w);
      if (this.mode === 'axis2') this.axisPreview = { p1: this.pendingPoint, p2: op.p0 };
      this.op = op;
      this.draw();
      return;
    }
    var hit = this.hitTest(s.x, s.y);
    op.hit = hit;
    op.orig = clone(this.shape);
    if (!hit) op.kind = 'empty';
    else if (hit.kind === 'flip') op.kind = 'flip';
    else {
      op.kind = 'edit';
      if (hit.kind !== 'axis') this.selected = true;
    }
    this.op = op;
    this.draw();
  };

  Editor2D.prototype.onMove = function (e) {
    var id = String(e.pointerId);
    if (this.ignored[id]) return;
    var pt = this.pointers[id];
    if (!pt) return;   // マウスを乗せているだけ（ボタンを押していない）
    var s = this.local(e);
    pt.x = s.x; pt.y = s.y;
    var op = this.op;
    if (!op) return;
    e.preventDefault();
    if (op.kind === 'gesture') {
      if (op.ids.indexOf(id) >= 0) this.updateGesture();
      return;
    }
    if (op.id !== id) return;
    if (!op.moved && dist(s, op.start) > TAP_PX) op.moved = true;
    if (op.kind === 'draw') {
      // ペンの細かい動きもとれるように、ブラウザが用意している途中の点があれば使う
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      evs = (evs && evs.length ? Array.prototype.slice.call(evs) : []).concat([e]);
      this.feedStroke(op, evs);
      op.last = s;
      this.draw();
      return;
    }
    var w = this.toWorld(s.x, s.y);
    if (op.kind === 'axis') {
      var p = this.snap(w);
      if (this.mode === 'axis2') this.axisPreview = { p1: this.pendingPoint, p2: p };
      else if (op.moved) this.axisPreview = { p1: op.p0, p2: p };
      this.draw();
    } else if (op.kind === 'empty') {
      if (op.type === 'mouse' && op.moved) this.panBy(s.x - op.last.x, s.y - op.last.y);
    } else if (op.kind === 'edit') {
      this.dragEdit(op, w);
    }
    op.last = s;
  };

  /* かいている線に点を加える（ほぼ同じ位置の点は加えない） */
  /* 指・ペンの動きの点を、受け取りの判定（前の点・同じ点を捨てる）を通してから線に加える */
  Editor2D.prototype.feedStroke = function (op, evs) {
    var self = this;
    var list = evs.map(function (ev) { var p = self.local(ev); return { x: p.x, y: p.y, t: ev.timeStamp }; });
    Freehand.acceptPoints(op.feed, list).forEach(function (p) { self.addStrokePoint(op, p); });
  };

  Editor2D.prototype.addStrokePoint = function (op, s) {
    var last = op.screen[op.screen.length - 1];
    var d = dist(s, last);
    if (d < 1) return;
    op.screen.push(s);
    op.pts.push(this.toWorld(s.x, s.y));
    op.length += d;
  };

  /* 指（ペン）を離したとき：かいた線を図形にする（閉じ方・整え方は freehand.js） */
  Editor2D.prototype.finishStroke = function (op) {
    var res = Freehand.finish(op.pts, { axis: this.axis, scale: this.scale });
    if (!res.ok) {
      if (res.reason === 'selfCross' && res.at) {   // 交わった所と、かいた線をしばらく見せる
        var self = this, ms = Freehand.CONFIG.STRAIGHT_FLASH_MS;
        this.crossMark = { at: res.at, stroke: op.pts.slice(), until: Date.now() + ms };
        setTimeout(function () { if (self.crossMark && Date.now() >= self.crossMark.until) { self.crossMark = null; self.draw(); } }, ms + 30);
      }
      this.draw();
      if (res.reason !== 'tap' && this.cb.onDrawResult) this.cb.onDrawResult(res);   // かき直し（かく状態のまま）
      return;
    }
    this.record();
    res.shape.kind = 'freehand';
    this.shape = res.shape;
    this.selected = true;
    this.mode = 'edit';
    this.canvas.style.cursor = '';
    if (res.straight) {   // ④ 直線で閉じたときは、その直線をしばらく目立たせる
      var self = this, ms = Freehand.CONFIG.STRAIGHT_FLASH_MS;
      this.flash = { a: res.straight[0], b: res.straight[1], until: Date.now() + ms };
      setTimeout(function () { if (self.flash && Date.now() >= self.flash.until) { self.flash = null; self.draw(); } }, ms + 30);
    } else {
      this.flash = null;
    }
    if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
    this.changed('draw');
    if (this.cb.onDrawResult) this.cb.onDrawResult(res);
  };

  /* 図形・軸をドラッグしているとき */
  Editor2D.prototype.dragEdit = function (op, w) {
    var hit = op.hit, orig = op.orig, ctx = this.snapCtx();
    var raw = P(w.x - op.startWorld.x, w.y - op.startWorld.y);   // 指が動いた量
    var gridOff = P(Math.round(raw.x), Math.round(raw.y));        // 方眼の目の数だけずらす量
    var next = null, snapped = false;

    if (hit.kind === 'axis') {
      var p = this.snap(w);
      var other = hit.index === 1 ? this.axis.p2 : this.axis.p1;
      var cur = hit.index === 1 ? this.axis.p1 : this.axis.p2;
      if (!samePt(p, other) && !samePt(p, cur)) {
        this.recordOnce(op);
        if (hit.index === 1) this.axis.p1 = p; else this.axis.p2 = p;
        this.changed('axis');
      }
      return;
    }

    if (hit.kind === 'rotate') {
      // 図形の中心のまわりに、15° 刻みで回す（はみ出しても止めない）
      var c = Transform.center(orig);
      var a0 = Math.atan2(op.startWorld.y - c.y, op.startWorld.x - c.x);
      var a1 = Math.atan2(w.y - c.y, w.x - c.x);
      var ang = Transform.snapAngle(a1 - a0);
      var deg = Math.round(ang * 180 / Math.PI);
      deg = ((deg % 360) + 540) % 360 - 180;   // −180〜180 で表示
      op.angleDeg = deg;
      next = Transform.rotate(orig, ang, c);
    } else if (orig.type !== 'circle') {
      var pts;
      if (hit.kind === 'vertex') {
        var sv = Snap.snapVertex(w, ctx);
        pts = clone(orig.pts);
        pts[hit.index] = sv.p;
        snapped = sv.onAxis;
      } else {
        // フリーハンドの図形は、軸にいちばん近い所が軸に接する位置に吸い付く
        var st = orig.type === 'freehand' ? Snap.snapTranslationTouch(orig.pts, raw, ctx) : Snap.snapTranslation(orig.pts, raw, ctx);
        pts = st ? st.pts : orig.pts.map(function (q) { return P(q.x + gridOff.x, q.y + gridOff.y); });
        snapped = !!st;
      }
      var valid = orig.type === 'semicircle' ? dist(pts[0], pts[1]) >= 1 - 1e-9   // 直径は1ます以上
        : orig.type === 'freehand' ? true
        : isValidPolygon(pts);
      if (valid) { next = clone(this.shape); next.pts = pts; }
    } else {
      var sh = this.shape;
      if (hit.kind === 'radius') {
        var sr = Snap.snapRadiusHandle(w, sh, ctx);
        snapped = sr.onAxis;
        if (Math.abs(sr.r - sh.r) > 1e-12) { next = clone(sh); next.r = sr.r; next.a = sr.a; }
        else sh.a = sr.a;   // 向きだけが変わっても立体は変わらないので、記録しないで画面だけかき直す
      } else {
        var rawC = hit.kind === 'center' ? w : P(orig.c.x + raw.x, orig.c.y + raw.y);
        var sc = Snap.snapCircleCenter(rawC, sh.r, ctx);
        var nc = sc ? sc.c : (hit.kind === 'center' ? this.snap(w) : P(orig.c.x + gridOff.x, orig.c.y + gridOff.y));
        snapped = !!sc;
        if (!samePt(nc, sh.c)) { next = clone(sh); next.c = nc; }
      }
    }
    op.snapped = snapped;
    if (next && JSON.stringify(next) !== JSON.stringify(this.shape)) {
      this.recordOnce(op);
      this.shape = next;
      this.changed('shape');
    } else {
      this.draw();
    }
  };

  /* ドラッグで変えるときは、動き始めたときに1回だけ記録する */
  Editor2D.prototype.recordOnce = function (op) {
    if (op.recorded) return;
    this.record(op.snapshot);
    op.recorded = true;
  };

  Editor2D.prototype.onUp = function (e) {
    var id = String(e.pointerId);
    delete this.pointers[id];
    if (this.ignored[id]) { delete this.ignored[id]; return; }
    var op = this.op;
    if (!op) return;
    if (op.kind === 'gesture') {
      if (op.ids.indexOf(id) >= 0) {
        this.op = null;
        // 残った指は、離すまで使わない（2本指の操作のあとに図形が動かないように）
        var self = this;
        op.ids.forEach(function (oid) { if (self.pointers[oid]) self.ignored[oid] = true; });
      }
      return;
    }
    if (op.id !== id) return;
    this.op = null;
    var s = this.local(e), w = this.toWorld(s.x, s.y);
    if (op.kind === 'draw') {
      this.feedStroke(op, [e]);
      this.finishStroke(op);
      return;
    }
    if (op.kind === 'axis') {
      var p = this.snap(w);
      if (this.mode === 'axis1') {
        if (op.moved && !samePt(p, op.p0)) {
          this.commitAxis(op.p0, p);   // ドラッグで引いた
        } else {
          this.pendingPoint = op.p0;   // タップ：1点目が決まった
          this.mode = 'axis2';
          this.axisPreview = null;
          if (this.cb.onModeChange) this.cb.onModeChange(this.mode);
        }
      } else if (this.pendingPoint && !samePt(p, this.pendingPoint)) {
        this.commitAxis(this.pendingPoint, p);
      } else {
        this.axisPreview = null;
      }
    } else if (op.kind === 'flip') {
      if (!op.moved) this.flipShape();
    } else if (op.kind === 'empty') {
      if (!op.moved) this.selected = false;   // 何もない所をタップすると、選択が外れる
    }
    this.draw();
  };

  Editor2D.prototype.onCancel = function (e) {
    var id = String(e.pointerId);
    delete this.pointers[id];
    if (this.ignored[id]) { delete this.ignored[id]; return; }
    if (this.op && (this.op.id === id || (this.op.ids && this.op.ids.indexOf(id) >= 0))) this.abortOp();
  };

  /* 途中の操作を取り消して、始める前の状態に戻す（記録も残さない） */
  Editor2D.prototype.abortOp = function () {
    var op = this.op;
    this.op = null;
    if (!op) return;
    if (op.kind === 'axis') this.axisPreview = null;   // 軸の予告を消す
    // かいている途中の線（op.kind === 'draw'）は、this.op を消せばそのまま捨てられる
    if (op.kind === 'edit' && op.recorded) {
      var s = JSON.parse(op.snapshot);
      this.shape = s.shape;
      this.axis = s.axis;
      this.history.pop();
      if (this.cb.onHistory) this.cb.onHistory(this.canUndo());
      this.changed('shape');
      return;
    }
    this.draw();
  };

  Editor2D.prototype.onWheel = function (e) {
    e.preventDefault();
    var s = this.local(e);
    this.zoomAt(s.x, s.y, Math.exp(-e.deltaY * 0.0015));
  };

  /* ---------- 描画 ---------- */

  Editor2D.prototype.draw = function () {
    var ctx = this.ctx, W = this.width, H = this.height;
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, W, H);
    this.drawGrid();

    // 図形の面 → 折り返し → 軸 → つまみ の順にかく（つまみが線にかくれないように）
    if (this.shape) this.drawShapeBody();
    if (this.showFold) this.drawFold();
    if (this.axis) this.drawAxisLine(this.axis.p1, this.axis.p2, false);
    if (this.axisPreview) this.drawAxisLine(this.axisPreview.p1, this.axisPreview.p2, true);
    var editing = this.mode === 'edit';
    if (this.shape && editing && this.selected) this.drawSelectionFrame();
    if (this.shape && editing) this.drawShapeHandles();
    if (this.axis && editing) {
      this.drawDiamond(this.axis.p1, this.isActive('axis1'));
      this.drawDiamond(this.axis.p2, this.isActive('axis2'));
    }
    if (this.shape && editing && this.selected) this.drawSelectionButtons();
    if (this.flash) this.drawFlash();
    if (this.crossMark) this.drawCrossMark();
    if (this.op && this.op.kind === 'draw') this.drawStroke(this.op);
    if (this.pendingPoint) this.drawDiamond(this.pendingPoint, true);
    if (this.axisPreview) {
      this.drawDiamond(this.axisPreview.p1, true);
      this.drawDiamond(this.axisPreview.p2, true);
    }
  };

  Editor2D.prototype.drawGrid = function () {
    var ctx = this.ctx, W = this.width, H = this.height, s = this.scale;
    var step = s < 12 ? 5 : 1;   // 小さく表示しているときは、5ますごとの線だけ
    var x0 = Math.floor(this.cx - W / 2 / s), x1 = Math.ceil(this.cx + W / 2 / s);
    var y0 = Math.floor(this.cy - H / 2 / s), y1 = Math.ceil(this.cy + H / 2 / s);
    ctx.lineWidth = 1;
    var v;
    for (v = Math.ceil(x0 / step) * step; v <= x1; v += step) {
      var x = Math.round(W / 2 + (v - this.cx) * s) + 0.5;
      ctx.strokeStyle = v % 5 === 0 ? COLORS.gridBold : COLORS.grid;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (v = Math.ceil(y0 / step) * step; v <= y1; v += step) {
      var y = Math.round(H / 2 - (v - this.cy) * s) + 0.5;
      ctx.strokeStyle = v % 5 === 0 ? COLORS.gridBold : COLORS.grid;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  };

  Editor2D.prototype.tracePath = function (pts) {
    var ctx = this.ctx, self = this;
    pts.forEach(function (p, i) {
      var q = self.toScreen(p);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
  };

  Editor2D.prototype.drawShapeBody = function () {
    var ctx = this.ctx, sh = this.shape;
    ctx.beginPath();
    if (sh.type !== 'circle') {
      this.tracePath(Rev.outline(sh).pts);
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

  /* 折り返しの斜線の模様（半透明の重ね塗りにしないので、色がにごらない） */
  Editor2D.prototype.hatchPattern = function () {
    if (!this.hatch) {
      var c = document.createElement('canvas');
      c.width = c.height = 10;
      var g = c.getContext('2d');
      g.strokeStyle = COLORS.fold;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(-2, 12); g.lineTo(12, -2);
      g.moveTo(-2, 2); g.lineTo(2, -2);
      g.moveTo(8, 12); g.lineTo(12, 8);
      g.stroke();
      this.hatch = this.ctx.createPattern(c, 'repeat');
    }
    return this.hatch;
  };

  /*
   * 「折り返しを見る」：軸の反対側の部分を折り返した像（青の斜線と点線）と、
   * 折り返して重ねた形の輪郭（濃い青の太線。回すと立体の表面になる線）をかく。
   */
  Editor2D.prototype.drawFold = function () {
    if (!this.shape || !this.axis) return;
    var key = this.stateJSON();
    if (!this.foldCache || this.foldCache.key !== key) this.foldCache = { key: key, an: Rev.analyze(this.shape, this.axis) };
    var an = this.foldCache.an;
    if (!an.ok || !an.crossing) return;
    var f = an.frame, ctx = this.ctx, self = this, big = 1e4;
    function sp(t, rho) { return self.toScreen(Rev.toWorld(f, t, rho)); }

    ctx.save();
    ctx.beginPath();   // 表側（面積の大きい側）だけにかく
    [[-big, 0], [big, 0], [big, big], [-big, big]].forEach(function (q, i) {
      var s = sp(q[0], q[1]);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.clip();
    var axis = this.axis;
    var mirrored = Rev.outline(this.shape).pts.map(function (p) {   // 軸で折り返した図形（「軸で裏返す」と同じ計算）
      return Transform.reflectAcrossAxis(p, axis);
    });
    ctx.beginPath();
    this.tracePath(mirrored);
    ctx.fillStyle = this.hatchPattern();
    ctx.fill();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.fold;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.foldEdge;
    ctx.beginPath();
    an.pieces.forEach(function (pc) {
      pc.pts.forEach(function (q, i) {
        var s = sp(q[0], q[1]);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
    });
    ctx.stroke();
    ctx.restore();
  };

  Editor2D.prototype.drawAxisLine = function (p1, p2, preview) {
    var ctx = this.ctx;
    var a = this.toScreen(p1), b = this.toScreen(p2);
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    var k = (this.width + this.height) * 2 / len;
    ctx.save();
    ctx.strokeStyle = COLORS.axis;
    ctx.globalAlpha = preview ? 0.6 : 1;
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 10]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x - dx * k, a.y - dy * k);
    ctx.lineTo(b.x + dx * k, b.y + dy * k);
    ctx.stroke();
    ctx.restore();
  };

  Editor2D.prototype.isActive = function (key) {
    return !!(this.op && this.op.kind === 'edit' && this.op.hit && keyOf(this.op.hit) === key);
  };

  /* かいている途中の線：オレンジの線、かき始めの輪（ここに戻ると閉じる）、軸に近い端の印 */
  Editor2D.prototype.drawStroke = function (op) {
    var ctx = this.ctx, self = this, sc = op.screen;
    var closePx = Freehand.CONFIG.CLOSE_PX, axisPx = Freehand.CONFIG.AXIS_PX;
    var start = sc[0], cur = sc[sc.length - 1];
    var near = op.length > closePx * 2 && dist(start, cur) <= closePx;   // 指先が輪に入った
    ctx.save();
    ctx.beginPath();
    ctx.arc(start.x, start.y, closePx, 0, Math.PI * 2);
    if (near) { ctx.fillStyle = COLORS.strokeRing; ctx.fill(); }
    ctx.setLineDash(near ? [] : [6, 6]);
    ctx.lineWidth = near ? 3 : 2;
    ctx.strokeStyle = COLORS.stroke;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.stroke;
    ctx.fill();
    ctx.beginPath();
    sc.forEach(function (q, i) { if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.stroke;
    ctx.stroke();
    ctx.restore();
    if (this.axis && sc.length > 1) {   // 線の端が軸に近いとき、軸の上に緑の丸＋チェック印
      [op.pts[0], op.pts[op.pts.length - 1]].forEach(function (p) {
        if (Math.abs(Snap.signedDist(p, self.axis)) * self.scale <= axisPx) self.drawFitMark(Snap.footOnAxis(p, self.axis));
      });
    }
  };

  /* 直線で閉じた所を、紺の点線でしばらく目立たせる */
  /* 線が交わった所：かいた線をうすく残し、交わった所に点線の丸を出す */
  Editor2D.prototype.drawCrossMark = function () {
    var m = this.crossMark;
    if (Date.now() >= m.until) { this.crossMark = null; return; }
    var ctx = this.ctx, self = this;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.stroke;
    ctx.beginPath();
    m.stroke.forEach(function (p, i) { var q = self.toScreen(p); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
    ctx.stroke();
    ctx.globalAlpha = 1;
    var c = this.toScreen(m.at);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 18, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    ctx.restore();
  };

  Editor2D.prototype.drawFlash = function () {
    if (Date.now() >= this.flash.until) { this.flash = null; return; }
    var ctx = this.ctx, a = this.toScreen(this.flash.a), b = this.toScreen(this.flash.b);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 7]);
    ctx.strokeStyle = COLORS.ink;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  };

  /* 軸にぴったり合った所の印（緑で塗った丸＋白いチェック印） */
  Editor2D.prototype.drawFitMark = function (p) {
    var ctx = this.ctx, q = this.toScreen(p), r = 11;
    ctx.save();
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.fit;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(q.x - r * 0.45, q.y + r * 0.02);
    ctx.lineTo(q.x - r * 0.1, q.y + r * 0.38);
    ctx.lineTo(q.x + r * 0.48, q.y - r * 0.36);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  };

  Editor2D.prototype.drawShapeHandles = function () {
    var ctx = this.ctx, sh = this.shape, self = this, axis = this.axis;
    if (sh.type === 'freehand') {
      // 点の●は出さない。軸に接している所（軸の上の点の両はし）に緑の印
      if (!axis) return;
      var f = Rev.axisFrame(axis), on = sh.pts.filter(function (p) { return Snap.isOnAxis(p, axis); });
      if (!on.length) return;
      on.sort(function (a, b) { return ((a.x - b.x) * f.u.x + (a.y - b.y) * f.u.y); });
      this.drawFitMark(on[0]);
      if (dist(on[0], on[on.length - 1]) > 1e-6) this.drawFitMark(on[on.length - 1]);
      return;
    }
    if (sh.type !== 'circle') {
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
    var handleAtTouch = touch && dist(rp, touch) < 1e-6;
    if (touch && !handleAtTouch) this.drawFitDot(touch);
    this.drawHandle(sh.c, 'center', { filled: true, fit: Snap.isOnAxis(sh.c, axis) });
    this.drawHandle(rp, 'radius', { fit: handleAtTouch || Snap.isOnAxis(rp, axis) });
  };

  /*
   * 図形の点（●）
   *   ふつう            ：白い丸＋オレンジの輪
   *   円の中心          ：オレンジで塗った丸＋白い点
   *   軸にぴったり合った：緑で塗った丸＋白いチェック印（色だけでなく、形でも分かるように）
   */
  Editor2D.prototype.drawHandle = function (p, key, opts) {
    opts = opts || {};
    var ctx = this.ctx, q = this.toScreen(p);
    var active = this.isActive(key);
    var r = active ? 15 : 12;
    if (active && this.op.snapped) {   // ドラッグ中に軸へ吸い付いたら、まわりに緑の輪
      ctx.beginPath();
      ctx.arc(q.x, q.y, r + 11, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.fitGlow;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    if (opts.fit) {
      ctx.fillStyle = COLORS.fit;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
      ctx.beginPath();   // チェック印
      ctx.moveTo(q.x - r * 0.45, q.y + r * 0.02);
      ctx.lineTo(q.x - r * 0.1, q.y + r * 0.38);
      ctx.lineTo(q.x + r * 0.48, q.y - r * 0.36);
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      return;
    }
    ctx.fillStyle = opts.filled ? COLORS.stroke : '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.stroke;
    ctx.stroke();
    if (opts.filled) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
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
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
  };

  /* 軸の点（◆） */
  Editor2D.prototype.drawDiamond = function (p, big) {
    var ctx = this.ctx, q = this.toScreen(p), r = big ? 14 : 11;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y);
    ctx.closePath();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.axis;
    ctx.stroke();
  };

  /* 選ばれた図形のまわりの点線の枠 */
  Editor2D.prototype.drawSelectionFrame = function () {
    var ctx = this.ctx, f = this.selectionUI().frame;
    ctx.save();
    ctx.strokeStyle = COLORS.ink;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(f.left, f.top, f.right - f.left, f.bottom - f.top);
    ctx.restore();
  };

  /* 「図形を回す」つまみと「裏返す」ボタン */
  Editor2D.prototype.drawSelectionButtons = function () {
    var ui = this.selectionUI();
    if (ui.flip) this.drawFlipButton(ui.flip, ui.flipMode === 'axis');
    if (!ui.rotate) return;
    var ctx = this.ctx, f = ui.frame;
    var rotating = this.op && this.op.kind === 'edit' && this.op.hit && this.op.hit.kind === 'rotate';
    ctx.save();
    ctx.strokeStyle = COLORS.ink;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.beginPath();   // 枠とつまみをつなぐ線
    ctx.moveTo(ui.rotate.x, ui.below ? f.bottom : f.top);
    ctx.lineTo(ui.rotate.x, ui.rotate.y + (ui.below ? -20 : 20));
    ctx.stroke();
    ctx.restore();
    this.drawRoundButton(ui.rotate, 'turn', rotating);
    if (rotating && this.op.angleDeg !== undefined) {   // 回した角度を表示
      ctx.save();
      ctx.font = '700 15px "Hiragino Sans", "BIZ UDPGothic", "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var label = Math.abs(this.op.angleDeg) + '°';
      var tx = ui.rotate.x, ty = ui.rotate.y + (ui.below ? 36 : -36);
      var tw = ctx.measureText(label).width + 16;
      ctx.fillStyle = COLORS.ink;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx - tw / 2, ty - 13, tw, 26, 13); else ctx.rect(tx - tw / 2, ty - 13, tw, 26);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, tx, ty + 1);
      ctx.restore();
    }
  };

  Editor2D.prototype.drawRoundButton = function (q, icon, active) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 20, 0, Math.PI * 2);
    ctx.fillStyle = active ? COLORS.ink : '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
    if (!this.paths[icon]) this.paths[icon] = new Path2D(ICON[icon]);
    ctx.save();
    ctx.translate(q.x - 12 * 0.95, q.y - 12 * 0.95);
    ctx.scale(0.95, 0.95);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = active ? '#FFFFFF' : COLORS.ink;
    ctx.stroke(this.paths[icon]);
    ctx.restore();
  };

  /* 裏返すボタン。軸で裏返すときは、まん中の線を軸の色（赤）の点線にする */
  Editor2D.prototype.drawFlipButton = function (q, byAxis) {
    if (!byAxis) return this.drawRoundButton(q, 'flip', false);
    this.drawRoundButton(q, 'flipSides', false);
    var ctx = this.ctx;
    if (!this.paths.flipLine) this.paths.flipLine = new Path2D(ICON.flipLine);
    ctx.save();
    ctx.translate(q.x - 12 * 0.95, q.y - 12 * 0.95);
    ctx.scale(0.95, 0.95);
    ctx.lineWidth = 2.6;
    ctx.setLineDash([3, 2.5]);
    ctx.strokeStyle = COLORS.axis;
    ctx.stroke(this.paths.flipLine);
    ctx.restore();
  };

  root.Editor2D = Editor2D;
})(window);
