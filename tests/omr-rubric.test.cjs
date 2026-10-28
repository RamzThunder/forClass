const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../omr-grader.html'), 'utf8');
const source = html.slice(html.indexOf('function defaultRejectKeywordList('), html.indexOf('\nfunction normalizeQuestionSubs('));
const context = vm.createContext({state:{settings:{defaultRejectKeywords:''}}, splitKeywords:text => String(text || '').split(/\n+/).map(line => line.trim()).filter(Boolean)});
vm.runInContext('const DEFAULT_REJECT_KEYWORDS = "미작성\\n미해당";', context);
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

test('항상 넣을 미인정 문구: 가점 항목 끝에 빠진 것만 채우고 감점 항목은 건드리지 않는다', () => {
  context.state.settings.defaultRejectKeywords = '미작성\n미해당';
  const restored = context.normalizeRubric([
    {id:'a', type:'score', name:'서술 방식', reject:''},
    {id:'b', type:'score', name:'구절', reject:'오답\n미작성'},
    {id:'c', type:'deduct', name:'감점', reject:'맞춤법'}
  ]);
  assert.equal(restored[0].reject, '미작성\n미해당');
  assert.equal(restored[1].reject, '오답\n미작성\n미해당');
  assert.equal(restored[2].reject, '맞춤법');
  context.state.settings.defaultRejectKeywords = '';
});

test('항상 넣을 미인정 문구: 비워 두면 넣지 않고, 설정 전에는 미작성·미해당이 기본이다', () => {
  context.state.settings.defaultRejectKeywords = '';
  assert.equal(context.normalizeRubric([{id:'a', type:'score', name:'x', reject:''}])[0].reject, '');
  delete context.state.settings.defaultRejectKeywords;
  assert.equal(context.normalizeRubric([{id:'a', type:'score', name:'x', reject:''}])[0].reject, '미작성\n미해당');
  context.state.settings.defaultRejectKeywords = '';
});
