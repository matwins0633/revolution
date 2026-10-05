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

/* 図形を囲む枠（画面の点線の枠と同じく、輪郭の点の範囲） */
function box(shape) {
  var b = { l: Infinity, r: -Infinity, b: Infinity, t: -Infinity };
  Rev.outline(shape).pts.forEach(function (p) {
    b.l = Math.min(b.l, p.x); b.r = Math.max(b.r, p.x); b.b = Math.min(b.b, p.y); b.t = Math.max(b.t, p.y);
  });
  return b;
}
function sameBox(a, b) { return ['l', 'r', 'b', 't'].every(function (k) { return Math.abs(a[k] - b[k]) < 1e-9; }); }
function samePts(a, b, eps) { return a.length === b.length && a.every(function (p, k) { return near(p, b[k], eps || 1e-9); }); }
/* 点の集まりとして同じか（順番は問わない） */
function sameSet(a, b, eps) {
  return a.length === b.length && a.every(function (p) { return b.some(function (q) { return near(p, q, eps || 1e-9); }); });
}
function radiusPt(c) { var a = c.a || 0; return P(c.c.x + c.r * Math.cos(a), c.c.y + c.r * Math.sin(a)); }
/* 軸に沿った座標 (t, r) → 方眼の点。r は軸からの距離（向きつき） */
function frameOf(axis) {
  var dx = axis.p2.x - axis.p1.x, dy = axis.p2.y - axis.p1.y, L = Math.hypot(dx, dy);
  var u = P(dx / L, dy / L), n = P(-u.y, u.x);
  return {
    W: function (t, r) { return P(axis.p1.x + t * u.x + r * n.x, axis.p1.y + t * u.y + r * n.y); },
    r: function (p) { return (p.x - axis.p1.x) * n.x + (p.y - axis.p1.y) * n.y; },
    t: function (p) { return (p.x - axis.p1.x) * u.x + (p.y - axis.p1.y) * u.y; },
    theta: Math.atan2(u.y, u.x)
  };
}
var AXES = [
  ['縦の軸', { p1: P(0, -5), p2: P(0, 5) }],
  ['横の軸', { p1: P(-5, 0), p2: P(5, 0) }],
  ['斜めの軸', { p1: P(-2, -3), p2: P(3, 1) }]
];

console.log('その場で裏返す（枠の中央を通る縦の線で左右に）');
(function () {
  var f = T.flipInPlace(tri);
  check('三角形：枠の中央（x = 2.5）を通る縦の線で裏返る', samePts(f.pts, [P(4, -2), P(1, -2), P(4, 2)]), JSON.stringify(f.pts));
  var fh = { type: 'freehand', pts: [P(1, 0), P(3, 0), P(4, 1), P(3, 3), P(1, 2)], corners: [true, false, true, false, true] };
  var cases = [
    ['三角形', tri], ['四角形', quad], ['15° 回した四角形', T.rotate(quad, 15 * DEG)],
    ['半円', semi], ['30° 回した半円', T.rotate(semi, 30 * DEG)],
    ['フリーハンド', fh], ['45° 回したフリーハンド', T.rotate(fh, 45 * DEG)]
  ];
  cases.forEach(function (c) {
    var s0 = c[1], s1 = T.flipInPlace(s0), s2 = T.flipInPlace(s1);
    check(c[0] + '：点線の枠の位置が変わらない', sameBox(box(s0), box(s1)), JSON.stringify(box(s0)) + ' → ' + JSON.stringify(box(s1)));
    var o0 = Rev.outline(s0).pts, o1 = Rev.outline(s1).pts, b = box(s0), mx = b.l + b.r;
    check(c[0] + '：輪郭が左右反対になる', sameSet(o1, o0.map(function (p) { return P(mx - p.x, p.y); })));
    check(c[0] + '：2回裏返すともとに戻る', samePts(s2.pts, s0.pts, 1e-9) && s2.side === s0.side);
  });
  var fs = T.flipInPlace(semi);
  check('半円：弧が反対側に移り、直径は枠の反対のはしに移る（x = 1 → 3）', fs.side === 1 && near(fs.pts[0], P(3, -2)) && near(fs.pts[1], P(3, 2)), JSON.stringify(fs));
  check('フリーハンド：角の印はそのまま', JSON.stringify(T.flipInPlace(fh).corners) === JSON.stringify(fh.corners));
  check('元の図形は変わらない', near(tri.pts[0], P(1, -2)));
})();

console.log('裏返し方を決める（flipMode）');
(function () {
  var fh = { type: 'freehand', pts: [P(0, 0), P(2, -1), P(3, 1), P(1, 2)], corners: [false, false, false, false] };
  var V = function (x) { return { p1: P(x, -5), p2: P(x, 5) }; };
  check('軸がない → その場', T.flipMode(tri, null) === 'place');
  check('軸がない円 → 裏返すボタンなし', T.flipMode(circle, null) === null);
  check('軸から離れた三角形 → その場', T.flipMode(tri, V(0)) === 'place');
  check('軸から離れた三角形（斜めの軸）→ その場', T.flipMode(tri, { p1: P(-5, -1), p2: P(1, 5) }) === 'place');
  check('軸から離れた円 → ボタンなし', T.flipMode(circle, V(0)) === null);
  check('辺が軸に重なる三角形 → 軸で', T.flipMode(tri, V(1)) === 'axis');
  check('頂点だけが軸の上の三角形 → 軸で', T.flipMode(tri, V(4)) === 'axis');
  check('軸をまたぐ三角形 → 軸で', T.flipMode(tri, V(2)) === 'axis');
  check('軸に接する円 → 軸で', T.flipMode(circle, V(1.5)) === 'axis');
  check('軸をまたぐ円 → 軸で', T.flipMode(circle, V(3)) === 'axis');
  check('直径の端が軸の上の半円 → 軸で', T.flipMode(semi, { p1: P(-5, 2), p2: P(5, 2) }) === 'axis');
  check('直径が軸に重なる半円 → 軸で', T.flipMode(semi, V(1)) === 'axis');
  check('輪郭の点が軸の上のフリーハンド → 軸で', T.flipMode(fh, V(0)) === 'axis');
  check('わずかに離れた三角形（緑の印が出ない）→ その場', T.flipMode(tri, V(0.999)) === 'place');
  check('わずかに離れた円 → ボタンなし', T.flipMode(circle, V(1.49)) === null);
})();

console.log('軸を対称の軸にして裏返す（軸に接している図形）');
AXES.forEach(function (ax) {
  var name = ax[0], axis = ax[1], F = frameOf(axis), W = F.W;
  var shapes = [
    ['頂点が軸の上の三角形', { type: 'polygon', pts: [W(0, 0), W(3, 1), W(1, 3)] }],
    ['1辺が軸に重なる四角形', { type: 'polygon', pts: [W(-1, 0), W(2, 0), W(2, 2), W(-1, 2)] }],
    ['直径の端が軸の上の半円', { type: 'semicircle', pts: [W(0, 0), W(0, 3)], side: -1 }],
    ['軸に吸い付けたフリーハンド', { type: 'freehand', pts: [W(0, 0), W(1, 0.6), W(1.5, 2), W(0.4, 2.6), W(-0.8, 1.2)], corners: [false, false, true, false, false] }]
  ];
  shapes.forEach(function (c) {
    var s0 = c[1], s1 = T.flipAcrossAxis(s0, axis);
    var fixed = s0.pts.every(function (p, k) { return Math.abs(F.r(p)) > 1e-9 || near(s1.pts[k], p, 1e-12); });
    var moved = s0.pts.every(function (p, k) {
      return Math.abs(F.r(s1.pts[k]) + F.r(p)) < 1e-9 && Math.abs(F.t(s1.pts[k]) - F.t(p)) < 1e-9;
    });
    var sideOK = Rev.outline(s1).pts.every(function (p) { return F.r(p) < 1e-9; });
    check(name + '・' + c[0] + '：flipMode は「軸で」', T.flipMode(s0, axis) === 'axis');
    check(name + '・' + c[0] + '：軸に触れている点は動かない', fixed);
    check(name + '・' + c[0] + '：ほかの点は軸の反対側の、同じ距離の所に移る', moved && sideOK);
    if (s0.type === 'semicircle') check(name + '・' + c[0] + '：弧も軸の反対側に移る（side が反対）', s1.side === -s0.side);
    var v0 = volume(s0, axis), v1 = volume(s1, axis);
    check(name + '・' + c[0] + '：回転体の体積が変わらない', Math.abs(v1 - v0) / v0 < 1e-9, v0.toFixed(6) + ' / ' + v1.toFixed(6));
  });
  // 軸に接する円
  var c0 = { type: 'circle', c: W(1, 1.5), r: 1.5, a: 0.3 }, c1 = T.flipAcrossAxis(c0, axis);
  var tp = W(1, 0);
  check(name + '・軸に接する円：flipMode は「軸で」', T.flipMode(c0, axis) === 'axis');
  check(name + '・軸に接する円：中心が軸の反対側に移り、接点は同じ', near(c1.c, W(1, -1.5)) && Math.abs(Math.hypot(tp.x - c1.c.x, tp.y - c1.c.y) - c1.r) < 1e-9);
  var rp0 = radiusPt(c0), rp1 = radiusPt(c1);
  check(name + '・軸に接する円：大きさを決める点も軸で折り返される', near(rp1, W(F.t(rp0), -F.r(rp0))), JSON.stringify(rp1));
  var cv0 = volume(c0, axis), cv1 = volume(c1, axis);
  check(name + '・軸に接する円：回転体の体積がほぼ変わらない', Math.abs(cv1 - cv0) / cv0 < 1e-3, cv0.toFixed(4) + ' / ' + cv1.toFixed(4));
});

console.log('軸を対称の軸にして裏返す（軸をまたぐ図形）');
AXES.forEach(function (ax) {
  var name = ax[0], axis = ax[1], F = frameOf(axis), W = F.W;
  var shapes = [
    ['三角形', { type: 'polygon', pts: [W(-1, -1), W(3, 2), W(0, 3)] }],
    ['長方形', { type: 'polygon', pts: [W(-1, -1), W(2, -1), W(2, 2), W(-1, 2)] }],
    ['半円', { type: 'semicircle', pts: [W(0, -1), W(2, 2)], side: 1 }],
    ['円', { type: 'circle', c: W(1, 0.8), r: 1.5, a: 0 }],
    ['フリーハンド', { type: 'freehand', pts: [W(0, -1), W(2, -0.5), W(2.5, 1.5), W(0.5, 2.5), W(-1, 1)], corners: [true, false, false, false, false] }]
  ];
  shapes.forEach(function (c) {
    var s0 = c[1], s1 = T.flipAcrossAxis(s0, axis);
    check(name + '・' + c[0] + '：flipMode は「軸で」', T.flipMode(s0, axis) === 'axis');
    // 「折り返しを見る」でかく形：もとの図形の輪郭を、軸で折り返したもの
    var folded = Rev.outline(s0).pts.map(function (p) { return T.reflectAcrossAxis(p, axis); });
    var overlap = s0.type === 'circle'
      ? folded.every(function (p) { return Math.abs(Math.hypot(p.x - s1.c.x, p.y - s1.c.y) - s1.r) < 1e-9; })
      : sameSet(Rev.outline(s1).pts, folded);
    check(name + '・' + c[0] + '：裏返した図形が「折り返しを見る」の折り返しと重なる', overlap);
    var v0 = volume(s0, axis), v1 = volume(s1, axis);
    check(name + '・' + c[0] + '：回転体の体積が変わらない', Math.abs(v1 - v0) / v0 < (s0.type === 'circle' ? 1e-3 : 1e-9), v0.toFixed(6) + ' / ' + v1.toFixed(6));
  });
});

console.log('裏返す（flip：裏返し方に合わせて）');
(function () {
  var V = { p1: P(0, -5), p2: P(0, 5) };
  check('離れているときは、その場で裏返す', samePts(T.flip(tri, V).pts, T.flipInPlace(tri).pts));
  var A = { p1: P(1, -5), p2: P(1, 5) };
  check('接しているときは、軸で裏返す', samePts(T.flip(tri, A).pts, T.flipAcrossAxis(tri, A).pts));
  check('離れた円は変わらない', JSON.stringify(T.flip(circle, V)) === JSON.stringify(circle));
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
  var v3 = volume(T.flipInPlace(tri), { p1: P(4, -5), p2: P(4, 5) });   // 枠の中央 x = 2.5 で裏返すと、軸 x = 1 は x = 4 に
  check('三角形：裏返しても、軸も一緒なら体積は同じ（円錐）', Math.abs(v3 - v2) / v2 < 1e-6 && Math.abs(v2 - Math.PI * 9 * 4 / 3) / v2 < 0.01,
    v2.toFixed(4) + ' / ' + v3.toFixed(4));
  // 半円を裏返しても、直径が軸なら球のまま
  var axisD = { p1: P(1, -5), p2: P(1, 5) };
  var vs = volume(semi, axisD), vf = volume(T.flip(semi, axisD), axisD);
  check('半円：直径が軸なら、裏返しても球（4/3πr³）', Math.abs(vs - vf) / vs < 1e-6 && Math.abs(vs - 4 / 3 * Math.PI * 8) / vs < 0.01,
    vs.toFixed(4) + ' / ' + vf.toFixed(4));
})();


console.log('フリーハンドの図形');
(function () {
  var fpts = [P(1, 0), P(3, 0), P(4, 1), P(3, 3), P(1, 2)];
  var fh = { type: 'freehand', pts: fpts, corners: [true, false, true, false, true] };
  var c = T.center(fh);
  // 面積の重心（多角形の公式）
  var a = 0, cx = 0, cy = 0;
  for (var i = 0; i < fpts.length; i++) {
    var p = fpts[i], q = fpts[(i + 1) % fpts.length], cr = p.x * q.y - q.x * p.y;
    a += cr; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
  }
  check('中心は面積の重心', near(c, P(cx / (3 * a), cy / (3 * a))));
  var r = T.rotate(fh, 30 * DEG);
  check('回しても辺の長さは同じ・角の印はそのまま', sides(r.pts).every(function (v, k) { return Math.abs(v - sides(fpts)[k]) < 1e-9; }) &&
    JSON.stringify(r.corners) === JSON.stringify(fh.corners));
})();

console.log('\n合格 ' + passed + ' / 不合格 ' + failed);
process.exit(failed ? 1 : 0);
