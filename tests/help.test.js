/*
 * 右上の ⓘ「使い方」（help.js・readme-text.js）のチェック
 * 使い方: node tests/help.test.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var Help = require('../js/help.js');

var failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  OK  ' + name); }
  else { failed++; console.log('  NG  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

var rootDir = path.join(__dirname, '..');
var md = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');

console.log('README と同じ文か');
(function () {
  var box = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(rootDir, 'js', 'readme-text.js'), 'utf8'), box);
  check('js/readme-text.js が今の README.md と同じ', box.window.README_TEXT === md,
    'README を直したら `node tools/readme-to-js.js` を実行してください');
})();

console.log('タブの中身');
(function () {
  var s = Help.sections(md);
  check('生徒向け：手順の説明が入る', s.student.indexOf('① 図形をえらぶ') >= 0 && s.student.indexOf('フリーハンドでかく') >= 0);
  check('生徒向け：先生向けの内容は入らない', s.student.indexOf('GitHub Pages') < 0 && s.student.indexOf('### 作図のきまり') < 0);
  check('先生向け：授業に関わる節が入る', ['### 教材の開き方', '### 授業での使い方の例', '### 作図のきまり', '### 回転体の正しさについて', '### まだできないこと']
    .every(function (h) { return s.teacher.indexOf(h) >= 0; }));
  check('先生向け：開発する人向けの3つの節は入らない', Help.TEACHER_HIDDEN.every(function (h) { return s.teacher.indexOf(h) < 0; }) &&
    s.teacher.indexOf('vendor/three/three.min.js') < 0 && s.teacher.indexOf('| `js/geometry.js` |') < 0);
  check('先生向け：README の中で、表示しない節がちゃんと見つかる（節の名前が変わっていない）', Help.TEACHER_HIDDEN.every(function (h) { return md.indexOf(h) >= 0; }));
  check('タブの中身に区切り線（---）と「## 」の見出しは入らない', !/^---\s*$/m.test(s.student + s.teacher) && !/^## /m.test(s.student + s.teacher));
})();

console.log('読み取り');
(function () {
  var b = Help.parse([
    '### 見出し',
    '',
    '1行目の段落',
    '2行目の段落',
    '',
    '1. **① 図形をえらぶ**',
    '   続きの行',
    '2. **② 軸をひく**',
    '   - 入れ子A',
    '     - 入れ子Aの中',
    '       続きA',
    '   - 入れ子B',
    '3. 三つ目',
    '',
    '- ふつうの並び `コード` です',
    '',
    '| ファイル | 内容 |',
    '| --- | --- |',
    '| `a.js` | えー |',
    '| `b.js` | びー |',
    '',
    '---',
    '最後の段落'
  ].join('\n'));
  var types = b.map(function (x) { return x.type; }).join(',');
  check('部品の並び', types === 'h,p,list,list,table,hr,p', types);
  check('見出しの深さ', b[0].level === 3 && b[0].text === '見出し');
  check('段落の行', b[1].lines.length === 2);
  var ol = b[2];
  check('番号付きの並びは3項目', ol.ordered && ol.items.length === 3, ol.items.length);
  check('続きの行は同じ項目に入る', ol.items[0].lines.join('|') === '**① 図形をえらぶ**|続きの行');
  var sub = ol.items[1].lists[0];
  check('入れ子の並び', sub && !sub.ordered && sub.items.length === 2 && sub.items[0].lists[0].items[0].lines.join('|') === '入れ子Aの中|続きA',
    JSON.stringify(sub));
  check('入れ子のあとも番号付きの並びが続く', ol.items[2].lines[0] === '三つ目');
  check('表', b[4].head.join(',') === 'ファイル,内容' && b[4].rows.length === 2 && b[4].rows[1][0] === '`b.js`');
  var tk = Help.inline('ふつうの **太字** と `コード`');
  check('太字とコード', tk.map(function (t) { return t.t; }).join(',') === 'text,b,text,code' && tk[1].s === '太字' && tk[3].s === 'コード');

  // README 全体を読んで、項目が消えないこと（並びの項目の数）
  var s = Help.sections(md);
  function countItems(blocks) {
    var n = 0;
    (function walk(lists) { lists.forEach(function (l) { l.items.forEach(function (it) { n++; walk(it.lists); }); }); })(blocks.filter(function (x) { return x.type === 'list'; }));
    return n;
  }
  ['student', 'teacher'].forEach(function (k) {
    var expected = s[k].split('\n').filter(function (l) { return /^\s*(\d+\.|-)\s+/.test(l); }).length;
    var got = countItems(Help.parse(s[k]));
    check((k === 'student' ? '生徒向け' : '先生向け') + '：README の並びの項目がすべて読まれる', got === expected, got + ' / ' + expected);
  });
})();

console.log('\n合格 ' + passed + ' / 不合格 ' + failed);
process.exit(failed ? 1 : 0);
