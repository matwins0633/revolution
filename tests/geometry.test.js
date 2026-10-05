/*
 * 回転体の数学部分のチェック
 * 使い方: node tests/geometry.test.js
 *
 * つくった立体の体積を、教科書の公式（円柱・円錐・ドーナツ形・空洞の円柱）と比べる。
 * 体積が合っていて正の値なら、形が正しく、表面の向き（外向き）も正しい。
 */
'use strict';
var Rev = require('../js/geometry.js');

var failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  OK  ' + name); }
  else { failed++; console.log('  NG  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

function P(x, y) { return { x: x, y: y }; }
function poly() { return { type: 'polygon', pts: Array.prototype.slice.call(arguments) }; }
function axis(x1, y1, x2, y2) { return { p1: P(x1, y1), p2: P(x2, y2) }; }

// 平面上の図形と軸を、まとめて回転・平行移動する（斜めの軸のテスト用）
function moved(shape, ax, angle, dx, dy) {
  var c = Math.cos(angle), s = Math.sin(angle);
  function m(p) { return P(p.x * c - p.y * s + dx, p.x * s + p.y * c + dy); }
  var sh = shape.type === 'circle'
    ? { type: 'circle', c: m(shape.c), r: shape.r }
    : { type: 'polygon', pts: shape.pts.map(m) };
  return { shape: sh, axis: { p1: m(ax.p1), p2: m(ax.p2) } };
}

function volumeOf(shape, ax) {
  var a = Rev.analyze(shape, ax);
  if (!a.ok) return { error: a.reason };
  return { v: Rev.meshVolume(Rev.buildSurface(a).positions) };
}

function expectVolume(name, shape, ax, expected) {
  var variants = [
    ['', shape, ax],
    ['（軸の向きを逆）', shape, { p1: ax.p2, p2: ax.p1 }]
  ];
  [[Math.PI / 2, 1, -2], [0.7, -3, 1.5], [Math.PI, 0, 0]].forEach(function (m, i) {
    var mv = moved(shape, ax, m[0], m[1], m[2]);
    variants.push(['（全体を回転・移動 ' + (i + 1) + '）', mv.shape, mv.axis]);
  });
  variants.forEach(function (vr) {
    var res = volumeOf(vr[1], vr[2]);
    if (res.error) { check(name + vr[0], false, 'エラー: ' + res.error); return; }
    var rel = Math.abs(res.v - expected) / expected;
    check(name + vr[0], res.v > 0 && rel < 0.01,
      '体積 ' + res.v.toFixed(4) + ' / 公式 ' + expected.toFixed(4));
  });
}

var PI = Math.PI;

console.log('体積が公式と合うか');
// 長方形（横3・縦4）の左の辺を軸 → 円柱 半径3 高さ4
expectVolume('円柱（長方形の1辺が軸）', poly(P(0, 0), P(3, 0), P(3, 4), P(0, 4)), axis(0, -1, 0, 5), PI * 9 * 4);
// 同じ長方形の下の辺を軸（横向きの軸）→ 円柱 半径4 高さ3
expectVolume('円柱（横の軸）', poly(P(0, 0), P(3, 0), P(3, 4), P(0, 4)), axis(-2, 0, 6, 0), PI * 16 * 3);
// 直角三角形（直角をはさむ辺 3 と 4）、縦の辺を軸 → 円錐 半径3 高さ4
expectVolume('円錐（直角をはさむ辺が軸）', poly(P(0, 0), P(3, 0), P(0, 4)), axis(0, 0, 0, 1), PI * 9 * 4 / 3);
// 円 半径1、中心が軸から3 → ドーナツ形 2π²Rr²
expectVolume('ドーナツ形（円を軸から離す）', { type: 'circle', c: P(3, 1), r: 1 }, axis(0, 0, 0, 2), 2 * PI * PI * 3 * 1);
// 長方形 x:2〜5, y:0〜4 を軸 x=0 → 空洞の円柱 π(5²−2²)×4
expectVolume('空洞の円柱（長方形を軸から離す）', poly(P(2, 0), P(5, 0), P(5, 4), P(2, 4)), axis(0, 0, 0, 1), PI * (25 - 4) * 4);
// 軸が図形の左側にあっても同じ（図形が軸の負の側）
expectVolume('空洞の円柱（図形が軸の反対側）', poly(P(-2, 0), P(-5, 0), P(-5, 4), P(-2, 4)), axis(0, 0, 0, 1), PI * (25 - 4) * 4);
// 円が軸に接する → 穴のないドーナツ形
expectVolume('円が軸に接する', { type: 'circle', c: P(2, 0), r: 2 }, axis(0, -5, 0, 5), 2 * PI * PI * 2 * 4);
// 斜辺が軸 → 円錐2つ（底面の半径 = 高さ 12/5, 合計の高さ 5）
expectVolume('直角三角形の斜辺が軸', poly(P(0, 0), P(3, 0), P(0, 4)), axis(3, 0, 0, 4), PI * (12 / 5) * (12 / 5) * 5 / 3);
// 頂点だけ軸にふれる三角形（パップスの定理: 2π × 重心までの距離 × 面積）
expectVolume('頂点が軸の上', poly(P(0, 0), P(4, 1), P(2, 3)), axis(0, -1, 0, 1), 2 * PI * 2 * 5);
// へこんだ四角形（パップスの定理）
(function () {
  var pts = [P(1, 0), P(5, 0), P(2, 1), P(1, 4)];
  var area = 0, cx = 0;
  for (var i = 0; i < 4; i++) {
    var a = pts[i], b = pts[(i + 1) % 4], cr = a.x * b.y - b.x * a.y;
    area += cr; cx += (a.x + b.x) * cr;
  }
  area /= 2; cx /= 6 * area;
  expectVolume('へこんだ四角形', { type: 'polygon', pts: pts }, axis(0, 0, 0, 1), 2 * PI * cx * Math.abs(area));
})();

console.log('軸が図形の中を通るときはエラーになるか');
function expectInside(name, shape, ax) {
  var a = Rev.analyze(shape, ax);
  check(name, !a.ok && a.reason === 'inside' && a.message === Rev.MSG_INSIDE, a.ok ? 'エラーにならなかった' : a.reason);
}
expectInside('長方形の真ん中を通る軸', poly(P(0, 0), P(4, 0), P(4, 4), P(0, 4)), axis(2, -1, 2, 5));
expectInside('長方形の対角線', poly(P(0, 0), P(4, 0), P(4, 4), P(0, 4)), axis(0, 0, 4, 4));
expectInside('三角形の頂点と内部を通る軸', poly(P(0, 0), P(4, 0), P(0, 4)), axis(0, 0, 1, 1));
expectInside('円の中心を通る軸', { type: 'circle', c: P(0, 0), r: 2 }, axis(0, -5, 0, 5));
expectInside('円の中心から少しずれた軸', { type: 'circle', c: P(0, 0), r: 2 }, axis(1.5, -5, 1.5, 5));

console.log('その他');
check('図形がないとき', Rev.analyze(null, axis(0, 0, 0, 1)).reason === 'noShape');
check('軸がないとき', Rev.analyze(poly(P(0, 0), P(1, 0), P(0, 1)), null).reason === 'noAxis');
check('軸の2点が同じとき', Rev.analyze(poly(P(0, 0), P(1, 0), P(0, 1)), axis(1, 1, 1, 1)).reason === 'noAxis');
(function () {
  var a = Rev.analyze(poly(P(0, 0), P(3, 0), P(3, 4), P(0, 4)), axis(0, 0, 0, 1));
  var s = Rev.buildSurface(a);
  check('軸の上の辺は面にしない（部品は3つ）', a.pieces.length === 3);
  check('角度ごとに頂点が並ぶ', s.positions.length / 3 === s.vertsPerSegment * s.segments);
  var finite = true;
  for (var i = 0; i < s.positions.length; i++) if (!isFinite(s.positions[i]) || !isFinite(s.normals[i])) finite = false;
  check('数値がすべて正常', finite);
})();

console.log('\n合格 ' + passed + ' / 不合格 ' + failed);
process.exit(failed ? 1 : 0);
