/*
 * 右上の ⓘ「使い方」：README の内容を、生徒向け・先生向けのタブで表示する
 *
 * index.html をダブルクリックで開いたときは README.md を読み込めないので、
 * README の文をそのまま入れた js/readme-text.js（window.README_TEXT）を使う。
 * README を直したら `node tools/readme-to-js.js` で作り直す（tests/help.test.js が確かめる）。
 *
 * 読み取り（sections・parse）は画面に依存しないので、Node でテストできる。
 * README で使っている書き方（見出し・段落・番号付きの並び・・の並び・太字・コード・表・区切り線）だけを読む。
 */
(function (root) {
  'use strict';

  var STUDENT_HEADING = '## 生徒のみなさんへ';
  var TEACHER_HEADING = '## 先生方へ';
  // 先生向けのタブに表示しない節（開発する人向けの内容）
  var TEACHER_HIDDEN = [
    '### ファイルの構成',
    '### 今後の拡張のためのメモ（開発する人向け）',
    '### three.js について'
  ];

  /* README を2つのタブの中身（Markdown の文）に分ける。各タブの「## 」の見出しは、タブの名前があるので除く */
  function sections(md) {
    var lines = md.replace(/\r\n?/g, '\n').split('\n');
    function part(heading) {
      var start = -1, i;
      for (i = 0; i < lines.length; i++) if (lines[i].indexOf(heading) === 0) { start = i + 1; break; }
      if (start < 0) return '';
      var out = [], skip = false;
      for (i = start; i < lines.length; i++) {
        var ln = lines[i];
        if (/^## /.test(ln)) break;
        if (/^### /.test(ln)) skip = TEACHER_HIDDEN.some(function (h) { return ln.indexOf(h) === 0; });
        if (!skip && !/^---\s*$/.test(ln)) out.push(ln);
      }
      return out.join('\n').trim();
    }
    return { student: part(STUDENT_HEADING), teacher: part(TEACHER_HEADING) };
  }

  /* 太字（**）とコード（`）を見分ける → [{ t: 'text' | 'b' | 'code', s }] */
  function inline(text) {
    var out = [], re = /\*\*([^*]+)\*\*|`([^`]+)`/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ t: 'text', s: text.slice(last, m.index) });
      out.push(m[1] !== undefined ? { t: 'b', s: m[1] } : { t: 'code', s: m[2] });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
    return out;
  }

  function cells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }

  /*
   * Markdown の文を、表示する部品の並びにする。
   *   { type: 'h', level, text } | { type: 'p', lines: [文] } | { type: 'list', ordered, items: [{ lines, lists }] }
   *   { type: 'table', head: [文], rows: [[文]] } | { type: 'hr' }
   * 並びの入れ子は字下げで決める。番号や「-」のない字下げした行は、すぐ上の項目の続き。
   */
  function parse(md) {
    var lines = md.replace(/\r\n?/g, '\n').split('\n');
    var blocks = [], para = null, stack = [];   // stack: 開いている並び { indent, content, list }
    function endPara() { para = null; }
    function endList() { stack = []; }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], m;
      if (/^\s*$/.test(ln)) { endPara(); continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(ln))) {
        endPara(); endList();
        blocks.push({ type: 'h', level: m[1].length, text: m[2] });
        continue;
      }
      if (/^---\s*$/.test(ln)) { endPara(); endList(); blocks.push({ type: 'hr' }); continue; }
      if (/^\s*\|/.test(ln)) {
        endPara(); endList();
        var head = cells(ln), rows = [];
        if (i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) i++;
        while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) rows.push(cells(lines[++i]));
        blocks.push({ type: 'table', head: head, rows: rows });
        continue;
      }
      m = /^(\s*)(\d+\.|-)\s+(.*)$/.exec(ln);
      if (m) {
        endPara();
        var indent = m[1].length, ordered = m[2] !== '-';
        var item = { lines: [m[3]], lists: [] };
        while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
        var top = stack[stack.length - 1];
        if (top && top.indent === indent && top.list.ordered === ordered) {
          top.list.items.push(item);
        } else {
          var list = { type: 'list', ordered: ordered, items: [item] };
          if (top && top.indent === indent) stack.pop();   // 同じ字下げで種類が変わったら、別の並び
          var parent = stack[stack.length - 1];
          if (parent && indent > parent.indent) {
            var pItems = parent.list.items;
            pItems[pItems.length - 1].lists.push(list);
          } else {
            stack = [];
            blocks.push(list);
          }
          stack.push({ indent: indent, content: indent + m[2].length + 1, list: list });
        }
        stack[stack.length - 1].content = indent + m[2].length + 1;
        continue;
      }
      var lead = /^(\s*)/.exec(ln)[1].length;
      if (stack.length && lead > 0) {   // 字下げした行：すぐ上の項目の続き
        while (stack.length > 1 && stack[stack.length - 1].content > lead) stack.pop();
        var its = stack[stack.length - 1].list.items;
        its[its.length - 1].lines.push(ln.trim());
        continue;
      }
      endList();
      if (!para) { para = { type: 'p', lines: [] }; blocks.push(para); }
      para.lines.push(ln.trim());
    }
    return blocks;
  }

  /* ---------- 表示（ブラウザだけ） ---------- */

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  /* 文を部品にする（文字は textContent で入れるので、README の文がプログラムとして動くことはない） */
  function addText(parent, text) {
    inline(text).forEach(function (tk) {
      if (tk.t === 'text') parent.appendChild(document.createTextNode(tk.s));
      else { var e = el(tk.t === 'b' ? 'strong' : 'code'); e.textContent = tk.s; parent.appendChild(e); }
    });
  }
  function addLines(parent, lines) {
    lines.forEach(function (t, k) {
      if (k) parent.appendChild(el('br'));
      addText(parent, t);
    });
  }
  function renderList(list) {
    var e = el(list.ordered ? 'ol' : 'ul');
    list.items.forEach(function (it) {
      var li = el('li');
      addLines(li, it.lines);
      it.lists.forEach(function (sub) { li.appendChild(renderList(sub)); });
      e.appendChild(li);
    });
    return e;
  }
  function render(blocks, into) {
    blocks.forEach(function (b) {
      var e;
      if (b.type === 'h') { e = el(b.level <= 2 ? 'h3' : 'h4'); addText(e, b.text); }
      else if (b.type === 'p') { e = el('p'); addLines(e, b.lines); }
      else if (b.type === 'list') e = renderList(b);
      else if (b.type === 'hr') e = el('hr');
      else if (b.type === 'table') {
        e = el('div', 'help-table');
        var t = el('table'), tr = el('tr');
        b.head.forEach(function (c) { var th = el('th'); addText(th, c); tr.appendChild(th); });
        var thead = el('thead'); thead.appendChild(tr); t.appendChild(thead);
        var tbody = el('tbody');
        b.rows.forEach(function (r) {
          var row = el('tr');
          r.forEach(function (c) { var td = el('td'); addText(td, c); row.appendChild(td); });
          tbody.appendChild(row);
        });
        t.appendChild(tbody);
        e.appendChild(t);
      }
      if (e) into.appendChild(e);
    });
  }

  /* 使い方の窓をつなぐ：ⓘ ボタン、タブ、閉じるボタン */
  function setup(opts) {
    var overlay = opts.overlay, body = opts.body, opener = opts.opener, closeBtn = opts.close, tabs = opts.tabs;
    var parts = sections(root.README_TEXT || '');
    var cache = {}, current = 'student';

    function show(name) {
      current = name;
      tabs.forEach(function (t) {
        var on = t.dataset.tab === name;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      if (!cache[name]) { cache[name] = el('div'); render(parse(parts[name] || ''), cache[name]); }
      while (body.firstChild) body.removeChild(body.firstChild);
      body.appendChild(cache[name]);
      // タブを変えたら、いちばん上から。指ではじいたスクロールが続いていても止める
      body.style.overflowY = 'hidden';
      body.scrollTop = 0;
      void body.offsetHeight;
      body.style.overflowY = '';
    }
    function open() {
      show(current);
      overlay.hidden = false;
      opener.setAttribute('aria-expanded', 'true');
      closeBtn.focus();
    }
    function close() {
      if (overlay.hidden) return;
      overlay.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
      opener.focus();
    }

    opts.onPress(opener, open);
    opts.onPress(closeBtn, close);
    tabs.forEach(function (t) { opts.onPress(t, function () { show(t.dataset.tab); }); });
    // 暗い所をタップで閉じる。ⓘ を指で押したとき、開いた直後の「クリック」が暗い所に届いて閉じないよう、
    // 暗い所で押し始めたときだけ閉じる
    var downOnOverlay = false;
    overlay.addEventListener('pointerdown', function (e) { downOnOverlay = e.target === overlay; });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay && downOnOverlay) close();
      downOnOverlay = false;
    });
    document.addEventListener('keydown', function (e) {
      if (overlay.hidden) return;
      if (e.key === 'Escape') close();
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target && e.target.getAttribute('role') === 'tab') {
        var next = current === 'student' ? 'teacher' : 'student';
        show(next);
        tabs.forEach(function (t) { if (t.dataset.tab === next) t.focus(); });
      }
    });
    return { open: open, close: close, show: show };
  }

  var Help = { sections: sections, parse: parse, inline: inline, setup: setup, TEACHER_HIDDEN: TEACHER_HIDDEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = Help;
  else root.Help = Help;
})(this);
