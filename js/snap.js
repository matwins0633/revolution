/*
 * 吸い付き（スナップ）の計算
 *
 * 図形の点を「軸」や「方眼の交点」にぴったり合わせるための計算だけをまとめたもの。
 * 画面には依存しないので、Node でもテストできる。座標はすべて方眼の座標（1ます = 1）。
 *
 * ctx（呼び出し側から渡す情報）
 *   axis          : 軸 { p1, p2 }。ないときは null（方眼の交点にだけ吸い付く）
 *   scale         : 1ますが画面上で何ピクセルか（吸い付く距離をピクセルで決めるため）
 *   gridSnap(p)   : 方眼の交点への吸い付き（省略時は四捨五入）
 *   inBounds(p)   : 画面の中に入っているか（省略時は常に true）
 *   maxR          : 円の半径の上限
 *   allowCrossing : 軸が図形の中を通ってもよいか（true なら円の半径の点が軸の上をすべる）
 */
(function (root) {
  'use strict';

  var SNAP_PX = 20;          // 軸に吸い付く距離（画面上のピクセル）
  var GRID_ON_AXIS_PX = 12;  // 軸の上で、方眼の交点に吸い付く距離（画面上のピクセル）
  var MIN_R = 0.5;           // 円の半径の最小値
  var ON_EPS = 1e-6;         // 「ぴったり合っている」とみなす誤差

  function P(x, y) { return { x: x, y: y }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /* 軸の向き u（長さ1）と、それに垂直な向き n */
  function frame(axis) {
    var dx = axis.p2.x - axis.p1.x, dy = axis.p2.y - axis.p1.y, len = Math.hypot(dx, dy);
    if (len < 1e-12) return null;
    var u = P(dx / len, dy / len);
    return { A: axis.p1, u: u, n: P(-u.y, u.x) };
  }

  /* 軸の上で、点 p にいちばん近い点 */
  function footOnAxis(p, axis) {
    var f = frame(axis);
    var t = (p.x - f.A.x) * f.u.x + (p.y - f.A.y) * f.u.y;
    return P(f.A.x + f.u.x * t, f.A.y + f.u.y * t);
  }

  /* 点 p と軸の距離（軸のどちら側かで符号がつく） */
  function signedDist(p, axis) {
    var f = frame(axis);
    return (p.x - f.A.x) * f.n.x + (p.y - f.A.y) * f.n.y;
  }

  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

  /* 軸の上にある方眼の交点のうち、p（を軸に下ろした点）にいちばん近いもの */
  function latticeOnAxisNear(p, axis) {
    var x1 = axis.p1.x, y1 = axis.p1.y, dx = axis.p2.x - x1, dy = axis.p2.y - y1;
    if (![x1, y1, dx, dy].every(Number.isInteger)) return null;
    var g = gcd(Math.abs(dx), Math.abs(dy));
    var sx = dx / g, sy = dy / g;   // 交点から次の交点までのずれ
    var k = Math.round(((p.x - x1) * sx + (p.y - y1) * sy) / (sx * sx + sy * sy));
    return P(x1 + k * sx, y1 + k * sy);
  }

  function isOnAxis(p, axis) { return !!axis && Math.abs(signedDist(p, axis)) < ON_EPS; }

  /* 円が軸に接しているか */
  function isTangent(circle, axis) {
    return !!axis && Math.abs(Math.abs(signedDist(circle.c, axis)) - circle.r) < ON_EPS;
  }

  function gridSnap(p, ctx) { return ctx.gridSnap ? ctx.gridSnap(p) : P(Math.round(p.x), Math.round(p.y)); }
  function inBounds(p, ctx) { return ctx.inBounds ? ctx.inBounds(p) : true; }

  /*
   * 頂点の吸い付き
   *   軸から SNAP_PX 以内 → 軸の上（軸の上の方眼の交点が近ければ、その交点を優先）
   *   それ以外           → 方眼の交点
   * 戻り値 { p, onAxis }
   */
  function snapVertex(raw, ctx) {
    if (ctx.axis) {
      var foot = footOnAxis(raw, ctx.axis);
      if (dist(raw, foot) * ctx.scale <= SNAP_PX) {
        var lat = latticeOnAxisNear(raw, ctx.axis);
        if (lat && dist(foot, lat) * ctx.scale <= GRID_ON_AXIS_PX && inBounds(lat, ctx)) return { p: lat, onAxis: true };
        if (inBounds(foot, ctx)) return { p: foot, onAxis: true };
      }
    }
    return { p: gridSnap(raw, ctx), onAxis: false };
  }

  /*
   * 図形全体の平行移動での吸い付き
   *   ずらした頂点のうち、軸にいちばん近く SNAP_PX 以内のものを軸の上に乗せ、全体を同じだけずらす。
   * 戻り値 { pts, snappedIndex }。吸い付かないときは null（呼び出し側で今までどおり動かす）。
   */
  function snapTranslation(origPts, rawOffset, ctx) {
    if (!ctx.axis) return null;
    var best = -1, bestD = SNAP_PX;
    origPts.forEach(function (p, i) {
      var d = Math.abs(signedDist(P(p.x + rawOffset.x, p.y + rawOffset.y), ctx.axis)) * ctx.scale;
      if (d <= bestD) { bestD = d; best = i; }
    });
    if (best < 0) return null;
    var o = origPts[best];
    var sv = snapVertex(P(o.x + rawOffset.x, o.y + rawOffset.y), ctx);
    if (!sv.onAxis) return null;
    var dx = sv.p.x - o.x, dy = sv.p.y - o.y;
    var pts = origPts.map(function (p) { return P(p.x + dx, p.y + dy); });
    if (!pts.every(function (p) { return inBounds(p, ctx); })) return null;
    pts[best] = sv.p;   // 吸い付いた頂点は、計算の誤差なく軸の上に
    return { pts: pts, snappedIndex: best };
  }

  /*
   * 曲線の図形（フリーハンド）全体の平行移動での吸い付き
   *   ずらした図形の、軸にいちばん近い所（軸の片側にあれば軸側の端、少し軸をこえていれば
   *   いちばん深い所）が SNAP_PX 以内なら、軸に垂直な向きにだけずらして、図形が軸にぴったり接する位置にする。
   * 戻り値 { pts, contact（接する点） }。吸い付かないときは null。
   */
  function snapTranslationTouch(origPts, rawOffset, ctx) {
    if (!ctx.axis) return null;
    var f = frame(ctx.axis);
    var moved = origPts.map(function (p) { return P(p.x + rawOffset.x, p.y + rawOffset.y); });
    var minR = Infinity, maxR = -Infinity, iMin = -1, iMax = -1;
    moved.forEach(function (p, i) {
      var r = signedDist(p, ctx.axis);
      if (r < minR) { minR = r; iMin = i; }
      if (r > maxR) { maxR = r; iMax = i; }
    });
    // 軸の n の側に接する（いちばん低い所を軸に）か、反対側に接する（いちばん高い所を軸に）か、ずらす量が小さい方
    var cand = Math.abs(minR) <= Math.abs(maxR) ? { shift: -minR, idx: iMin } : { shift: -maxR, idx: iMax };
    if (Math.abs(cand.shift) * ctx.scale > SNAP_PX) return null;
    var pts = moved.map(function (p) { return P(p.x + f.n.x * cand.shift, p.y + f.n.y * cand.shift); });
    if (!pts.every(function (p) { return inBounds(p, ctx); })) return null;
    return { pts: pts, contact: footOnAxis(pts[cand.idx], ctx.axis) };
  }

  /*
   * 円の半径の点が吸い付く先（軸の上の特別な点）の一覧。
   *   接点（中心から軸に下ろした垂線の足。円が軸に接する位置）と、
   *   near が渡されたときは、その近くにある軸上の方眼の交点。
   */
  function radiusTargetsOnAxis(circle, ctx, near) {
    var list = [{ p: footOnAxis(circle.c, ctx.axis), kind: 'tangent' }];
    if (near) {
      var lat = latticeOnAxisNear(near, ctx.axis);
      if (lat) list.push({ p: lat, kind: 'grid' });
    }
    return list;
  }

  /* 半径の点が軸に吸い付いたとき、軸の上のどこに置くか */
  function radiusPositionOnAxis(raw, circle, ctx) {
    var foot = footOnAxis(raw, ctx.axis);
    var targets = radiusTargetsOnAxis(circle, ctx, foot);
    if (!ctx.allowCrossing) return targets[0];   // 軸をまたげないときは、必ず接点
    // 軸の上をすべり、近くに吸い付く先（接点を優先）があればそこに
    var best = { p: foot, kind: 'slide' }, bestD = GRID_ON_AXIS_PX + 1e-9;
    targets.forEach(function (tg) {   // 同じ近さなら、先にある接点を選ぶ
      var d = dist(foot, tg.p) * ctx.scale;
      if (d < bestD) { bestD = d; best = tg; }
    });
    return best;
  }

  /*
   * 円の半径の点の吸い付き
   *   ふつう：中心のまわりにどの向きにも動かせる。半径は 0.5 ます刻み。
   *   軸から SNAP_PX 以内：軸の上に吸い付く（今は接点。円が軸に接する）
   * 戻り値 { r, a（半径の点の向き）, onAxis, target }
   */
  function snapRadiusHandle(raw, circle, ctx) {
    var c = circle.c, maxR = ctx.maxR || Infinity;
    if (ctx.axis && Math.abs(signedDist(raw, ctx.axis)) * ctx.scale <= SNAP_PX) {
      var pos = radiusPositionOnAxis(raw, circle, ctx);
      var r = dist(pos.p, c);
      if (r >= MIN_R && r <= maxR) {
        return { r: r, a: Math.atan2(pos.p.y - c.y, pos.p.x - c.x), onAxis: true, target: pos.kind };
      }
    }
    var d = dist(raw, c);
    return {
      r: Math.max(MIN_R, Math.min(maxR, Math.round(d * 2) / 2)),
      a: d > 1e-9 ? Math.atan2(raw.y - c.y, raw.x - c.x) : (circle.a || 0),
      onAxis: false,
      target: null
    };
  }

  /*
   * 円の中心の吸い付き（中心のドラッグ・円全体の平行移動）
   *   中心が軸から SNAP_PX 以内 → 中心を軸の上に（回すと球）
   *   円が軸に接する位置から SNAP_PX 以内 → 接する位置に（接したまま軸に沿ってすべる）
   *   両方にあてはまるときは近い方。
   * 戻り値 { c, kind: 'center' | 'tangent' }。吸い付かないときは null。
   */
  function snapCircleCenter(rawC, r, ctx) {
    if (!ctx.axis) return null;
    var s = signedDist(rawC, ctx.axis);
    var dCenter = Math.abs(s) * ctx.scale, dTangent = Math.abs(Math.abs(s) - r) * ctx.scale;
    if (Math.min(dCenter, dTangent) > SNAP_PX) return null;
    var f = frame(ctx.axis), side = s >= 0 ? 1 : -1;
    var foot = footOnAxis(rawC, ctx.axis);
    var lat = latticeOnAxisNear(rawC, ctx.axis);
    if (lat && dist(foot, lat) * ctx.scale <= GRID_ON_AXIS_PX) foot = lat;
    var off = dCenter <= dTangent ? 0 : r;
    var c = P(foot.x + f.n.x * side * off, foot.y + f.n.y * side * off);
    if (!inBounds(c, ctx)) return null;
    return { c: c, kind: off === 0 ? 'center' : 'tangent' };
  }

  var Snap = {
    SNAP_PX: SNAP_PX,
    GRID_ON_AXIS_PX: GRID_ON_AXIS_PX,
    footOnAxis: footOnAxis,
    signedDist: signedDist,
    latticeOnAxisNear: latticeOnAxisNear,
    isOnAxis: isOnAxis,
    isTangent: isTangent,
    snapVertex: snapVertex,
    snapTranslation: snapTranslation,
    snapTranslationTouch: snapTranslationTouch,
    radiusTargetsOnAxis: radiusTargetsOnAxis,
    snapRadiusHandle: snapRadiusHandle,
    snapCircleCenter: snapCircleCenter
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Snap;
  else root.Snap = Snap;
})(this);
