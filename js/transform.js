/*
 * 図形を「回す」「裏返す」ための計算
 *
 * 図形そのものを動かす操作（回転体をつくる操作とは別）。画面には依存しないので、Node でもテストできる。
 *   回す   ：図形の中心のまわりに回す（角度は 15° 刻みにそろえる）
 *   裏返す ：三角形・四角形は中心を通る縦の線で左右に、半円は直径を線にして裏返す
 * 図形の中心は、三角形・四角形は面積の重心、半円は直径の中点、円は円の中心。
 */
(function (root) {
  'use strict';

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

  /* 図形を裏返した新しい図形（円は変わらない） */
  function flip(shape) {
    var s = clone(shape);
    if (s.type === 'semicircle') {
      s.side = -s.side;   // 直径を線にして裏返すと、弧が反対側に移る
    } else if (s.type === 'polygon') {
      var cx = center(shape).x;
      s.pts = s.pts.map(function (p) { return P(2 * cx - p.x, p.y); });
    }
    return s;
  }

  var Transform = {
    STEP_DEG: STEP_DEG,
    center: center,
    snapAngle: snapAngle,
    rotatePoint: rotatePoint,
    rotate: rotate,
    flip: flip,
    clone: clone
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Transform;
  else root.Transform = Transform;
})(this);
