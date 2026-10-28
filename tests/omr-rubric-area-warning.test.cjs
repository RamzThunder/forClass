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
