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
function setup(records, answer){
  const asked = [];
  const c = vm.createContext({state:{records}, activeQuestion:() => ({id:'q4'}), confirm:message => { asked.push(message); return answer; }});
  for(const name of ['completedCountForQuestion','confirmAddScoreArea']) vm.runInContext(source(name), c);
  return {c, asked};
}
const records = {
  '1':{answers:{q4:{completed:true}}},
  '2':{answers:{q4:{completed:true}, q1:{completed:true}}},
  '3':{answers:{q4:{completed:false}}},
  '4':{answers:{q1:{completed:true}}}
};

test('채점 완료 학생이 있으면 가점 영역 추가 전에 몇 명이 풀리는지 묻는다', () => {
  const {c, asked} = setup(records, false);
  assert.equal(c.confirmAddScoreArea('score'), false);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /채점 완료된 학생이 2명/);
});

test('확인하면 추가를 계속한다', () => {
  const {c} = setup(records, true);
  assert.equal(c.confirmAddScoreArea('score'), true);
});

test('채점 완료 학생이 없거나 감점 영역이면 묻지 않는다', () => {
  const none = setup({'1':{answers:{q4:{completed:false}}}}, false);
  assert.equal(none.c.confirmAddScoreArea('score'), true);
  assert.equal(none.asked.length, 0);
  const deduct = setup(records, false);
  assert.equal(deduct.c.confirmAddScoreArea('deduct'), true);
  assert.equal(deduct.asked.length, 0);
});

function changeSetup(records, answer){
  const asked = [];
  const host = {confirm:message => { asked.push(message); return answer; }};
  const c = vm.createContext({state:{records}, activeQuestion:() => ({id:'q4', rubric:[]}), normalizeSubValue:sub => sub});
  for(const name of ['itemHasSelection','scoreRubricItems','hasScoreRubricSelection','completionsLostByRubric','confirmRubricChange']) vm.runInContext(source(name), c);
  return {c, asked, host};
}
const graded = {
  '1':{answers:{q4:{completed:true, keywordHits:{a:{accept:['인정']}}}}},
  '2':{answers:{q4:{completed:true, keywordHits:{a:{reject:['미작성']}}}}},
  '3':{answers:{q4:{completed:false, keywordHits:{}}}}
};

test('감점 항목을 가점용으로 바꾸면 체크 없는 학생 수만큼 경고한다', () => {
  const {c, asked, host} = changeSetup(graded, false);
  const next = [{id:'a', type:'score'}, {id:'d', type:'score'}];   // d: 감점 → 가점
  assert.equal(c.completionsLostByRubric(next), 2);
  assert.equal(c.confirmRubricChange(next, host, '이 항목을 이렇게 바꾸면'), false);
  assert.match(asked[0], /채점 완료된 학생 2명/);
});

test('HWPX처럼 항목 id가 모두 바뀌면 기존 체크가 사라지므로 경고한다', () => {
  const {c} = changeSetup(graded, true);
  assert.equal(c.completionsLostByRubric([{id:'new1', type:'score'}]), 2);
});

test('채점 완료가 그대로 유지되는 변경은 묻지 않는다', () => {
  const {c, asked, host} = changeSetup(graded, false);
  assert.equal(c.confirmRubricChange([{id:'a', type:'score'}, {id:'d', type:'deduct'}], host), true);
  assert.equal(asked.length, 0);
});
