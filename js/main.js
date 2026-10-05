/*
 * ボタン・案内の文・手順の列と、左右の表示をつなぐ部分
 *
 * 手順は ①図形をえらぶ → ②軸をひく → ③形や位置を変えてみる ⇄ ④回転体をつくる。
 * ③と④は何度もくり返して試す流れなので、終わった印は付けず、今やると良い段階だけをそっと強調する。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var rail = $('rail');
  var guideEl = document.querySelector('.guide');
  var messageEl = $('message');
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var angle = $('angle'), angleOut = $('angle-out');

  var phase = 'idle';        // 'idle' | 'rotating'（アニメーション中）| 'done'（できた）| 'error'
  var errorText = '';
  var lastCrossing = false;  // 最後につくった立体の図形が、軸をまたいでいたか
  var hasMade = false;       // 一度でも回転体をつくったか
  var notice = null;         // フリーハンドでかいた直後の知らせ（次に何か変わるまで出す）{ text, kind }

  /* フリーハンドでかいた線の閉じ方ごとの知らせ */
  var CLOSURE_TEXT = {
    start: '図形ができました。',
    cross: 'はみ出した線を切って閉じました。',
    axis: '線の両はしを軸に乗せて、軸と線で囲みました。',
    straight: 'まっすぐな線で閉じました。ちがうときは「元に戻す」でかき直そう。'
  };
  function closureText(closure) {
    if (closure === 'straight') return CLOSURE_TEXT.straight;
    return CLOSURE_TEXT[closure] + (editor.axis ? '④「回転体をつくる」を押そう。' : '②「軸をひく」を押して、軸をひこう。');
  }

  function say(text, kind) {
    messageEl.textContent = text;
    guideEl.dataset.kind = kind || '';
  }

  var view = new View3D($('view3d'), {
    onFinish: function () { phase = 'done'; refresh(); },
    onProgress: function (p) {
      var deg = Math.round(p * 360);
      angle.value = deg;
      angleOut.textContent = deg + '°';
    }
  });

  var editor = new Editor2D($('canvas2d'), {
    onChange: function () {
      view.setScene(editor.shape, editor.axis);   // 図形や軸が変わったら、できていた立体は消える
      phase = 'idle';
      notice = null;
      refresh();
    },
    onModeChange: function () { notice = null; refresh(); },
    onHistory: function () { refresh(); },
    onDrawResult: function (res) {
      notice = res.ok
        ? { text: closureText(res.closure), kind: res.closure === 'straight' ? 'draw' : '' }
        : { text: res.message, kind: 'error' };
      refresh();
    }
  });

  /* 次にすることを案内する（案内の欄は3行まで） */
  function guide(hasSolid) {
    if (notice) return say(notice.text, notice.kind);
    if (editor.mode === 'draw') return say('指やペンで、図形のまわりをぐるっとかこう。かき始めの○にもどると閉じます。', 'draw');
    if (editor.mode === 'axis1') return say('軸を通したい所を、指でなぞろう。2か所をタップしてもひけます。', 'active');
    if (editor.mode === 'axis2') return say('軸が通る2つ目の点をタップしよう。', 'active');
    if (phase === 'error') return say(errorText, 'error');
    if (!editor.shape) return say('① 左の「三角形」などを押して、図形を置こう。');
    if (!editor.axis) return say('② 「軸をひく」を押して、方眼の上を指でなぞろう。');
    if (phase === 'rotating') return say('図形が軸のまわりを1周しています…');
    if (phase === 'done' && hasSolid) {
      return say(lastCrossing
        ? 'できあがり！ 反対側は折り返して重なります。③ 形や軸を変えて、もう一度つくろう。'
        : 'できあがり！ ③ 形や軸の位置を変えて、もう一度つくってみよう。', 'done');
    }
    if (editor.isCrossing()) return say('軸が図形の中を通っています。「折り返しを見る」で、反対側の重なり方を見てみよう。', 'info');
    if (editor.snapState().fit) return say('緑の●は、軸にぴったり合っています。④「回転体をつくる」を押そう。', 'fit');
    if (hasMade) return say('④「回転体をつくる」で、どう変わったか確かめよう。');
    return say('④「回転体をつくる」を押そう。③のように、形や位置を変えてからでもOK。');
  }

  /* 今やると良い段階 */
  function currentStep(hasSolid) {
    if (!editor.shape || editor.mode === 'draw') return 1;
    if (!editor.axis || editor.mode !== 'edit') return 2;
    return hasSolid ? 3 : 4;
  }

  function refresh() {
    var hasSolid = view.hasSolid();
    var cur = currentStep(hasSolid);
    steps.forEach(function (li) { li.classList.toggle('is-current', Number(li.dataset.step) === cur); });
    rail.classList.toggle('loop-on', cur === 3);
    rail.dataset.current = String(cur);

    var axisMode = editor.mode === 'axis1' || editor.mode === 'axis2';
    $('btn-axis').setAttribute('aria-pressed', axisMode ? 'true' : 'false');
    $('btn-draw').setAttribute('aria-pressed', editor.mode === 'draw' ? 'true' : 'false');
    $('draw-label').textContent = editor.shape && editor.shape.type === 'freehand' ? 'フリーハンドでかき直す' : 'フリーハンドでかく';
    $('btn-undo').disabled = !editor.canUndo();
    $('btn-replay').disabled = !hasSolid;
    $('placeholder3d').hidden = hasSolid;
    $('placeholder3d').classList.toggle('compact', !!(editor.shape || editor.axis));
    angle.disabled = !hasSolid;
    if (!hasSolid) {
      angle.value = 0;
      angleOut.textContent = '0°';
    }
    $('fold-switch').hidden = !editor.isCrossing();
    guide(hasSolid);
  }

  /*
   * ボタンを押したときの動き。
   * 指・ペンでは、離したときにすぐ動かす（すばやいドラッグの直後のタップが、ブラウザによっては
   * 「クリック」にならずに消えることがあるため）。マウスとキーボードは、ふつうのクリックで動かす。
   */
  function onPress(el, fn) {
    var pressed = false, lastTouch = 0;
    el.addEventListener('pointerdown', function (e) { pressed = e.pointerType !== 'mouse'; });
    el.addEventListener('pointercancel', function () { pressed = false; });
    el.addEventListener('pointerup', function (e) {
      if (!pressed) return;
      pressed = false;
      var r = el.getBoundingClientRect();
      if (el.disabled || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      lastTouch = Date.now();
      fn();
    });
    el.addEventListener('click', function () {
      if (Date.now() - lastTouch < 800) return;   // 指で押したときの「クリック」は、もう動かしたので無視
      fn();
    });
  }

  /* ---------- 手順の列のボタン ---------- */

  onPress($('btn-triangle'), function () { editor.placeShape('triangle'); });
  onPress($('btn-quad'), function () { editor.placeShape('quad'); });
  onPress($('btn-circle'), function () { editor.placeShape('circle'); });
  onPress($('btn-semicircle'), function () { editor.placeShape('semicircle'); });

  onPress($('btn-draw'), function () {
    if (editor.mode === 'draw') editor.cancelAxis(); else editor.startDraw();
  });

  onPress($('btn-axis'), function () {
    if (editor.mode === 'axis1' || editor.mode === 'axis2') editor.cancelAxis(); else editor.startAxis();
  });

  onPress($('btn-rotate'), function () {
    editor.cancelAxis();
    var result = Rev.analyze(editor.shape, editor.axis);
    if (!result.ok) {
      phase = 'error';
      errorText = result.message;
      refresh();
      return;
    }
    lastCrossing = result.crossing;
    hasMade = true;
    phase = 'rotating';
    view.play(result);
    refresh();
  });

  onPress($('btn-undo'), function () { editor.undo(); });
  onPress($('btn-clear'), function () { editor.clear(); });

  /* ---------- 作図の場所 ---------- */

  $('btn-fold').addEventListener('change', function () { editor.setShowFold(this.checked); });
  onPress($('btn-fit'), function () { editor.fitAll(); });

  /* ---------- 3Dの場所 ---------- */

  onPress($('btn-replay'), function () {
    phase = 'rotating';
    view.replay();
    refresh();
  });
  $('btn-translucent').addEventListener('change', function () { view.setTranslucent(this.checked); });
  onPress($('btn-view'), function () { view.resetView(); });

  angle.addEventListener('input', function () {
    view.setAngle(Number(angle.value));
    angleOut.textContent = angle.value + '°';
    if (phase === 'rotating') { phase = 'done'; refresh(); }
  });

  /* ---------- ④から③に戻る矢印の位置（③の見出しから④のボタンまで） ---------- */

  function placeLoop() {
    var loop = $('loop');
    if (getComputedStyle(loop).display === 'none') return;
    var r = rail.getBoundingClientRect();
    var h3 = document.querySelector('.step[data-step="3"] .step-head').getBoundingClientRect();
    var b4 = $('btn-rotate').getBoundingClientRect();
    var top = h3.top + h3.height / 2, bottom = b4.top + b4.height / 2;
    loop.style.top = (top - r.top + rail.scrollTop) + 'px';
    loop.style.height = Math.max(20, bottom - top) + 'px';
  }
  if (window.ResizeObserver) new ResizeObserver(placeLoop).observe(rail);
  window.addEventListener('resize', placeLoop);

  /* 「全体を表示」ボタンの場所を作図の画面に伝える（図形のつまみがボタンに隠れないように） */
  function placeAvoid() {
    var c = editor.canvas.getBoundingClientRect(), b = $('btn-fit').getBoundingClientRect();
    editor.avoid = { left: b.left - c.left, right: b.right - c.left, top: b.top - c.top, bottom: b.bottom - c.top };
    editor.draw();
  }
  if (window.ResizeObserver) new ResizeObserver(placeAvoid).observe($('stage2d'));
  window.addEventListener('resize', placeAvoid);

  /* ---------- iPad でページ全体が拡大・スクロールしたり、メニューが出たりしないように ---------- */

  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();   // 2本指でページが拡大しないように
  }, { passive: false });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  view.setScene(null, null);
  refresh();
  placeLoop();
  placeAvoid();

  // 動作確認用（画面には影響しない）
  window.__app = { editor: editor, view: view };
})();
