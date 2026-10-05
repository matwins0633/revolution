/*
 * フリーハンドでかいた線を、図形にする計算
 *
 * 指（ペン）を離したときに Freehand.finish(かいた点, ctx) を呼ぶと、次の順に処理する。
 *   1. 下ごしらえ     … ほぼ同じ位置の点を除く。短すぎる線（ただのタップ）は何もしない
 *   2. 閉じ方を決める … ① 終点が始点の近く ② かき始めとかき終わりが交わる ③ 両端が軸の近く ④ 直線で結ぶ
 *   3. 点をならべ直す … ほぼ等間隔に
 *   4. 整える         … 角を見つけ、角と角の間だけ指の震えをならす（形が縮まないならし方）
 *   5. 補正の差し込み口 … Freehand.recognizers（今は空。将来「三角形・円などにきれいに補正」を加える所）
 *   6. 点を間引く     … 形を保ったまま、多くても MAX_POINTS 個に。角の点は残す
 *   7. かき直しの判定 … 小さすぎる、線が交わる、細すぎる
 * 距離の値は、画面上のピクセルで決めておき、ctx.scale（1ますのピクセル）で方眼の長さに直す。
 * 画面には依存しないので、Node でもテストできる。
 *
 * ctx = { axis: 軸 または null, scale: 1ますのピクセル }
 */
(function (root) {
  'use strict';

  var Snap = root.Snap || (typeof require !== 'undefined' ? require('./snap.js') : null);

  /* 調整しやすい値（ここだけを変えればよい） */
  var CONFIG = {
    MIN_STROKE_PX: 12,          // これより短い線は、ただのタップとみなして何もしない
    DEDUP_PX: 1,                // これより近い点は1つにまとめる
    CLOSE_PX: 36,               // ① 終点が始点からこの距離以内なら閉じる（指の太さを考えて広め）
    HEAD_TAIL_FRACTION: 0.3,    // ② 交わりを探す「かき始め」「かき終わり」の長さ（線全体に対する割合）
    AXIS_PX: 20,                // ③ 両端が軸からこの距離以内なら、軸に乗せて閉じる（吸い付きと同じ）
    RESAMPLE_PX: 3,             // 点をならべ直す間隔
    CORNER_ANGLE_DEG: 55,       // 向きがこれ以上変わる所を「角」として残す
    CORNER_REACH_PX: 14,        // 角を調べるときに、前後に見る長さ
    CORNER_PROBE_PASSES: 2,     // 角を探す前に、軽くならす回数
    SMOOTH_PASSES: 20,          // ぶれをならす回数
    SMOOTH_LAMBDA: 0.5,         // ならす強さ（少し縮める）
    SMOOTH_MU: -0.53,           //            （同じくらい少しふくらませる → 形が縮まない）
    SIMPLIFY_PX: 0.5,           // 点を間引くときに許すずれ
    MAX_POINTS: 300,            // 点の数の上限（回転体の計算と3Dの表示が重くならないように）
    MIN_SIZE_PX: 30,            // 縦も横もこれより小さい形は「もう少し大きくかこう」
    MIN_AREA_PX: 1200,          // これより面積が小さい形も同じ（約35px 四方）
    MIN_ROUNDNESS: 0.06,        // 丸さの目安（4π×面積÷周の長さ²。円は1）がこれより小さい細い形も同じ
    STRAIGHT_FLASH_MS: 4000     // ④ 直線で閉じたとき、その直線を目立たせておく時間（画面側で使う）
  };

  var MSG = {
    selfCross: '線が交わらないようにかこう。',
    tooSmall: 'もう少し大きくかこう。'
  };

  function P(x, y) { return { x: x, y: y }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function area(pts) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  function perimeter(pts) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]);
    return s;
  }

  /* 線分 ab と cd の交わる点（端どうしで触れるだけのときは null） */
  function segmentCross(a, b, c, d) {
    var rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    var den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-15) return null;
    var t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
    var u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
    return { p: P(a.x + rx * t, a.y + ry * t), t: t, u: u };
  }

  /* ---------- 1. 下ごしらえ ---------- */

  function dedup(pts, minD) {
    var out = [];
    pts.forEach(function (p) {
      if (!out.length || dist(out[out.length - 1], p) >= minD) out.push(P(p.x, p.y));
    });
    return out;
  }

  function cumulative(pts) {
    var c = [0];
    for (var i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));
    return c;
  }

  /* ---------- 2. 閉じ方を決める ---------- */

  /*
   * かき始めの部分とかき終わりの部分の交わりで閉じる（②）。
   * 2か所以上で交わるときは、閉じた形の面積がいちばん大きくなる交わりを選ぶ。
   */
  function closeAtCrossing(pts, cum) {
    var L = cum[cum.length - 1], head = L * CONFIG.HEAD_TAIL_FRACTION, tail = L * (1 - CONFIG.HEAD_TAIL_FRACTION);
    var best = null;
    for (var i = 0; i + 1 < pts.length && cum[i] < head; i++) {
      for (var j = pts.length - 2; j > i + 1 && cum[j + 1] > tail; j--) {
        var x = segmentCross(pts[i], pts[i + 1], pts[j], pts[j + 1]);
        if (!x) continue;
        var poly = [x.p].concat(pts.slice(i + 1, j + 1));
        var a = Math.abs(area(poly));
        if (!best || a > best.area) best = { poly: poly, area: a };
      }
    }
    return best;
  }

  /*
   * ③のとき、線の両端を整える（軸から AXIS_PX 以内の、端のあたりだけを見る）。
   *   ・指のぶれで軸をこえていたら、いちばん内側でこえた所で切る（軸の上の点になる）
   *   ・こえていなければ、軸にいちばん近づいた所までにして、その先の短い端は捨てる
   * そのままだと、端から軸へ下ろす短い線が、軸の近くを通る線と重なって交わってしまうため。
   * 図形の本体がある側は、軸からいちばん遠い点の側とする。
   */
  function trimAtAxis(pts, axis, zone) {
    var r = pts.map(function (p) { return Snap.signedDist(p, axis); });
    var far = 0;
    r.forEach(function (v, i) { if (Math.abs(v) > Math.abs(r[far])) far = i; });
    var side = r[far] >= 0 ? 1 : -1;
    function d(i) { return side * r[i]; }   // 本体の側にどれだけ離れているか
    function cut(i, j) {                    // 線分 i–j と軸の交わる点
      var k = r[i] / (r[i] - r[j]);
      return P(pts[i].x + (pts[j].x - pts[i].x) * k, pts[i].y + (pts[j].y - pts[i].y) * k);
    }
    // かき始めの側
    var i, a = -1, m = 0;
    for (i = 0; i < far && Math.abs(r[i]) <= zone; i++) {
      if (d(i) <= 0) a = i;
      if (d(i) < d(m)) m = i;
    }
    var head, from;
    if (a >= 0) { head = cut(a, a + 1); from = a + 1; } else { head = pts[m]; from = m + 1; }
    // かき終わりの側
    var b = -1, e = pts.length - 1;
    for (i = pts.length - 1; i > far && Math.abs(r[i]) <= zone; i--) {
      if (d(i) <= 0) b = i;
      if (d(i) < d(e)) e = i;
    }
    var tail, to;
    if (b >= 0) { tail = cut(b, b - 1); to = b - 1; } else { tail = pts[e]; to = e - 1; }
    return [head].concat(pts.slice(from, to + 1), [tail]);
  }

  function closeStroke(pts, ctx) {
    var u = 1 / ctx.scale;   // 1ピクセルの方眼の長さ
    var cum = cumulative(pts);
    var start = pts[0], end = pts[pts.length - 1];
    var crossing = closeAtCrossing(pts, cum);
    // ② 交わり（始点の近くで止めたつもりが、少し通り越して交わった場合も、こちらを使う）
    if (crossing) return { poly: crossing.poly, fixed: [], closure: 'cross' };
    // ① 終点が始点の近く
    if (dist(start, end) <= CONFIG.CLOSE_PX * u) return { poly: pts.slice(), fixed: [], closure: 'start' };
    // ③ 両端が軸の近く → 両端を軸の上に乗せて、軸に沿った線で閉じる
    if (ctx.axis) {
      var ds = Math.abs(Snap.signedDist(start, ctx.axis)), de = Math.abs(Snap.signedDist(end, ctx.axis));
      if (ds <= CONFIG.AXIS_PX * u && de <= CONFIG.AXIS_PX * u) {
        var body = trimAtAxis(pts, ctx.axis, CONFIG.AXIS_PX * u);
        var fs = Snap.footOnAxis(body[0], ctx.axis), fe = Snap.footOnAxis(body[body.length - 1], ctx.axis);
        if (dist(body[0], fs) < 1e-9) body.shift();
        if (dist(body[body.length - 1], fe) < 1e-9) body.pop();
        var poly = [fs].concat(body, [fe]);
        return { poly: poly, fixed: [0, poly.length - 1], closure: 'axis' };
      }
    }
    // ④ 終点から始点へ直線で
    return { poly: pts.slice(), fixed: [0, pts.length - 1], closure: 'straight', straight: [P(end.x, end.y), P(start.x, start.y)] };
  }

  /* ---------- 3. 点をならべ直す（閉じた形。fixed の点は位置を変えずに残す） ---------- */

  function resampleChain(chain, step) {
    var cum = cumulative(chain), L = cum[cum.length - 1];
    var n = Math.max(1, Math.round(L / step)), out = [], k = 0;
    for (var s = 0; s <= n; s++) {
      var target = L * s / n;
      while (k < chain.length - 2 && cum[k + 1] < target) k++;
      var seg = cum[k + 1] - cum[k], t = seg > 0 ? (target - cum[k]) / seg : 0;
      out.push(P(chain[k].x + (chain[k + 1].x - chain[k].x) * t, chain[k].y + (chain[k + 1].y - chain[k].y) * t));
    }
    out[0] = P(chain[0].x, chain[0].y);
    out[out.length - 1] = P(chain[chain.length - 1].x, chain[chain.length - 1].y);
    return out;
  }

  function resample(poly, fixedIdx, step) {
    var n = poly.length;
    var anchors = fixedIdx.length ? fixedIdx.slice().sort(function (a, b) { return a - b; }) : [0];
    var pts = [], fixed = [];
    for (var a = 0; a < anchors.length; a++) {
      var from = anchors[a], to = anchors[(a + 1) % anchors.length];
      var chain = [];
      for (var i = from; ; i = (i + 1) % n) {
        chain.push(poly[i]);
        if (chain.length > 1 && i === to) break;
        if (chain.length > n + 1) break;
      }
      var r = resampleChain(chain, step);
      r.pop();   // 終わりの点は、次の区間の始めの点と同じ
      r.forEach(function (p, k) { pts.push(p); fixed.push(k === 0 && fixedIdx.length > 0); });
    }
    return { pts: pts, fixed: fixed };
  }

  /* ---------- 4. 整える ---------- */

  /* 角を見つける：前後に reach だけ離れた点との向きの変わり方が大きく、そこがいちばん強く曲がっている所 */
  function detectCorners(pts, fixed, reach) {
    var n = pts.length, ang = [], i;
    var limit = CONFIG.CORNER_ANGLE_DEG * Math.PI / 180;
    function walk(i, dir) {
      var d = 0, k = i;
      for (var c = 0; c < n - 1; c++) {
        var nk = (k + dir + n) % n;
        d += dist(pts[k], pts[nk]);
        k = nk;
        if (d >= reach) break;
      }
      return pts[k];
    }
    for (i = 0; i < n; i++) {
      var b = walk(i, -1), f = walk(i, 1), p = pts[i];
      var v1x = p.x - b.x, v1y = p.y - b.y, v2x = f.x - p.x, v2y = f.y - p.y;
      var l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      ang.push(l1 > 0 && l2 > 0 ? Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))) : 0);
    }
    var step = n > 1 ? perimeter(pts) / n : 1;
    var k = Math.max(1, Math.round(reach / step));
    var corners = [];
    for (i = 0; i < n; i++) {
      var isMax = ang[i] >= limit;
      for (var j = 1; j <= k && isMax; j++) {
        if (ang[(i + j) % n] > ang[i] || ang[(i - j + n) % n] > ang[i]) isMax = false;
      }
      corners.push(fixed[i] || isMax);
    }
    return corners;
  }

  /*
   * ぶれをならす（角の点は動かさない）。
   * 少し縮める（λ）→ 同じくらい少しふくらませる（μ）を交互にくり返すので、形が内側に縮まない。
   * 平均はとなりの点との組み合わせなので、まっすぐ並んだ点（軸の上の線など）はまっすぐのまま。
   */
  function smooth(pts, corners, passes) {
    var n = pts.length;
    if (passes === undefined) passes = CONFIG.SMOOTH_PASSES;
    function step(w) {
      var next = pts.map(function (p, i) {
        if (corners[i]) return p;
        var a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
        return P(p.x + w * ((a.x + b.x) / 2 - p.x), p.y + w * ((a.y + b.y) / 2 - p.y));
      });
      pts = next;
    }
    for (var s = 0; s < passes; s++) {
      step(CONFIG.SMOOTH_LAMBDA);
      step(CONFIG.SMOOTH_MU);
    }
    return pts;
  }

  /* ---------- 6. 点を間引く（角の点は残す） ---------- */

  function rdp(chain, eps) {
    if (chain.length < 3) return chain.slice();
    var a = chain[0], b = chain[chain.length - 1], best = -1, bestD = -1;
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    for (var i = 1; i < chain.length - 1; i++) {
      var d = len > 0 ? Math.abs((chain[i].x - a.x) * dy - (chain[i].y - a.y) * dx) / len : dist(chain[i], a);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (bestD <= eps) return [a, b];
    var left = rdp(chain.slice(0, best + 1), eps), right = rdp(chain.slice(best), eps);
    return left.slice(0, -1).concat(right);
  }

  function simplifyOnce(pts, corners, eps) {
    var n = pts.length, anchors = [];
    corners.forEach(function (c, i) { if (c) anchors.push(i); });
    if (anchors.length === 0) anchors.push(0);
    if (anchors.length === 1) {   // 区切りが1つしかないときは、いちばん遠い点も区切りにする
      var far = 0, fd = -1;
      pts.forEach(function (p, i) { var d = dist(p, pts[anchors[0]]); if (d > fd) { fd = d; far = i; } });
      anchors.push(far);
      anchors.sort(function (a, b) { return a - b; });
    }
    var out = [], outC = [];
    for (var a = 0; a < anchors.length; a++) {
      var from = anchors[a], to = anchors[(a + 1) % anchors.length], chain = [];
      for (var i = from; ; i = (i + 1) % n) {
        chain.push({ p: pts[i], c: corners[i] });
        if (chain.length > 1 && i === to) break;
      }
      var kept = rdp(chain.map(function (q) { return q.p; }), eps);
      kept.pop();
      kept.forEach(function (p, k) {
        out.push(p);
        outC.push(k === 0 ? corners[from] : false);
      });
    }
    return { pts: out, corners: outC };
  }

  function simplify(pts, corners, eps) {
    var r = simplifyOnce(pts, corners, eps);
    while (r.pts.length > CONFIG.MAX_POINTS) {
      eps *= 1.4;
      r = simplifyOnce(pts, corners, eps);
    }
    return r;
  }

  /* ---------- 7. かき直しの判定 ---------- */

  function selfCrossing(pts) {
    var n = pts.length;
    for (var i = 0; i < n; i++) {
      for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;   // となりどうしの辺
        if (segmentCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
      }
    }
    return false;
  }

  /* ---------- まとめ ---------- */

  /*
   * 指を離したときの処理。
   * 戻り値
   *   { ok: true, shape: { type: 'freehand', pts, corners }, closure: 'start'|'cross'|'axis'|'straight', straight: [点, 点] }
   *   { ok: false, reason: 'tap' }（何もしない） / { ok: false, reason: 'selfCross'|'tooSmall', message }
   */
  function finish(raw, ctx) {
    var u = 1 / ctx.scale;
    var pts = dedup(raw, CONFIG.DEDUP_PX * u);
    if (pts.length < 3 || cumulative(pts)[pts.length - 1] < CONFIG.MIN_STROKE_PX * u) return { ok: false, reason: 'tap' };

    var closed = closeStroke(pts, ctx);
    var rs = resample(closed.poly, closed.fixed, CONFIG.RESAMPLE_PX * u);
    // 角は、軽くならした線で探す（強いぶれを角とまちがえないように）
    var probe = smooth(rs.pts, rs.fixed, CONFIG.CORNER_PROBE_PASSES);
    var corners = detectCorners(probe, rs.fixed, CONFIG.CORNER_REACH_PX * u);
    var smoothed = smooth(rs.pts, corners);

    var shaped = null;
    for (var r = 0; r < Freehand.recognizers.length && !shaped; r++) {   // 5. 将来の補正の差し込み口
      shaped = Freehand.recognizers[r]({ pts: smoothed, corners: corners, closure: closed.closure }, ctx);
    }
    var simple = shaped || simplify(smoothed, corners, CONFIG.SIMPLIFY_PX * u);

    // 7. かき直しの判定：全体が小さすぎる → 線が交わる → 面積が小さい・細すぎる の順
    //   （8の字は、交わった2つの輪の面積が打ち消し合うので、面積より先に交わりを調べる）
    var tooSmall = { ok: false, reason: 'tooSmall', message: MSG.tooSmall };
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    simple.pts.forEach(function (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    if (simple.pts.length < 3 || Math.max(maxX - minX, maxY - minY) * ctx.scale < CONFIG.MIN_SIZE_PX) return tooSmall;
    if (selfCrossing(simple.pts)) return { ok: false, reason: 'selfCross', message: MSG.selfCross };
    var a = Math.abs(area(simple.pts)), per = perimeter(simple.pts);
    var areaPx = a * ctx.scale * ctx.scale, roundness = per > 0 ? 4 * Math.PI * a / (per * per) : 0;
    if (areaPx < CONFIG.MIN_AREA_PX || roundness < CONFIG.MIN_ROUNDNESS) return tooSmall;

    return {
      ok: true,
      shape: { type: 'freehand', pts: simple.pts, corners: simple.corners },
      closure: closed.closure,
      straight: closed.straight || null
    };
  }

  var Freehand = {
    CONFIG: CONFIG,
    MSG: MSG,
    finish: finish,
    // 将来の補正（三角形・円などにきれいに整える）を入れる一覧。
    // 各要素は function ({ pts, corners, closure }, ctx) → { pts, corners }（補正しないときは null）
    recognizers: [],
    // テスト用
    closeStroke: closeStroke,
    detectCorners: detectCorners,
    selfCrossing: selfCrossing
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Freehand;
  else root.Freehand = Freehand;
})(this);
