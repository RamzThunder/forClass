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
const c = vm.createContext({});
vm.runInContext(source('paddleItemsToText'), c);
const box = (text, x, y, w=80, h=30) => ({text, score:.9, poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});

test('PaddleOCR 결과: 위→아래, 같은 줄은 왼→오 순서로 잇는다', () => {
  const items = [box('갈등을', 200, 62), box('공간적 배경이', 10, 60), box('인물의 심리를', 10, 10), box('비유적으로', 150, 14)];
  assert.equal(c.paddleItemsToText(items), '인물의 심리를 비유적으로\n공간적 배경이 갈등을');
});

test('PaddleOCR 결과: 빈 글자와 빈 목록은 건너뛴다', () => {
  assert.equal(c.paddleItemsToText([box('  ', 0, 0), box('답', 0, 50)]), '답');
  assert.equal(c.paddleItemsToText(undefined), '');
});
