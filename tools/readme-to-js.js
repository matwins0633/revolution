/*
 * README.md の文を js/readme-text.js に入れる（右上の ⓘ「使い方」で表示するため）
 * 使い方: node tools/readme-to-js.js
 *
 * index.html をダブルクリックで開いたときは、ブラウザが README.md を読み込めないので、
 * 同じ文をスクリプトの形にしておく。README を直したら、これを実行する。
 */
'use strict';
var fs = require('fs');
var path = require('path');

var rootDir = path.join(__dirname, '..');
var md = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
var out = '/* README.md と同じ文（右上の ⓘ「使い方」で表示する）。直接は書きかえず、README を直してから `node tools/readme-to-js.js` で作り直す */\n' +
  'window.README_TEXT = ' + JSON.stringify(md) + ';\n';
fs.writeFileSync(path.join(rootDir, 'js', 'readme-text.js'), out);
console.log('js/readme-text.js を README.md から作り直しました（' + md.length + ' 文字）');
