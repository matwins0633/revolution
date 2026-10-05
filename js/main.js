/*
 * ボタン・案内メッセージと、左右の表示をつなぐ部分
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var messageEl = $('message');
  var lastCrossing = false;   // 最後に回転させた図形が、軸をまたいでいたか
  var MSG_CROSSING = '軸が図形の中を通っています。「折り返しを見る」で、軸の反対側の部分がどう重なるか確かめてみよう。';

  function say(text, kind) {
    messageEl.textContent = text;
    messageEl.className = 'message' + (kind ? ' ' + kind : '');
  }

  var view = new View3D($('view3d'), {
    onFinish: function () {
      if (lastCrossing) {
        say('できあがり！ 軸の反対側の部分は、軸で折り返して重なった形で回っています。「折り返しを見る」で確かめよう。', 'done');
      } else {
        say('できあがり！ 右の立体を1本指で回したり、2本指で大きくしたりしてみよう。', 'done');
      }
    }
  });

  var editor = new Editor2D($('canvas2d'), {
    onChange: function () {
      view.setScene(editor.shape, editor.axis);
      updateButtons();
      guide();
    },
    onModeChange: function (mode) {
      $('btn-axis').setAttribute('aria-pressed', mode !== 'edit' ? 'true' : 'false');
      guide();
    }
  });

  /* 次にすることを案内する */
  function guide() {
    if (editor.mode === 'axis1') return say('軸が通る1つ目の点をタップしてください。', 'active');
    if (editor.mode === 'axis2') return say('軸が通る2つ目の点をタップしてください。', 'active');
    if (!editor.shape) return say('① 「三角形」「四角形」「円」「半円」のどれかを押して、図形を置きましょう。');
    if (!editor.axis) return say('② ●を動かすと形が変わります。次に「軸を引く」を押しましょう。');
    if (editor.isCrossing()) return say(MSG_CROSSING, 'info');
    if (editor.snapState().fit) return say('緑の●は、軸にぴったり合っています。③ 「回転させる」を押しましょう。', 'fit');
    say('③ 「回転させる」を押しましょう。（●を軸に近づけると、軸にぴったり吸い付きます）');
  }

  function updateButtons() {
    $('btn-replay').disabled = !view.hasSolid();
    $('btn-arc').hidden = !(editor.shape && editor.shape.type === 'semicircle');
    $('btn-fold').disabled = !editor.isCrossing();
  }

  $('btn-triangle').addEventListener('click', function () { editor.placeShape('triangle'); });
  $('btn-quad').addEventListener('click', function () { editor.placeShape('quad'); });
  $('btn-circle').addEventListener('click', function () { editor.placeShape('circle'); });
  $('btn-semicircle').addEventListener('click', function () { editor.placeShape('semicircle'); });
  $('btn-arc').addEventListener('click', function () { editor.flipArc(); });

  $('btn-fold').addEventListener('click', function () {
    var on = this.getAttribute('aria-pressed') !== 'true';
    this.setAttribute('aria-pressed', on ? 'true' : 'false');
    editor.setShowFold(on);
  });

  $('btn-axis').addEventListener('click', function () {
    if (editor.mode === 'edit') editor.startAxis(); else editor.cancelAxis();
  });

  $('btn-rotate').addEventListener('click', function () {
    editor.cancelAxis();
    var result = Rev.analyze(editor.shape, editor.axis);
    if (!result.ok) {
      say(result.message, 'error');
      return;
    }
    lastCrossing = result.crossing;
    view.play(result);
    updateButtons();
    say('回転中… 図形が軸のまわりを1周します。');
  });

  $('btn-clear').addEventListener('click', function () {
    editor.clear();
  });

  $('btn-replay').addEventListener('click', function () {
    view.replay();
    say('回転中… 図形が軸のまわりを1周します。');
  });

  $('btn-translucent').addEventListener('click', function () {
    var on = this.getAttribute('aria-pressed') !== 'true';
    this.setAttribute('aria-pressed', on ? 'true' : 'false');
    view.setTranslucent(on);
  });

  $('btn-view').addEventListener('click', function () { view.resetView(); });

  view.setScene(null, null);
  updateButtons();
  guide();

  // 動作確認用（画面には影響しない）
  window.__app = { editor: editor, view: view };
})();
