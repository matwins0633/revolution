/*
 * 回転体の数学部分
 *
 * 平面図形（多角形または円）と回転の軸から、回転体の表面（三角形の集まり）をつくる。
 * 考え方：図形の輪郭を軸のまわりに1周させると、回転体の表面になる。
 *
 * 座標の決め方：
 *   軸上の点 A、軸の向き u（長さ1）、平面内で軸に垂直な向き n（長さ1、図形がある側）をとり、
 *   平面上の点 P を  t = (P - A)・u （軸に沿った位置）
 *                   r = (P - A)・n （軸からの距離）
 *   で表す。回転角 θ のときの空間の点は
 *     A + t u + r (cosθ n + sinθ e)    （e = u × n、紙面に垂直な向き）
 *
 * three.js には依存しないので、Node でもテストできる。
 */
(function (root) {
  'use strict';

  var EPS = 1e-9;
  var CIRCLE_SAMPLES = 64;   // 円の輪郭を何個の点で近似するか
  var SEGMENTS = 96;         // 1周を何等分して回すか

  var MSG_INSIDE = '軸が図形の中を通っています。図形の外か、辺の上に軸を引いてください';

  function signedArea(pts) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  /* 軸の2点から、A・u・n・e を求める。2点が同じなら null。 */
  function axisFrame(axis) {
    var dx = axis.p2.x - axis.p1.x, dy = axis.p2.y - axis.p1.y;
    var len = Math.hypot(dx, dy);
    if (len < EPS) return null;
    var u = { x: dx / len, y: dy / len };
    return { A: { x: axis.p1.x, y: axis.p1.y }, u: u, n: { x: -u.y, y: u.x } };
  }

  function toTR(frame, p) {
    var px = p.x - frame.A.x, py = p.y - frame.A.y;
    return [px * frame.u.x + py * frame.u.y, px * frame.n.x + py * frame.n.y];
  }

  /*
   * 図形と軸を調べ、回転体をつくれるか判定して、輪郭（部品の集まり）を返す。
   *   shape: { type: 'polygon', pts: [{x,y}, ...] }  または { type: 'circle', c: {x,y}, r }
   *   axis:  { p1: {x,y}, p2: {x,y} }
   * 戻り値: { ok: true, frame, pieces: [{ pts: [[t,r],...], nrm: [[nt,nr],...] }] }
   *         { ok: false, reason: 'noShape' | 'noAxis' | 'inside', message }
   */
  function analyze(shape, axis) {
    if (!shape) return { ok: false, reason: 'noShape', message: '先に図形を置いてください。' };
    if (!axis) return { ok: false, reason: 'noAxis', message: '先に「軸を引く」で軸を引いてください。' };
    var f = axisFrame(axis);
    if (!f) return { ok: false, reason: 'noAxis', message: '軸の2つの点がかさなっています。軸を引き直してください。' };

    var pieces = [];

    if (shape.type === 'circle') {
      var c = toTR(f, shape.c);
      var d = c[1];
      // 中心から軸までの距離が半径より短い → 軸が円の内部を通る（接する場合は可）
      if (Math.abs(d) < shape.r - EPS) return { ok: false, reason: 'inside', message: MSG_INSIDE };
      if (d < 0) flipSide(f);
      c = toTR(f, shape.c);
      var pts = [], nrm = [];
      for (var i = 0; i <= CIRCLE_SAMPLES; i++) {
        var a = (i % CIRCLE_SAMPLES) / CIRCLE_SAMPLES * Math.PI * 2;
        var ca = Math.cos(a), sa = Math.sin(a);
        pts.push([c[0] + shape.r * ca, Math.max(0, c[1] + shape.r * sa)]);
        nrm.push([ca, sa]);   // 円の外向きの法線
      }
      pieces.push({ pts: pts, nrm: nrm });
    } else {
      var tr = shape.pts.map(function (p) { return toTR(f, p); });
      var maxR = -Infinity, minR = Infinity;
      tr.forEach(function (q) { maxR = Math.max(maxR, q[1]); minR = Math.min(minR, q[1]); });
      // 頂点が軸の両側にある → 軸が図形の内部を通る
      // （多角形は頂点を囲む範囲に入っているので、頂点を調べれば十分）
      if (maxR > EPS && minR < -EPS) return { ok: false, reason: 'inside', message: MSG_INSIDE };
      if (maxR <= EPS) {
        flipSide(f);
        tr = shape.pts.map(function (p) { return toTR(f, p); });
      }
      tr = tr.map(function (q) { return [q[0], Math.abs(q[1]) < EPS ? 0 : q[1]]; });
      // (t, r) 平面で反時計回りにそろえると、各辺の外向き法線が (dr, -dt) になる
      if (signedArea(tr) < 0) tr.reverse();
      for (var k = 0; k < tr.length; k++) {
        var p = tr[k], q = tr[(k + 1) % tr.length];
        if (p[1] === 0 && q[1] === 0) continue;   // 軸の上の辺は回しても面にならない
        var dt = q[0] - p[0], dr = q[1] - p[1];
        var len = Math.hypot(dt, dr);
        if (len < EPS) continue;
        var nv = [dr / len, -dt / len];
        pieces.push({ pts: [p, q], nrm: [nv, nv] });
      }
    }

    f.e = { x: 0, y: 0, z: f.u.x * f.n.y - f.u.y * f.n.x };   // u × n
    return { ok: true, frame: f, pieces: pieces };
  }

  function flipSide(f) { f.n = { x: -f.n.x, y: -f.n.y }; }

  /* (t, r, θ) → 空間の点 [x, y, z] */
  function point3(f, t, r, cos, sin) {
    return [
      f.A.x + t * f.u.x + r * (cos * f.n.x),
      f.A.y + t * f.u.y + r * (cos * f.n.y),
      r * sin * f.e.z
    ];
  }

  /* 法線 (nt, nr) を角度 θ だけ回したもの */
  function normal3(f, nt, nr, cos, sin) {
    return [
      nt * f.u.x + nr * cos * f.n.x,
      nt * f.u.y + nr * cos * f.n.y,
      nr * sin * f.e.z
    ];
  }

  /*
   * 回転体の表面を三角形の集まりにする。
   * 頂点は「回転角の区切り（全 segments 個）」の順に並ぶので、
   * 先頭から k × vertsPerSegment 個だけ描けば、角度 2π × k / segments まで回した跡になる。
   */
  function buildSurface(analysis, segments) {
    segments = segments || SEGMENTS;
    var f = analysis.frame;
    var perSeg = 0;
    analysis.pieces.forEach(function (pc) { perSeg += (pc.pts.length - 1) * 6; });
    var positions = new Float32Array(perSeg * segments * 3);
    var normals = new Float32Array(perSeg * segments * 3);
    var w = 0;

    var cosT = [], sinT = [];
    for (var j = 0; j <= segments; j++) {
      var th = (j % segments) / segments * Math.PI * 2;
      cosT.push(Math.cos(th));
      sinT.push(Math.sin(th));
    }

    function put(v) {
      positions[w] = v.p[0]; positions[w + 1] = v.p[1]; positions[w + 2] = v.p[2];
      normals[w] = v.n[0]; normals[w + 1] = v.n[1]; normals[w + 2] = v.n[2];
      w += 3;
    }
    // 三角形の向き（表と裏）を法線の向きにそろえて書きこむ
    function tri(a, b, c) {
      var ux = b.p[0] - a.p[0], uy = b.p[1] - a.p[1], uz = b.p[2] - a.p[2];
      var vx = c.p[0] - a.p[0], vy = c.p[1] - a.p[1], vz = c.p[2] - a.p[2];
      var cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      var nx = a.n[0] + b.n[0] + c.n[0], ny = a.n[1] + b.n[1] + c.n[1], nz = a.n[2] + b.n[2] + c.n[2];
      if (cx * nx + cy * ny + cz * nz < 0) { var tmp = b; b = c; c = tmp; }
      put(a); put(b); put(c);
    }
    function vert(pc, i, j) {
      var t = pc.pts[i][0], r = pc.pts[i][1];
      return {
        p: point3(f, t, r, cosT[j], sinT[j]),
        n: normal3(f, pc.nrm[i][0], pc.nrm[i][1], cosT[j], sinT[j])
      };
    }

    for (var s = 0; s < segments; s++) {
      analysis.pieces.forEach(function (pc) {
        for (var i = 0; i < pc.pts.length - 1; i++) {
          var a = vert(pc, i, s), b = vert(pc, i + 1, s);
          var c = vert(pc, i + 1, s + 1), d = vert(pc, i, s + 1);
          tri(a, b, c);
          tri(a, c, d);
        }
      });
    }
    return { positions: positions, normals: normals, vertsPerSegment: perSeg, segments: segments };
  }

  /* 三角形の集まり（閉じた面）が囲む体積。表面が外向きなら正の値になる。 */
  function meshVolume(positions) {
    var v = 0;
    for (var i = 0; i < positions.length; i += 9) {
      var ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
      var bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
      var cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
  }

  var Rev = {
    EPS: EPS,
    SEGMENTS: SEGMENTS,
    MSG_INSIDE: MSG_INSIDE,
    axisFrame: axisFrame,
    analyze: analyze,
    buildSurface: buildSurface,
    meshVolume: meshVolume,
    signedArea: signedArea
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Rev;
  else root.Rev = Rev;
})(this);
