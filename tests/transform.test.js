/*
 * 図形を「回す」「裏返す」計算（transform.js）のチェック
 * 使い方: node tests/transform.test.js
 */
'use strict';
var T = require('../js/transform.js');
var Rev = require('../js/geometry.js');

var failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  OK  ' + name); }
  else { failed++; console.log('  NG  ' + name + (detail ? '  (' + detail + ')' : '')); }
}
function P(x, y) { return { x: x, y: y }; }
function near(a, b, eps) { return Math.hypot(a.x - b.x, a.y - b.y) < (eps || 1e-9); }
function sides(pts) {
  return pts.map(function (p, i) { var q = pts[(i + 1) % pts.length]; return Math.hypot(q.x - p.x, q.y - p.y); });
}
function volume(shape, axis) {
  var a = Rev.analyze(shape, axis);
  return Rev.meshVolume(Rev.buildSurface(a).positions);
}
var DEG = Math.PI / 180;

var tri = { type: 'polygon', pts: [P(1, -2), P(4, -2), P(1, 2)] };
var quad = { type: 'polygon', pts: [P(1, -2), P(4, -2), P(4, 2), P(1, 2)] };
var semi = { type: 'semicircle', pts: [P(1, -2), P(1, 2)], side: -1 };
var circle = { type: 'circle', c: P(3, 0), r: 1.5, a: 0 };

console.log('図形の中心');
check('三角形は重心', near(T.center(tri), P(2, -2 / 3)));
check('長方形は対角線の交点', near(T.center(quad), P(2.5, 0)));
check('半円は直径の中点', near(T.center(semi), P(1, 0)));
check('円は円の中心', near(T.center(circle), P(3, 0)));

console.log('角度を 15° 刻みにそろえる');
check('22° → 15°', Math.abs(T.snapAngle(22 * DEG) - 15 * DEG) < 1e-12);
check('23° → 30°', Math.abs(T.snapAngle(23 * DEG) - 30 * DEG) < 1e-12);
check('−50° → −45°', Math.abs(T.snapAngle(-50 * DEG) + 45 * DEG) < 1e-12);

console.log('図形を回す');
(function () {
  var r = T.rotate(tri, 15 * DEG);
  var s0 = sides(tri.pts), s1 = sides(r.pts);
  check('15° 回しても辺の長さは同じ', s0.every(function (v, i) { return Math.abs(v - s1[i]) < 1e-9; }));
  check('中心は動かない', near(T.center(r), T.center(tri)));
  check('元の図形は変わらない', near(tri.pts[1], P(4, -2)));
  var s = tri;
  for (var i = 0; i < 24; i++) s = T.rotate(s, 15 * DEG);
  check('15° を24回（360°）でもとに戻る', s.pts.every(function (p, k) { return near(p, tri.pts[k], 1e-9); }));
  var r90 = T.rotate(quad, 90 * DEG);
  check('長方形を 90° 回すと横長に', near(r90.pts[0], P(4.5, -1.5)) && near(r90.pts[2], P(0.5, 1.5)),
    JSON.stringify(r90.pts));
  var rs = T.rotate(semi, 90 * DEG);
  check('半円を 90° 回すと直径が横に（弧の側はそのまま）', near(rs.pts[0], P(3, 0)) && near(rs.pts[1], P(-1, 0)) && rs.side === -1,
    JSON.stringify(rs));
  var rc = T.rotate(circle, 45 * DEG);
  check('円は回しても位置も大きさも同じ', near(rc.c, circle.c) && rc.r === circle.r);
})();

console.log('図形を裏返す');
(function () {
  var f = T.flip(tri);
  var c = T.center(tri);
  check('三角形は中心を通る縦の線で左右に裏返る', f.pts.every(function (p, k) { return near(p, P(2 * c.x - tri.pts[k].x, tri.pts[k].y)); }));
  var ff = T.flip(f);
  check('2回裏返すともとに戻る', ff.pts.every(function (p, k) { return near(p, tri.pts[k], 1e-12); }));
  var fs = T.flip(semi);
  check('半円は弧の側だけが反対になる', fs.side === 1 && near(fs.pts[0], semi.pts[0]) && near(fs.pts[1], semi.pts[1]));
  check('半円も2回でもとに戻る', T.flip(fs).side === -1);
  var fc = T.flip(circle);
  check('円は裏返しても変わらない', near(fc.c, circle.c) && fc.r === circle.r);
})();

console.log('回した・裏返した図形からできる立体');
(function () {
  // 図形と軸を一緒に回すと、立体は同じ（体積が変わらない）
  var axis = { p1: P(0, -5), p2: P(0, 5) };
  [['三角形', tri], ['長方形', quad], ['半円', semi]].forEach(function (c) {
    var v0 = volume(c[1], axis);
    var ang = 45 * DEG, ctr = P(0, 0);
    var rs = T.rotate(c[1], ang, ctr);
    var ra = { p1: T.rotatePoint(axis.p1, ctr, ang), p2: T.rotatePoint(axis.p2, ctr, ang) };
    var v1 = volume(rs, ra);
    check(c[0] + '：図形と軸を一緒に 45° 回しても体積は同じ', Math.abs(v1 - v0) / v0 < 1e-6, v0.toFixed(4) + ' / ' + v1.toFixed(4));
  });
  // 縦の軸に対して、縦の線で裏返した図形を軸も一緒に裏返すと、体積は同じ
  var v2 = volume(tri, { p1: P(1, -5), p2: P(1, 5) });
  var c2 = T.center(tri);
  var v3 = volume(T.flip(tri), { p1: P(2 * c2.x - 1, -5), p2: P(2 * c2.x - 1, 5) });
  check('三角形：裏返しても、軸も一緒なら体積は同じ（円錐）', Math.abs(v3 - v2) / v2 < 1e-6 && Math.abs(v2 - Math.PI * 9 * 4 / 3) / v2 < 0.01,
    v2.toFixed(4) + ' / ' + v3.toFixed(4));
  // 半円を裏返しても、直径が軸なら球のまま
  var axisD = { p1: P(1, -5), p2: P(1, 5) };
  var vs = volume(semi, axisD), vf = volume(T.flip(semi), axisD);
  check('半円：直径が軸なら、裏返しても球（4/3πr³）', Math.abs(vs - vf) / vs < 1e-6 && Math.abs(vs - 4 / 3 * Math.PI * 8) / vs < 0.01,
    vs.toFixed(4) + ' / ' + vf.toFixed(4));
})();

console.log('\n合格 ' + passed + ' / 不合格 ' + failed);
process.exit(failed ? 1 : 0);
