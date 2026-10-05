/*
 * 回転体の数学部分
 *
 * 平面図形（多角形・円・半円）と回転の軸から、回転体の表面（三角形の集まり）をつくる。
 *
 * 考え方：
 *   回転体は「図形のうち軸の片側の部分」と「反対側の部分を軸で折り返したもの」を重ねた形
 *   （重なった部分は1つにまとめる）を、軸のまわりに1周させたものになる。
 *   その形の輪郭を1周させると、回転体の表面になる。軸の上にある輪郭は、回しても面にならない。
 *   軸をまたがない図形では、折り返す部分がないので、図形の輪郭をそのまま回すことになる。
 *
 * 座標の決め方：
 *   軸上の点 A、軸の向き u（長さ1）、平面内で軸に垂直な向き n（長さ1）をとり、
 *   平面上の点 P を  t = (P - A)・u （軸に沿った位置）
 *                   r = (P - A)・n （軸からの距離。軸のどちら側かで符号がつく）
 *   で表す。折り返した形では ρ = |r| を使う。回転角 θ のときの空間の点は
 *     A + t u + ρ (cosθ n + sinθ e)    （e = u × n、紙面に垂直な向き）
 *
 * three.js には依存しないので、Node でもテストできる。
 */
(function (root) {
  'use strict';

  var EPS = 1e-9;
  var CIRCLE_SAMPLES = 128;  // 円の輪郭を何個の点で近似するか
  var ARC_SAMPLES = 64;      // 半円の弧を何等分するか
  var SEGMENTS = 96;         // 1周を何等分して回すか

  var MSG_INSIDE = '軸が図形の中を通っています。図形の外か、辺の上に軸を引いてください';

  function P(x, y) { return { x: x, y: y }; }

  function signedArea(pts) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  /* 軸の2点から、A・u・n を求める。2点が同じなら null。 */
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

  /* 向き（法線）を (t, r) の成分に */
  function dirTR(frame, v) {
    return [v.x * frame.u.x + v.y * frame.u.y, v.x * frame.n.x + v.y * frame.n.y];
  }

  /* (t, ρ) → 元の平面の点（折り返した形を作図の画面に表示するため） */
  function toWorld(frame, t, rho) {
    return P(frame.A.x + frame.u.x * t + frame.n.x * rho, frame.A.y + frame.u.y * t + frame.n.y * rho);
  }

  /*
   * 図形の輪郭を、辺の列にする。
   *   円は細かい多角形、半円は直径と細かく分けた弧。
   * 戻り値 { pts: [{x,y}, ...], edges: [{ a, b, na, nb }] }
   *   na・nb は辺の両端での外向きの向き（長さ1）。まっすぐな辺では両端とも同じ、弧では中心から外向き。
   */
  function outline(shape) {
    var pts = [], vn = [], curved = [];   // vn: 弧の上の点での外向きの向き
    var i;
    if (shape.type === 'circle') {
      for (i = 0; i < CIRCLE_SAMPLES; i++) {
        var a = i / CIRCLE_SAMPLES * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        pts.push(P(shape.c.x + shape.r * ca, shape.c.y + shape.r * sa));
        vn.push(P(ca, sa));
        curved.push(true);
      }
    } else if (shape.type === 'semicircle') {
      var g = semicircleGeom(shape);
      pts.push(g.p1, g.p2);
      vn.push(P(-g.d.x, -g.d.y), P(g.d.x, g.d.y));
      curved.push(false, true);           // 直径（まっすぐ）、弧のはじまり
      for (i = 1; i < ARC_SAMPLES; i++) {
        var psi = i / ARC_SAMPLES * Math.PI, cp = Math.cos(psi), sp = Math.sin(psi);
        var nx = cp * g.d.x + sp * g.s.x, ny = cp * g.d.y + sp * g.s.y;
        pts.push(P(g.m.x + g.R * nx, g.m.y + g.R * ny));
        vn.push(P(nx, ny));
        curved.push(true);
      }
    } else {
      shape.pts.forEach(function (p) { pts.push(P(p.x, p.y)); vn.push(null); curved.push(false); });
    }

    var ccw = signedArea(pts.map(function (p) { return [p.x, p.y]; })) > 0;
    var edges = [];
    for (i = 0; i < pts.length; i++) {
      var j = (i + 1) % pts.length, p = pts[i], q = pts[j];
      if (curved[i]) {
        edges.push({ a: p, b: q, na: vn[i], nb: vn[j] });
      } else {
        var dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
        var n = ccw ? P(dy / len, -dx / len) : P(-dy / len, dx / len);
        edges.push({ a: p, b: q, na: n, nb: n });
      }
    }
    return { pts: pts, edges: edges };
  }

  /* 半円：直径の両端 p1, p2 と、弧の側 side（+1 なら p1→p2 の左側） */
  function semicircleGeom(shape) {
    var p1 = shape.pts[0], p2 = shape.pts[1];
    var R = Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2;
    var d = P((p2.x - p1.x) / (2 * R), (p2.y - p1.y) / (2 * R));
    var side = shape.side || 1;
    return { p1: p1, p2: p2, R: R, d: d, m: P((p1.x + p2.x) / 2, (p1.y + p2.y) / 2), s: P(-d.y * side, d.x * side) };
  }

  /*
   * 図形が軸のどちら側にあるか。
   *   'pos'   … 全部が n の側（軸の上の点をふくむ）
   *   'neg'   … 全部が n の反対側
   *   'cross' … 軸が図形の内部を通る（軸をまたぐ）
   * 「軸が図形の中を通る」かどうかの判定は、この関数だけで行う。
   */
  function axisSide(shape, f) {
    if (shape.type === 'circle') {
      var d = toTR(f, shape.c)[1];
      // 中心から軸までの距離が半径より短い → 軸が円の内部を通る（接する場合は可）
      if (Math.abs(d) < shape.r - EPS) return 'cross';
      return d < 0 ? 'neg' : 'pos';
    }
    var maxR = -Infinity, minR = Infinity;
    outline(shape).pts.forEach(function (p) {
      var r = toTR(f, p)[1];
      maxR = Math.max(maxR, r); minR = Math.min(minR, r);
    });
    // 頂点が軸の両側にある → 軸が図形の内部を通る
    // （図形は頂点を囲む範囲に入っているので、頂点を調べれば十分）
    if (maxR > EPS && minR < -EPS) return 'cross';
    return maxR <= EPS ? 'neg' : 'pos';
  }

  /* 軸の n の側にある部分の面積 − 反対側にある部分の面積 */
  function sideAreaBalance(pts, f) {
    var tr = pts.map(function (p) { return toTR(f, p); });
    function clipArea(sign) {
      var out = [];
      for (var i = 0; i < tr.length; i++) {
        var a = tr[i], b = tr[(i + 1) % tr.length];
        var ia = sign * a[1] >= 0, ib = sign * b[1] >= 0;
        if (ia) out.push(a);
        if (ia !== ib) {
          var k = a[1] / (a[1] - b[1]);
          out.push([a[0] + (b[0] - a[0]) * k, 0]);
        }
      }
      return out.length > 2 ? Math.abs(signedArea(out)) : 0;
    }
    return clipArea(1) - clipArea(-1);
  }

  /*
   * 折り返して重ねた形の輪郭を求める。
   *   edges: (t, r) で表した図形の辺 [{ a:[t,r], b:[t,r], na:[nt,nr], nb:[nt,nr] }]
   * 戻り値: 輪郭の線分の集まり [{ pts: [[t,ρ],[t,ρ]], nrm: [[nt,nρ],[nt,nρ]] }]（ρ ≥ 0、軸の上の線分はふくまない）
   *
   * 方法：t の範囲を細切れにする。区切りは「頂点」「辺が軸を横切る所」「折り返した辺どうしが交わる所」。
   * 細切れの中では辺の並び順が変わらないので、まん中の t で断面を調べれば、
   * どの辺が「折り返して重ねた形」の上の端・下の端になるかが決まる。
   */
  function foldProfile(edges) {
    var E = [];
    edges.forEach(function (e, id) {
      var a = e.a, b = e.b, na = e.na, nb = e.nb;
      if (Math.abs(b[0] - a[0]) < EPS) return;   // t の向きに垂直な辺は、細切れの境目の縦の線として扱う
      if (b[0] < a[0]) { var tp = a; a = b; b = tp; tp = na; na = nb; nb = tp; }
      E.push({ id: id, t0: a[0], t1: b[0], r0: a[1], r1: b[1], na: na, nb: nb });
    });
    function rAt(e, t) { return e.r0 + (e.r1 - e.r0) * (t - e.t0) / (e.t1 - e.t0); }
    function rhoAt(e, t) { return e ? Math.abs(rAt(e, t)) : 0; }
    function nAt(e, t, sign) {   // 辺の上の位置 t での外向きの向き（折り返した側では r 成分を反転）
      var k = (t - e.t0) / (e.t1 - e.t0);
      var nt = e.na[0] + (e.nb[0] - e.na[0]) * k, nr = e.na[1] + (e.nb[1] - e.na[1]) * k;
      var len = Math.hypot(nt, nr) || 1;
      return [nt / len, sign * nr / len];
    }

    // 区切りの位置
    var T = [];
    edges.forEach(function (e) { T.push(e.a[0], e.b[0]); });
    E.forEach(function (e) {
      if (e.r0 * e.r1 < 0) T.push(e.t0 + (e.t1 - e.t0) * e.r0 / (e.r0 - e.r1));
    });
    for (var i = 0; i < E.length; i++) {
      for (var j = i + 1; j < E.length; j++) {
        var lo = Math.max(E[i].t0, E[j].t0), hi = Math.min(E[i].t1, E[j].t1);
        if (hi - lo <= EPS) continue;
        [1, -1].forEach(function (sg) {   // r_i = r_j と r_i = −r_j（折り返して交わる）
          var fl = rAt(E[i], lo) - sg * rAt(E[j], lo), fh = rAt(E[i], hi) - sg * rAt(E[j], hi);
          if (fl * fh < 0) T.push(lo + (hi - lo) * fl / (fl - fh));
        });
      }
    }
    T.sort(function (a, b) { return a - b; });

    // 細切れごとの断面（折り返して重ねたもの）
    var slabs = [];
    for (var k = 0; k + 1 < T.length; k++) {
      var tA = T[k], tB = T[k + 1];
      if (tB - tA < 1e-9) continue;
      var tm = (tA + tB) / 2;
      var xs = E.filter(function (e) { return e.t0 <= tA + 1e-12 && e.t1 >= tB - 1e-12; })
        .map(function (e) { return { e: e, r: rAt(e, tm) }; })
        .sort(function (a, b) { return a.r - b.r; });
      var iv = [];
      for (var q = 0; q + 1 < xs.length; q += 2) {   // 下から2つずつ組にすると、図形の内側の区間になる
        var a = xs[q], b = xs[q + 1];
        if (a.r >= 0) iv.push({ lo: a.e, hi: b.e, loV: a.r, hiV: b.r });
        else if (b.r <= 0) iv.push({ lo: b.e, hi: a.e, loV: -b.r, hiV: -a.r });
        else iv.push({ lo: null, hi: -a.r > b.r ? a.e : b.e, loV: 0, hiV: Math.max(-a.r, b.r) });
      }
      iv.sort(function (a, b) { return a.loV - b.loV; });
      var merged = [];
      iv.forEach(function (x) {   // 重なった区間は1つにまとめる
        var last = merged[merged.length - 1];
        if (last && x.loV <= last.hiV + 1e-12) {
          if (x.hiV > last.hiV) { last.hi = x.hi; last.hiV = x.hiV; }
        } else {
          merged.push({ lo: x.lo, hi: x.hi, loV: x.loV, hiV: x.hiV });
        }
      });
      slabs.push({ tA: tA, tB: tB, tm: tm, iv: merged });
    }

    var pieces = [];
    var open = {}, openEnd = null;   // 1つ前の細切れから続いている線分（同じ辺ならつなげる）
    function addEdgePiece(e, role, slab, nextOpen) {
      var sign = rAt(e, slab.tm) < 0 ? -1 : 1;
      var pA = [slab.tA, rhoAt(e, slab.tA)], pB = [slab.tB, rhoAt(e, slab.tB)];
      if (pA[1] < EPS && pB[1] < EPS) return;   // 軸の上の線分は面にならない
      var nA = nAt(e, slab.tA, sign), nB = nAt(e, slab.tB, sign);
      var key = e.id + role + sign;
      var prev = open[key];
      if (prev && Math.abs(prev.pts[1][0] - pA[0]) < 1e-9 && Math.abs(prev.pts[1][1] - pA[1]) < 1e-9) {
        prev.pts[1] = pB; prev.nrm[1] = nB;
        nextOpen[key] = prev;
      } else {
        var pc = { pts: [pA, pB], nrm: [nA, nB] };
        pieces.push(pc);
        nextOpen[key] = pc;
      }
    }
    function sectionAt(slab, t) {
      return slab ? slab.iv.map(function (x) { return [rhoAt(x.lo, t), rhoAt(x.hi, t)]; }) : [];
    }
    function subtract(X, Y) {   // 区間の集まり X から Y を取り除く
      var out = [];
      X.forEach(function (x) {
        var segs = [x];
        Y.forEach(function (y) {
          var next = [];
          segs.forEach(function (s) {
            if (y[1] <= s[0] || y[0] >= s[1]) { next.push(s); return; }
            if (y[0] > s[0]) next.push([s[0], y[0]]);
            if (y[1] < s[1]) next.push([y[1], s[1]]);
          });
          segs = next;
        });
        out = out.concat(segs);
      });
      return out;
    }
    function addCaps(t, left, right) {   // 細切れの境目の縦の線
      subtract(right, left).forEach(function (s) {
        if (s[1] - s[0] > 1e-9) pieces.push({ pts: [[t, s[0]], [t, s[1]]], nrm: [[-1, 0], [-1, 0]] });
      });
      subtract(left, right).forEach(function (s) {
        if (s[1] - s[0] > 1e-9) pieces.push({ pts: [[t, s[0]], [t, s[1]]], nrm: [[1, 0], [1, 0]] });
      });
    }

    var prevSlab = null;
    slabs.forEach(function (slab) {
      var joined = prevSlab && Math.abs(prevSlab.tB - slab.tA) < 1e-6;
      if (joined) {
        addCaps(slab.tA, sectionAt(prevSlab, slab.tA), sectionAt(slab, slab.tA));
      } else {
        if (prevSlab) addCaps(prevSlab.tB, sectionAt(prevSlab, prevSlab.tB), []);
        addCaps(slab.tA, [], sectionAt(slab, slab.tA));
        open = {};
      }
      var nextOpen = {};
      slab.iv.forEach(function (x) {
        addEdgePiece(x.hi, 'hi', slab, nextOpen);
        if (x.lo) addEdgePiece(x.lo, 'lo', slab, nextOpen);
      });
      open = nextOpen;
      prevSlab = slab;
    });
    if (prevSlab) addCaps(prevSlab.tB, sectionAt(prevSlab, prevSlab.tB), []);
    return pieces;
  }

  /*
   * 図形と軸を調べ、回転体の輪郭（折り返して重ねた形の輪郭）を返す。
   *   shape: { type: 'polygon', pts } / { type: 'circle', c, r } / { type: 'semicircle', pts: [p1, p2], side }
   *   axis:  { p1: {x,y}, p2: {x,y} }
   * 戻り値: { ok: true, frame, pieces: [{ pts: [[t,ρ],...], nrm: [[nt,nρ],...] }], crossing }
   *         { ok: false, reason: 'noShape' | 'noAxis' | 'inside', message }
   */
  function analyze(shape, axis) {
    if (!shape) return { ok: false, reason: 'noShape', message: '先に図形を置いてください。' };
    if (!axis) return { ok: false, reason: 'noAxis', message: '先に「軸を引く」で軸を引いてください。' };
    var f = axisFrame(axis);
    if (!f) return { ok: false, reason: 'noAxis', message: '軸の2つの点がかさなっています。軸を引き直してください。' };

    var side = axisSide(shape, f);
    if (side === 'cross' && !Rev.ALLOW_AXIS_CROSSING) return { ok: false, reason: 'inside', message: MSG_INSIDE };
    var ol = outline(shape);
    // 図形（軸をまたぐときは面積の大きい側）を n の向きにそろえる
    if (side === 'neg' || (side === 'cross' && sideAreaBalance(ol.pts, f) < 0)) flipSide(f);

    var edges = ol.edges.map(function (e) {
      return { a: toTR(f, e.a), b: toTR(f, e.b), na: dirTR(f, e.na), nb: dirTR(f, e.nb) };
    });
    var pieces = foldProfile(edges);

    f.e = { x: 0, y: 0, z: f.u.x * f.n.y - f.u.y * f.n.x };   // u × n
    return { ok: true, frame: f, pieces: pieces, crossing: side === 'cross' };
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
    // 軸が図形の内部を通る（軸をまたぐ）図形も回転させる（false にすると、第2版までと同じくエラーにする）
    ALLOW_AXIS_CROSSING: true,
    EPS: EPS,
    SEGMENTS: SEGMENTS,
    MSG_INSIDE: MSG_INSIDE,
    axisFrame: axisFrame,
    axisSide: axisSide,
    outline: outline,
    foldProfile: foldProfile,
    toWorld: toWorld,
    analyze: analyze,
    buildSurface: buildSurface,
    meshVolume: meshVolume,
    signedArea: signedArea
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Rev;
  else root.Rev = Rev;
})(this);
