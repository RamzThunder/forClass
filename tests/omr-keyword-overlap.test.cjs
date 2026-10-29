const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../omr-grader.html'), 'utf8');
function source(name){
  const start = html.indexOf(`function ${name}(`);
  const end = html.slice(start + 1).search(/\n(?:async )?function /);
  return html.slice(start, start + 1 + end);
}
const ctx = {};
vm.createContext(ctx);
['compactTextWithMap','sourceMatchRanges','detectKeywordsInText'].forEach(name => vm.runInContext(source(name), ctx));
const detect = (text, keywords) => [...ctx.detectKeywordsInText(text, keywords)].sort().join('|');

test('a keyword inside a longer detected keyword is not detected again', () => {
  assert.equal(detect('두 문장이 종속적으로 이어진 문장이다.', ['종속적으로 이어진 문장', '종속적으로']), '종속적으로 이어진 문장');
});

test('spacing differences still count as the same place', () => {
  assert.equal(detect('종속적으로이어진 문장', ['종속적으로', '종속적으로 이어진 문장']), '종속적으로 이어진 문장');
});

test('the short keyword is detected when it also appears on its own', () => {
  assert.equal(detect('종속적으로 이어진 문장이고, 앞 절이 종속적으로 쓰였다.', ['종속적으로 이어진 문장', '종속적으로']), '종속적으로|종속적으로 이어진 문장');
});

test('the same keyword in two rubric items is detected for both', () => {
  assert.equal(detect('대등하게 이어진 문장', ['대등하게', '대등하게']), '대등하게');
});

test('partly overlapping keywords are both detected', () => {
  assert.equal(detect('이어진 문장 성분', ['이어진 문장', '문장 성분']), '문장 성분|이어진 문장');
});
