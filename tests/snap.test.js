/*
 * 吸い付き（snap.js）のチェック
 * 使い方: node tests/snap.test.js
 *
 * 1ます = 40ピクセルとして計算する（軸に吸い付く 20px = 0.5ます、軸上の交点に吸い付く 12px = 0.3ます）。
 */
'use strict';
var Snap = require('../js/snap.js');

var failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  OK  ' + name); }
  else { failed++; console.log('  NG  ' + name + (detail ? '  (' + detail + ')' : '')); }
}
function P(x, y) { return { x: x, y: y }; }
function near(a, b, eps) { return Math.hypot(a.x - b.x, a.y - b.y) < (eps || 1e-9); }
function fmt(p) { return '(' + p.x.toFixed(4) + ', ' + p.y.toFixed(4) + ')'; }
function onAxis(p, axis) { return Math.abs(Snap.signedDist(p, axis)) < 1e-9; }

var V = { p1: P(1, -3), p2: P(1, 3) };     // 縦の軸 x = 1
var H = { p1: P(-3, -1), p2: P(3, -1) };   // 横の軸 y = -1
var O = { p1: P(0, 0), p2: P(2, 1) };      // 斜めの軸（交点は (2,1) おき）
function ctx(axis, extra) {
  var c = { axis: axis, scale: 40, maxR: 7 };
  for (var k in extra) c[k] = extra[k];
  return c;
}

console.log('頂点の吸い付き');
(function () {
  var r = Snap.snapVertex(P(1.3, 0.5), ctx(V));
  check('縦の軸：12px はなれた頂点が軸の上に', r.onAxis && near(r.p, P(1, 0.5)), fmt(r.p));
  var a = Snap.snapVertex(P(1.2, 0.55), ctx(V)), b = Snap.snapVertex(P(0.8, 1.6), ctx(V));
  check('縦の軸：吸い付いたまま動かすと軸の上をすべる', a.onAxis && b.onAxis && near(a.p, P(1, 0.55)) && near(b.p, P(1, 1.6)), fmt(a.p) + ' ' + fmt(b.p));
  var g = Snap.snapVertex(P(1.3, 2.1), ctx(V));
  check('縦の軸：軸上の方眼の交点が近ければ交点に', g.onAxis && near(g.p, P(1, 2)), fmt(g.p));
  var f = Snap.snapVertex(P(1.6, 0.4), ctx(V));
  check('縦の軸：24px はなすと外れて方眼の交点に', !f.onAxis && near(f.p, P(2, 0)), fmt(f.p));
  var h = Snap.snapVertex(P(2.4, -0.7), ctx(H));
  check('横の軸：軸の上に', h.onAxis && near(h.p, P(2.4, -1)), fmt(h.p));
  var o1 = Snap.snapVertex(P(2, 1.4), ctx(O));
  check('斜めの軸：軸上の交点 (2,1) に', o1.onAxis && near(o1.p, P(2, 1)), fmt(o1.p));
  var o2 = Snap.snapVertex(P(3, 1.2), ctx(O));
  check('斜めの軸：交点から遠いところでは軸の上をすべる', o2.onAxis && onAxis(o2.p, O) && near(o2.p, P(2.88, 1.44), 1e-9), fmt(o2.p));
  var o3 = Snap.snapVertex(P(3, 2.2), ctx(O));
  check('斜めの軸：はなれると外れる', !o3.onAxis && near(o3.p, P(3, 2)), fmt(o3.p));
  var n = Snap.snapVertex(P(1.3, 0.5), ctx(null));
  check('軸がないときは方眼の交点だけ', !n.onAxis && near(n.p, P(1, 1)), fmt(n.p));
  var ob = Snap.snapVertex(P(1.3, 0.5), ctx(V, { inBounds: function (p) { return p.x > 5; } }));
  check('吸い付く先が画面の外なら吸い付かない', !ob.onAxis);
})();

console.log('図形全体の平行移動');
(function () {
  var rect = [P(2, 0), P(4, 0), P(4, 2), P(2, 2)];
  var r = Snap.snapTranslation(rect, P(-0.8, 0.3), ctx(V));
  check('長方形の左の辺が縦の軸に乗る', r && onAxis(r.pts[0], V) && onAxis(r.pts[3], V) && near(r.pts[1], P(3, 0)),
    r ? r.pts.map(fmt).join(' ') : 'null');
  check('遠いときは吸い付かない', Snap.snapTranslation(rect, P(-0.2, 0), ctx(V)) === null);
  check('軸がないときは吸い付かない', Snap.snapTranslation(rect, P(-0.8, 0), ctx(null)) === null);

  var tri = [P(3, 0), P(5, 0), P(4, 2)];
  var n = P(-1 / Math.sqrt(5), 2 / Math.sqrt(5));
  var sd = Snap.signedDist(tri[0], O);
  var off = P(-0.95 * sd * n.x + 0.1, -0.95 * sd * n.y + 0.05);
  var t = Snap.snapTranslation(tri, off, ctx(O));
  var sameShape = t && [[0, 1], [1, 2], [2, 0]].every(function (e) {
    var a = Math.hypot(tri[e[0]].x - tri[e[1]].x, tri[e[0]].y - tri[e[1]].y);
    var b = Math.hypot(t.pts[e[0]].x - t.pts[e[1]].x, t.pts[e[0]].y - t.pts[e[1]].y);
    return Math.abs(a - b) < 1e-9;
  });
  check('斜めの軸：近づいた頂点が軸に乗り、形は変わらない', t && t.snappedIndex === 0 && onAxis(t.pts[0], O) && sameShape,
    t ? t.pts.map(fmt).join(' ') : 'null');
})();

console.log('円の半径の点');
(function () {
  var circle = { c: P(4, 0), r: 1, a: 0 };
  var f1 = Snap.snapRadiusHandle(P(5, 1.3), circle, ctx(V));
  check('ななめ上に動かせる（半径は 0.5 刻み）', !f1.onAxis && f1.r === 1.5 && Math.abs(f1.a - Math.atan2(1.3, 1)) < 1e-12, 'r=' + f1.r);
  var f2 = Snap.snapRadiusHandle(P(4, -2.6), circle, ctx(V));
  check('真下にも動かせる', !f2.onAxis && f2.r === 2.5 && Math.abs(f2.a + Math.PI / 2) < 1e-12, 'r=' + f2.r + ' a=' + f2.a);
  var f3 = Snap.snapRadiusHandle(P(2.2, 0.1), circle, ctx(V));
  check('軸から遠ければ吸い付かない', !f3.onAxis && f3.r === 2, 'r=' + f3.r);
  var t1 = Snap.snapRadiusHandle(P(1.2, 0.1), circle, ctx(V));
  check('軸に近づけると接する（半径 = 中心と軸の距離 3）', t1.onAxis && t1.target === 'tangent' && Math.abs(t1.r - 3) < 1e-12 && Math.abs(Math.abs(t1.a) - Math.PI) < 1e-12, 'r=' + t1.r);
  var t2 = Snap.snapRadiusHandle(P(1.2, 2.5), circle, ctx(V));
  check('ななめから軸に近づけても、いちばん近い点で接する', t2.onAxis && Math.abs(t2.r - 3) < 1e-12, 'r=' + t2.r);
  check('接した円は isTangent', Snap.isTangent({ c: circle.c, r: t2.r }, V));

  var oc = { c: P(1, 3), r: 1, a: 0 };
  var t3 = Snap.snapRadiusHandle(P(4, 2.1), oc, ctx(O));
  var hp = P(oc.c.x + t3.r * Math.cos(t3.a), oc.c.y + t3.r * Math.sin(t3.a));
  check('斜めの軸に接する（半径 = √5、半径の点は軸の上）', t3.onAxis && Math.abs(t3.r - Math.sqrt(5)) < 1e-12 && onAxis(hp, O) && near(hp, P(2, 1), 1e-9), 'r=' + t3.r + ' ' + fmt(hp));
  check('斜めの軸：isTangent', Snap.isTangent({ c: oc.c, r: t3.r }, O));

  var close = Snap.snapRadiusHandle(P(1.1, 0.5), { c: P(1.2, 0), r: 1, a: 0 }, ctx(V));
  check('中心が軸に近すぎる（0.5 未満）ときは吸い付かない', !close.onAxis);

  // 将来（軸をまたぐ図形に対応したとき）の動き：軸の上をすべり、接点に吸い付く
  var cr = ctx(V, { allowCrossing: true });
  var s1 = Snap.snapRadiusHandle(P(1.1, 2), circle, cr);
  check('[将来] 軸の上をすべって半径が変わる', s1.onAxis && s1.target === 'slide' && Math.abs(s1.r - Math.sqrt(13)) < 1e-12, 'r=' + s1.r);
  var s2 = Snap.snapRadiusHandle(P(1.1, 0.2), circle, cr);
  check('[将来] 接点の近くでは接点に吸い付く', s2.onAxis && s2.target === 'tangent' && Math.abs(s2.r - 3) < 1e-12, 'r=' + s2.r);
  check('吸い付く先の一覧に接点がある', Snap.radiusTargetsOnAxis(circle, ctx(V)).some(function (t) { return t.kind === 'tangent' && near(t.p, P(1, 0)); }));
})();

console.log('円の中心');
(function () {
  var a = Snap.snapCircleCenter(P(2.3, 0.4), 1.5, ctx(V));
  check('接する位置の近くでは、接する位置に', a && near(a.c, P(2.5, 0.4)), a ? fmt(a.c) : 'null');
  var b = Snap.snapCircleCenter(P(2.6, 2.05), 1.5, ctx(V));
  check('接したまま軸に沿ってすべる（交点の高さにも吸い付く）', b && near(b.c, P(2.5, 2)), b ? fmt(b.c) : 'null');
  check('軸から大きく離すと外れる', Snap.snapCircleCenter(P(3.2, 0), 1.5, ctx(V)) === null);
  check('軸に大きく近づけると外れる', Snap.snapCircleCenter(P(1.8, 0), 1.5, ctx(V)) === null);
  var c = Snap.snapCircleCenter(P(-0.4, 0), 1.5, ctx(V));
  check('軸の反対側でも接する', c && near(c.c, P(-0.5, 0)), c ? fmt(c.c) : 'null');
  var n = P(-1 / Math.sqrt(5), 2 / Math.sqrt(5));
  var o = Snap.snapCircleCenter(P(4 + n.x * 1.1, 2 + n.y * 1.1), 1, ctx(O));
  check('斜めの軸に接する', o && Snap.isTangent({ c: o.c, r: 1 }, O) && near(o.c, P(4 + n.x, 2 + n.y), 1e-9), o ? fmt(o.c) : 'null');
  var hz = Snap.snapCircleCenter(P(0.5, 0.2), 1, ctx(H));
  check('横の軸に接する', hz && near(hz.c, P(0.5, 0)), hz ? fmt(hz.c) : 'null');
  check('軸がないときは吸い付かない', Snap.snapCircleCenter(P(2.3, 0), 1.5, ctx(null)) === null);
})();

console.log('\n合格 ' + passed + ' / 不合格 ' + failed);
process.exit(failed ? 1 : 0);
