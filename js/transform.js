/*
 * 図形を「回す」「裏返す」ための計算
 *
 * 図形そのものを動かす操作（回転体をつくる操作とは別）。画面には依存しないので、Node でもテストできる。
 *   回す   ：図形の中心のまわりに回す（角度は 15° 刻みにそろえる）
 *   裏返す ：図形と軸の位置関係で、裏返し方を変える（flipMode）
 *     軸がない・軸から離れている → その場で左右に（図形を囲む枠の中央を通る縦の線で。枠もつまみも動かない）
 *     軸に接している・軸をまたぐ → 軸を対称の軸にして（軸の上の点は動かない）
 *     円は、その場で裏返しても変わらないので、軸に接している・またぐときだけ裏返す
 * 図形の中心は、三角形・四角形は面積の重心、半円は直径の中点、円は円の中心。
 */
(function (root) {
  'use strict';

  var Rev = root.Rev || (typeof require !== 'undefined' ? require('./geometry.js') : null);
  var Snap = root.Snap || (typeof require !== 'undefined' ? require('./snap.js') : null);

  var STEP_DEG = 15;

  function P(x, y) { return { x: x, y: y }; }
  function clone(shape) { return JSON.parse(JSON.stringify(shape)); }

  /* 図形の中心 */
  function center(shape) {
    if (shape.type === 'circle') return P(shape.c.x, shape.c.y);
    var pts = shape.pts;
    if (shape.type === 'semicircle') return P((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    var a = 0, cx = 0, cy = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length], c = p.x * q.y - q.x * p.y;
      a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c;
    }
    if (Math.abs(a) < 1e-12) {   // つぶれた形のときは頂点の平均
      return P(pts.reduce(function (s, p) { return s + p.x; }, 0) / pts.length,
               pts.reduce(function (s, p) { return s + p.y; }, 0) / pts.length);
    }
    return P(cx / (3 * a), cy / (3 * a));
  }

  /* 角度（ラジアン）を 15° 刻みにそろえる */
  function snapAngle(rad) {
    var step = STEP_DEG * Math.PI / 180;
    return Math.round(rad / step) * step;
  }

  /* 点 p を、点 c のまわりに角度 rad だけ回す（反時計回りが正） */
  function rotatePoint(p, c, rad) {
    var cs = Math.cos(rad), sn = Math.sin(rad), dx = p.x - c.x, dy = p.y - c.y;
    return P(c.x + dx * cs - dy * sn, c.y + dx * sn + dy * cs);
  }

  /* 図形を、中心 c（省略時は図形の中心）のまわりに回した新しい図形 */
  function rotate(shape, rad, c) {
    var s = clone(shape);
    c = c || center(shape);
    if (s.type === 'circle') {
      s.c = rotatePoint(s.c, c, rad);
      s.a = (s.a || 0) + rad;   // 大きさを決める点も一緒に回す
    } else {
      s.pts = s.pts.map(function (p) { return rotatePoint(p, c, rad); });
    }
    return s;
  }

  /*
   * 裏返し方を決める：'place'（その場で左右に）| 'axis'（軸を対称の軸にして）| null（裏返すボタンを出さない）
   * 「軸に接している」は、吸い付きで緑の印が出る状態（editor2d.js の snapState）と同じ判定にする。
   */
  function flipMode(shape, axis) {
    var f = axis ? Rev.axisFrame(axis) : null;
    if (f) {
      if (Rev.axisSide(shape, f) === 'cross') return 'axis';
      var touch = shape.type === 'circle'
        ? Snap.isTangent(shape, axis)
        : shape.pts.some(function (p) { return Snap.isOnAxis(p, axis); });
      if (touch) return 'axis';
    }
    return shape.type === 'circle' ? null : 'place';
  }

  /* その場で左右に裏返す：図形を囲む枠（画面の点線の枠）の中央を通る縦の線で */
  function flipInPlace(shape) {
    var s = clone(shape);
    if (s.type === 'circle') return s;   // 円は変わらない
    var minX = Infinity, maxX = -Infinity;
    Rev.outline(shape).pts.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); });
    var sum = minX + maxX;
    s.pts = s.pts.map(function (p) { return P(sum - p.x, p.y); });
    if (s.type === 'semicircle') s.side = -(s.side || 1);   // 左右反対にすると、弧の側（直径の左か右か）も反対になる
    return s;
  }

  /* 点 p を、軸を対称の軸にして折り返す（軸の上の点はそのまま） */
  function reflectAcrossAxis(p, axis) {
    var f = Rev.axisFrame(axis);
    var r = (p.x - f.A.x) * f.n.x + (p.y - f.A.y) * f.n.y;
    if (Snap.isOnAxis(p, axis)) return P(p.x, p.y);
    return P(p.x - 2 * r * f.n.x, p.y - 2 * r * f.n.y);
  }

  /* 軸を対称の軸にして裏返す：図形は軸の反対側に移り、軸に触れている点は動かない */
  function flipAcrossAxis(shape, axis) {
    var s = clone(shape);
    if (s.type === 'circle') {
      var f = Rev.axisFrame(axis), th = Math.atan2(f.u.y, f.u.x);
      s.c = reflectAcrossAxis(s.c, axis);
      s.a = 2 * th - (s.a || 0);   // 大きさを決める点の向きも、軸で折り返す
      return s;
    }
    s.pts = s.pts.map(function (p) { return reflectAcrossAxis(p, axis); });
    if (s.type === 'semicircle') s.side = -(s.side || 1);
    return s;
  }

  /* 裏返し方に合わせて裏返した新しい図形 */
  function flip(shape, axis) {
    var mode = flipMode(shape, axis);
    if (mode === 'axis') return flipAcrossAxis(shape, axis);
    return flipInPlace(shape);
  }

  var Transform = {
    STEP_DEG: STEP_DEG,
    center: center,
    snapAngle: snapAngle,
    rotatePoint: rotatePoint,
    rotate: rotate,
    flip: flip,
    flipMode: flipMode,
    flipInPlace: flipInPlace,
    flipAcrossAxis: flipAcrossAxis,
    reflectAcrossAxis: reflectAcrossAxis,
    clone: clone
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Transform;
  else root.Transform = Transform;
})(this);
