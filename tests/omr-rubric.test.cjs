const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../omr-grader.html'), 'utf8');
const source = html.slice(html.indexOf('function normalizeRubric('), html.indexOf('\nfunction normalizeQuestionSubs('));
const context = vm.createContext({});
vm.runInContext(source, context);

test('새로고침으로 루브릭을 읽을 때 새로 추가한 0점·빈 키워드 항목도 유지', () => {
  const saved = [
    {id:'existing', type:'score', name:'기존 항목', pt:3, accept:'인정', acceptScores:{인정:3}},
    {id:'new', type:'score', name:'새 항목', pt:0, accept:'', reject:''}
  ];
  const restored = context.normalizeRubric(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.length, 2);
  assert.equal(restored[1].id, 'new');
  assert.equal(restored[1].name, '새 항목');
  assert.equal(restored[1].pt, 0);
  assert.equal(restored[0].acceptScores.인정, 3);
});
