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
const c = vm.createContext({
  subOptions:() => ['(1)', '(2)', '공통 감점'],
  activeQuestion:() => ({id:'q1'}),
  currentQuestionRecord:() => null,
  isCommonDeductSub:sub => sub === '공통 감점',
  clearSubScores:(qrec, sub) => { delete qrec.scores[sub]; }
});
for(const name of ['markAllSubsCompleted','setQuestionAllUnwrittenCompleted']) vm.runInContext(source(name), c);

test('전체 미작성: 모든 소문항을 미작성으로 두고 점수를 지운 뒤 채점 완료까지 표시한다', () => {
  const qrec = {scores:{'(1)':3, '(2)':2}, unwrittenSubs:{}, completedSubs:{'(1)':true}, completed:false};
  c.setQuestionAllUnwrittenCompleted(qrec);
  assert.equal(qrec.completed, true);
  assert.deepEqual({...qrec.unwrittenSubs}, {'(1)':true, '(2)':true, '공통 감점':true});
  assert.deepEqual({...qrec.completedSubs}, {'(1)':true, '(2)':true});
  assert.deepEqual({...qrec.scores}, {});
});
