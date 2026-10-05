/*
 * フリーハンドでかいた線を図形にする計算（freehand.js）のチェック
 * 使い方: node tests/freehand.test.js
 *
 * 作り物の線に、指の震えに見立てたぶれ（細かいぶれ ±2.5px と、ゆるやかなゆれ 1.5px）を加えて確かめる。
 * 乱数は毎回同じ（決まった種）なので、結果も毎回同じ。1ます = 40 ピクセルとして計算する。
 */
'use strict';
var Freehand = require('../js/freehand.js');
var Rev = require('../js/geometry.js');
var Snap = require('../js/snap.js');

var failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  OK  ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { failed++; console.log('  NG  ' + name + (detail ? '  (' + detail + ')' : '')); }
}
function P(x, y) { return { x: x, y: y }; }
var PI = Math.PI, SCALE = 40, PX = 1 / SCALE;

function rng(seed) {   // 決まった種の乱数
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* 線 fn(s)（s は 0〜1）を、約 2.5px おきに点にして、指のぶれを加える */
function stroke(fn, seed, opt) {
  opt = opt || {};
  var r = rng(seed || 1), jit = (opt.jitter === undefined ? 2.5 : opt.jitter) * PX, wob = (opt.wobble === undefined ? 1.5 : opt.wobble) * PX;
  var L = 0, prev = fn(0);
  for (var k = 1; k <= 400; k++) { var q = fn(k / 400); L += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
  var n = Math.max(8, Math.round(L / (2.5 * PX))), ph = r() * 6.28, out = [];
  for (var i = 0; i <= n; i++) {
    var s = i / n, p = fn(s), w = wob * Math.sin(s * L / (30 * PX) + ph);
    out.push(P(p.x + (r() * 2 - 1) * jit + w, p.y + (r() * 2 - 1) * jit + w * 0.6));
  }
  return out;
}
function circlePath(cx, cy, R, a0, a1, rfn) {
  return function (s) { var a = a0 + (a1 - a0) * s, rr = rfn ? rfn(a) : R; return P(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); };
}
function polyPath(corners) {   // 角を通る折れ線（角で向きが変わる）
  var segs = [], L = 0;
  for (var i = 0; i + 1 < corners.length; i++) { var d = Math.hypot(corners[i + 1].x - corners[i].x, corners[i + 1].y - corners[i].y); segs.push(d); L += d; }
  return function (s) {
    var t = s * L;
    for (var i = 0; i < segs.length; i++) {
      if (t <= segs[i] || i === segs.length - 1) { var k = segs[i] ? Math.min(1, t / segs[i]) : 0; return P(corners[i].x + (corners[i + 1].x - corners[i].x) * k, corners[i].y + (corners[i + 1].y - corners[i].y) * k); }
      t -= segs[i];
    }
  };
}
function areaOf(pts) {
  var s = 0;
  for (var i = 0; i < pts.length; i++) { var a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s / 2);
}
function volume(shape, axis) {
  var a = Rev.analyze(shape, axis);
  return Rev.meshVolume(Rev.buildSurface(a).positions);
}
// 図形と軸をまとめて回す（縦の軸 → 横の軸・斜めの軸）
function turn(ang) {
  var c = Math.cos(ang), s = Math.sin(ang);
  return function (p) { return P(p.x * c - p.y * s, p.x * s + p.y * c); };
}
var V = { p1: P(0, -5), p2: P(0, 5) };
var VARIANTS = [['縦の軸', 0], ['横の軸', PI / 2], ['斜めの軸', 0.7]];
function rotAxis(axis, f) { return { p1: f(axis.p1), p2: f(axis.p2) }; }

console.log('閉じ方');
(function () {
  var R = 1.5;
  var res = Freehand.finish(stroke(circlePath(0, 0, R, 0, 2 * PI * 0.92), 11), { axis: null, scale: SCALE });
  check('① 始点の手前で止まる（約30px）→ 閉じる', res.ok && res.closure === 'start', res.closure || res.reason);

  res = Freehand.finish(stroke(circlePath(0, 0, R, 0, 2 * PI * 1.06), 12), { axis: null, scale: SCALE });
  check('② 始点を通り越す → 交わった所で切って閉じる', res.ok && res.closure === 'cross', res.closure || res.reason);
  check('② 切ったあとの形は円に近い（面積）', res.ok && Math.abs(areaOf(res.shape.pts) - PI * R * R) / (PI * R * R) < 0.04,
    res.ok ? areaOf(res.shape.pts).toFixed(3) + ' / ' + (PI * R * R).toFixed(3) : '');

  // かき終わりが、かき始めの線を2か所で横切る線：面積がいちばん大きくなる交わりを選ぶ
  //   かき始め：下の辺 (0,0)→(4,0)。かき終わり：(0,3)→(0.5,−1) で1回、(2.5,−1)→(2.5,0.5) でもう1回横切る
  var twice = stroke(polyPath([P(0, 0), P(4, 0), P(4, 3), P(0, 3), P(0.5, -1), P(2.5, -1), P(2.5, 0.5)]), 13, { jitter: 1, wobble: 0.5 });
  res = Freehand.finish(twice, { axis: null, scale: SCALE });
  // 自分で、かき始め・かき終わりの交わりを全部探して、それぞれで閉じたときの面積を比べる
  var cum = [0]; for (var i = 1; i < twice.length; i++) cum.push(cum[i - 1] + Math.hypot(twice[i].x - twice[i - 1].x, twice[i].y - twice[i - 1].y));
  var Ltot = cum[cum.length - 1], areas = [];
  for (var a = 0; a + 1 < twice.length && cum[a] < 0.3 * Ltot; a++) {
    for (var b = twice.length - 2; b > a + 1 && cum[b + 1] > 0.7 * Ltot; b--) {
      var p = twice[a], q = twice[a + 1], c = twice[b], d = twice[b + 1];
      var den = (q.x - p.x) * (d.y - c.y) - (q.y - p.y) * (d.x - c.x);
      if (Math.abs(den) < 1e-15) continue;
      var t = ((c.x - p.x) * (d.y - c.y) - (c.y - p.y) * (d.x - c.x)) / den, u = ((c.x - p.x) * (q.y - p.y) - (c.y - p.y) * (q.x - p.x)) / den;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
      areas.push(areaOf([P(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t)].concat(twice.slice(a + 1, b + 1))));
    }
  }
  var maxA = Math.max.apply(null, areas), minA = Math.min.apply(null, areas);
  check('② 2か所以上で交わるときは、面積がいちばん大きくなる交わりを選ぶ',
    res.ok && res.closure === 'cross' && areas.length >= 2 && maxA > minA * 1.05 && Math.abs(areaOf(res.shape.pts) - maxA) / maxA < 0.03,
    '交わり ' + areas.length + ' か所、選んだ形 ' + (res.ok ? areaOf(res.shape.pts).toFixed(2) : res.reason) + ' / いちばん大きい ' + maxA.toFixed(2) + ' / いちばん小さい ' + minA.toFixed(2));

  VARIANTS.forEach(function (v) {
    var f = turn(v[1]), ax = rotAxis(V, f);
    // 軸から 8px と 12px の所から、軸の右側に半円に近い弧をかく
    var arc = stroke(circlePath(0, 0, 2, -PI / 2, PI / 2), 21).map(function (p, i, all) {
      if (i === 0) return P(8 * PX, -2); if (i === all.length - 1) return P(12 * PX, 2); return p;
    }).map(f);
    var r = Freehand.finish(arc, { axis: ax, scale: SCALE });
    var onAxis = r.ok ? r.shape.pts.filter(function (p) { return Math.abs(Snap.signedDist(p, ax)) < 1e-9; }).length : 0;
    check('③ 両端が軸の近く（' + v[0] + '）→ 軸に乗せて閉じる', r.ok && r.closure === 'axis' && onAxis >= 2, (r.closure || r.reason) + '、軸の上の点 ' + onAxis);
  });

  res = Freehand.finish(stroke(circlePath(0, 0, R, 0, 2 * PI * 0.6), 31), { axis: null, scale: SCALE });
  check('④ 途中でやめる → 直線で閉じる（直線の両端を返す）', res.ok && res.closure === 'straight' && res.straight && res.straight.length === 2, res.closure || res.reason);
  res = Freehand.finish(stroke(circlePath(3, 0, R, 0, 2 * PI * 0.6), 32), { axis: V, scale: SCALE });
  check('④ 軸があっても、端が軸から遠ければ直線で閉じる', res.ok && res.closure === 'straight', res.closure || res.reason);

  var eight = stroke(function (s) { var a = 2 * PI * s * 0.97; return P(2 * Math.sin(a), 1.2 * Math.sin(2 * a)); }, 41);
  res = Freehand.finish(eight, { axis: null, scale: SCALE });
  check('8の字 → かき直し「線が交わらないようにかこう」', !res.ok && res.reason === 'selfCross' && res.message === Freehand.MSG.selfCross, res.reason);

  res = Freehand.finish(stroke(circlePath(0, 0, 12 * PX, 0, 2 * PI * 0.95), 51, { jitter: 0.8, wobble: 0.3 }), { axis: null, scale: SCALE });
  check('小さすぎる → かき直し「もう少し大きくかこう」', !res.ok && res.reason === 'tooSmall' && res.message === Freehand.MSG.tooSmall, res.reason);
  res = Freehand.finish(stroke(polyPath([P(0, 0), P(4, 0), P(0, 0.05)]), 52, { jitter: 0.5, wobble: 0 }), { axis: null, scale: SCALE });
  check('細すぎる（行って戻るだけ）→ かき直し', !res.ok && (res.reason === 'tooSmall' || res.reason === 'selfCross'), res.reason);
  res = Freehand.finish([P(0, 0), P(2 * PX, 1 * PX), P(4 * PX, 0)], { axis: null, scale: SCALE });
  check('ただのタップ → 何もしない', !res.ok && res.reason === 'tap');
})();

console.log('整え方');
(function () {
  var R = 1.5;
  var res = Freehand.finish(stroke(circlePath(0, 0, R, 0, 2 * PI * 0.95), 61, { jitter: 3, wobble: 2 }), { axis: null, scale: SCALE });
  var radii = res.shape.pts.map(function (p) { return Math.hypot(p.x, p.y); });
  var mean = radii.reduce(function (a, b) { return a + b; }, 0) / radii.length;
  var sd = Math.sqrt(radii.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / radii.length);
  check('点の数は300以下', res.shape.pts.length <= 300, res.shape.pts.length + ' 個');
  check('ぶれた円が、なめらかに整う（半径のばらつきが 1.5px 以下）', sd < 1.5 * PX, 'ばらつき ' + (sd * SCALE).toFixed(2) + 'px');
  check('整えても縮みすぎない（平均の半径が元の円と 2% 以内）', Math.abs(mean - R) / R < 0.02, '平均の半径 ' + mean.toFixed(4) + ' / 元 ' + R);
  check('なめらかな円には角がない', res.shape.corners.filter(Boolean).length === 0, res.shape.corners.filter(Boolean).length + ' 個');

  var rectC = [P(1, -2), P(4, -2), P(4, 2), P(1, 2), P(1, -1.6)];
  res = Freehand.finish(stroke(polyPath(rectC), 62), { axis: null, scale: SCALE });
  var cornerPts = res.ok ? res.shape.pts.filter(function (p, i) { return res.shape.corners[i]; }) : [];
  var found = [P(1, -2), P(4, -2), P(4, 2), P(1, 2)].every(function (c) {
    return cornerPts.some(function (p) { return Math.hypot(p.x - c.x, p.y - c.y) < 10 * PX; });
  });
  check('角を付けた長方形の4つの角が残る（角の印あり、元の角から10px以内）', res.ok && found, cornerPts.length + ' 個の角、点は ' + (res.ok ? res.shape.pts.length : 0) + ' 個');

  var arc = stroke(circlePath(0, 0, 2, -PI / 2, PI / 2), 63);
  arc[0] = P(10 * PX, -2); arc[arc.length - 1] = P(-9 * PX, 2);
  res = Freehand.finish(arc, { axis: V, scale: SCALE });
  var axisPts = res.ok ? res.shape.pts.filter(function (p) { return Math.abs(p.x) < 1e-12; }) : [];
  check('軸で閉じた線の両端は、軸の上にぴったり乗る', res.ok && res.closure === 'axis' && axisPts.length >= 2, axisPts.length + ' 点が軸の上');
})();

console.log('回転体の体積');
VARIANTS.forEach(function (v) {
  var f = turn(v[1]), ax = rotAxis(V, f), ctx = { axis: ax, scale: SCALE };
  function vol(raw, seed) { var r = Freehand.finish(raw.map(f), ctx); return r.ok ? { v: volume(r.shape, ax), closure: r.closure } : { v: NaN, closure: r.reason }; }
  function rel(a, b) { return Math.abs(a - b) / b; }

  var t = vol(stroke(circlePath(4, 0, 1.5, 0, 2 * PI * 0.95), 71));
  var torus = 2 * PI * PI * 4 * 1.5 * 1.5;
  check(v[0] + '：円に近い線（軸から離す）→ ドーナツ形', rel(t.v, torus) < 0.04, t.v.toFixed(2) + ' / 公式 ' + torus.toFixed(2) + '（' + (rel(t.v, torus) * 100).toFixed(1) + '%）');

  var arc = stroke(circlePath(0, 0, 2, -PI / 2, PI / 2), 72);
  arc[0] = P(8 * PX, -2); arc[arc.length - 1] = P(12 * PX, 2);
  var s = vol(arc);
  var sphere = 4 / 3 * PI * 8;
  check(v[0] + '：軸から軸への半円に近い弧 → 球', s.closure === 'axis' && rel(s.v, sphere) < 0.05, s.v.toFixed(2) + ' / 公式 ' + sphere.toFixed(2) + '（' + (rel(s.v, sphere) * 100).toFixed(1) + '%）');

  var c = vol(stroke(polyPath([P(0, -2), P(3, -2), P(3, 2), P(0, 2), P(0, -1.6)]), 73));
  var cyl = PI * 9 * 4;
  check(v[0] + '：角を付けた長方形（1辺を軸に）→ 円柱', rel(c.v, cyl) < 0.05, c.v.toFixed(2) + ' / 公式 ' + cyl.toFixed(2) + '（' + (rel(c.v, cyl) * 100).toFixed(1) + '%）');

  var h = vol(stroke(polyPath([P(1, -2), P(3, -2), P(3, 2), P(1, 2), P(1, -1.6)]), 74));
  var hollow = PI * (9 - 1) * 4;
  check(v[0] + '：軸から離した長方形 → 空洞の円柱', rel(h.v, hollow) < 0.05, h.v.toFixed(2) + ' / 公式 ' + hollow.toFixed(2) + '（' + (rel(h.v, hollow) * 100).toFixed(1) + '%）');
});

/*
 * Safari（iPad）のペンの点をまねる。
 * Apple Pencil は1秒に240回点をとり、ブラウザは1回の動きに数点ずつまとめて渡す（getCoalescedEvents）。
 * Safari は、前の回に渡した点をもう一度混ぜて渡すことがある（A, B, A, C, D, C … のように戻る）。
 *   pts: ほんとうの点の並び、batch: 1回に渡す点の数、repeat: 前の回からもう一度混ぜる点の数
 *   sameTime: true のときは、1回の点の時刻をすべて同じにする（時刻が当てにならない場合）
 * 戻り値: 1回ごとの点の並び [[{ x, y, t }]]
 */
function safariBatches(pts, batch, repeat, sameTime) {
  var out = [], prev = [];
  for (var i = 0; i < pts.length; i += batch) {
    var cur = pts.slice(i, i + batch).map(function (p, k) { return { x: p.x, y: p.y, t: (i + k) * 4.17 }; });
    var T = cur[cur.length - 1].t;
    var ev = prev.slice(Math.max(0, prev.length - repeat)).concat(cur).map(function (q) { return { x: q.x, y: q.y, t: sameTime ? T : q.t }; });
    out.push(ev);
    prev = cur;
  }
  return out;
}
function naiveStream(batches) { return batches.reduce(function (a, b) { return a.concat(b); }, []); }
function acceptedStream(batches) {
  var st = Freehand.newFeed(), out = [];
  batches.forEach(function (b) { out = out.concat(Freehand.acceptPoints(st, b)); });
  return out;
}
function sameSeq(a, b) { return a.length === b.length && a.every(function (p, i) { return p.x === b[i].x && p.y === b[i].y; }); }

console.log('ペンの点の受け取り（Safari の性質）');
(function () {
  // A, B, A, C, D, C の形
  var A = P(0, 0), B = P(1, 0), C = P(2, 0), D = P(3, 0);
  var st = Freehand.newFeed();
  var got = [].concat(
    Freehand.acceptPoints(st, [{ x: A.x, y: A.y, t: 1 }, { x: B.x, y: B.y, t: 2 }]),
    Freehand.acceptPoints(st, [{ x: A.x, y: A.y, t: 1 }, { x: C.x, y: C.y, t: 3 }]),
    Freehand.acceptPoints(st, [{ x: D.x, y: D.y, t: 4 }, { x: C.x, y: C.y, t: 3 }])
  );
  check('A, B, A, C, D, C → A, B, C, D（前の点を捨て、時刻の順に）', sameSeq(got, [A, B, C, D]), JSON.stringify(got));
  var pen = stroke(circlePath(1, 0, 2, PI / 2, PI / 2 - 2 * PI * 0.95), 91, { jitter: 0.6, wobble: 0.8 });
  [[4, 4, false], [6, 3, false], [8, 8, false], [6, 6, true], [8, 2, true]].forEach(function (c) {
    var acc = acceptedStream(safariBatches(pen, c[0], c[1], c[2]));
    check('1回に ' + c[0] + ' 点、前の点を ' + c[1] + ' 点混ぜる' + (c[2] ? '（時刻がすべて同じ）' : '') + '：ほんとうの点の並びにもどる（1点も捨てない）',
      sameSeq(acc, pen), acc.length + ' / ' + pen.length);
  });
  var st2 = Freehand.newFeed();
  var g2 = Freehand.acceptPoints(st2, [{ x: 1, y: 1, t: 0 }, { x: 2, y: 1, t: 0 }, { x: 3, y: 1, t: NaN }]);
  check('時刻が分からない点（0・NaN）も、位置がちがえば使う', g2.length === 3);
})();

console.log('Safari のペンでかいた線が図形になる');
(function () {
  var axisV = { p1: P(0, -5), p2: P(0, 5) };
  var cases = [
    ['円に近い線（始点の近くで止める）', stroke(circlePath(3, 0, 2, PI / 2, PI / 2 - 2 * PI * 0.95), 92, { jitter: 0.8, wobble: 1 }), null, 'start'],
    ['始点を通り越す線', stroke(circlePath(3, 0, 2, PI / 2, PI / 2 - 2 * PI * 1.08), 93, { jitter: 0.8, wobble: 1 }), null, 'cross'],
    ['軸から軸への弧', (function () { var a = stroke(circlePath(0, 0, 2, PI / 2, -PI / 2), 94, { jitter: 0.8, wobble: 1 }); a[0] = P(6 * PX, 2); a[a.length - 1] = P(9 * PX, -2); return a; })(), axisV, 'axis']
  ];
  cases.forEach(function (c) {
    [[6, 3], [8, 8]].forEach(function (b) {
      var bs = safariBatches(c[1], b[0], b[1], false);
      var r1 = Freehand.finish(acceptedStream(bs), { axis: c[2], scale: SCALE });
      check(c[0] + '（1回に ' + b[0] + ' 点・' + b[1] + ' 点混ぜる）：受け取りを通すと図形になる', r1.ok && r1.closure === c[3], r1.ok ? r1.closure : r1.reason);
      var r2 = Freehand.finish(naiveStream(bs), { axis: c[2], scale: SCALE });
      check(c[0] + '（同上）：受け取りを通さなくても、戻りを取り除いて図形になる', r2.ok && r2.closure === c[3], r2.ok ? r2.closure : r2.reason);
    });
  });
})();

console.log('ペンを離すときのはね・小さな戻り');
(function () {
  var base = stroke(circlePath(3, 0, 2, PI / 2, PI / 2 - 2 * PI * 0.95), 95, { jitter: 0.6, wobble: 0.6 });
  var L = base[base.length - 1];
  var loop = base.slice();
  for (var k = 1; k <= 12; k++) { var a = 2 * PI * k / 12; loop.push(P(L.x + 3 * PX * Math.sin(a), L.y + 3 * PX - 3 * PX * Math.cos(a))); }
  var r = Freehand.finish(loop, { axis: null, scale: SCALE });
  check('かき終わりに小さな輪（半径 3px）があっても図形になる', r.ok, r.ok ? r.closure : r.reason);
  var hook = base.slice();
  for (k = 1; k <= 8; k++) hook.push(P(L.x - k * 1.2 * PX, L.y + k * 0.9 * PX));
  for (k = 1; k <= 8; k++) hook.push(P(L.x - (8 - k) * 1.2 * PX + k * 0.15 * PX, L.y + (8 - k) * 0.9 * PX));
  r = Freehand.finish(hook, { axis: null, scale: SCALE });
  check('かき終わりに「はね」（12px 行って戻る）があっても図形になる', r.ok, r.ok ? r.closure : r.reason);
  var spiky = [];
  base.forEach(function (p, i) {
    spiky.push(p);
    if (i % 40 === 20 && i + 5 < base.length) {   // 12px 先まで行って戻る
      var q = base[i + 5], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      spiky.push(P(p.x + dx / d * 12 * PX, p.y + dy / d * 12 * PX), P(p.x + dx / d * 0.5 * PX, p.y + dy / d * 0.5 * PX));
    }
  });
  r = Freehand.finish(spiky, { axis: null, scale: SCALE });
  check('とがった戻り（12px）が何か所もあっても図形になる', r.ok, r.ok ? r.closure : r.reason);
  var eight = []; for (var i = 0; i <= 160; i++) { var t = 2 * PI * i / 160; eight.push(P(2.5 * Math.sin(t), 1.5 * Math.sin(2 * t))); }
  r = Freehand.finish(eight, { axis: null, scale: SCALE });
  check('本当の8の字は、今までどおりかき直し', !r.ok && r.reason === 'selfCross');
  check('かき直しのときは、交わった場所が返される（8の字のまん中の近く）', !r.ok && r.at && Math.hypot(r.at.x, r.at.y) < 0.3, JSON.stringify(r.at));
})();

console.log('将来の補正の差し込み口');
(function () {
  var called = 0;
  Freehand.recognizers.push(function (stroke) { called++; return null; });
  var r = Freehand.finish(stroke(circlePath(0, 0, 1.5, 0, 2 * PI * 0.95), 81), { axis: null, scale: SCALE });
  Freehand.recognizers.pop();
  check('Freehand.recognizers に加えた判定が、指を離した後に呼ばれる（今は空）', called === 1 && r.ok && Freehand.recognizers.length === 0);
})();

console.log('\n合格 ' + passed + ' / 不合格 ' + failed);
process.exit(failed ? 1 : 0);
