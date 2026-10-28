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
function fakeStorage(initial={}){
  const data = {...initial};
  return new Proxy(data, {
    get(target, key){
      if(key === 'getItem') return k => Object.hasOwn(target, k) ? target[k] : null;
      if(key === 'setItem') return (k, v) => { target[k] = String(v); };
      if(key === 'removeItem') return k => { delete target[k]; };
      return target[key];
    }
  });
}
function setup(initial={}){
  const state = {activeQuestion:'q1', questions:[{id:'q1'}, {id:'q2'}, {id:'q3'}]};
  const context = vm.createContext({state, localStorage:fakeStorage(initial), console, showToast:message => { context.message = message; }, loadExamCapture(){}});
  vm.runInContext('const EXAM_CAPTURE_KEY = "cap"; const EXAM_CAPTURE_PREFIX = "cap.";', context);
  for(const name of ['examCaptureKey','currentExamCapture','examCaptureMap','writeExamCapture','restoreExamCaptures','clearAllExamCaptures']) vm.runInContext(source(name), context);
  return context;
}

test('시험문제 캡처: 백업에는 캡처가 있는 문항만 들어간다', () => {
  const c = setup({'cap.q1':'img1', 'cap.q2':''});
  assert.deepEqual({...c.examCaptureMap()}, {q1:'img1'});
});

test('시험문제 캡처: 불러오기(replace)는 백업 내용으로 맞춘다', () => {
  const c = setup({'cap.q1':'old1', 'cap.q3':'old3'});
  c.restoreExamCaptures({q1:'new1', q2:'new2'}, 'replace');
  assert.equal(c.currentExamCapture('q1'), 'new1');
  assert.equal(c.currentExamCapture('q2'), 'new2');
  assert.equal(c.currentExamCapture('q3'), '');
});

test('시험문제 캡처: 병합(keep)은 비어 있는 문항만 채운다', () => {
  const c = setup({'cap.q1':'mine'});
  c.restoreExamCaptures({q1:'theirs', q2:'theirs2'}, 'keep');
  assert.equal(c.currentExamCapture('q1'), 'mine');
  assert.equal(c.currentExamCapture('q2'), 'theirs2');
});

test('시험문제 캡처: 병합 덮어쓰기는 백업에 없는 캡처를 지우지 않는다', () => {
  const c = setup({'cap.q1':'mine', 'cap.q3':'keep3'});
  c.restoreExamCaptures({q1:'theirs'}, 'replace-present');
  assert.equal(c.currentExamCapture('q1'), 'theirs');
  assert.equal(c.currentExamCapture('q3'), 'keep3');
});

test('시험문제 캡처: 예전 백업(캡처 없음)은 아무것도 바꾸지 않는다', () => {
  const c = setup({'cap.q1':'mine'});
  c.restoreExamCaptures(undefined, 'replace');
  assert.equal(c.currentExamCapture('q1'), 'mine');
});

test('시험문제 캡처: 새 시험 초기화는 모든 문항 캡처를 지운다', () => {
  const c = setup({'cap':'legacy', 'cap.q1':'a', 'cap.q2':'b', other:'x'});
  c.clearAllExamCaptures();
  assert.equal(c.currentExamCapture('q1'), '');
  assert.equal(c.currentExamCapture('q2'), '');
  assert.equal(c.localStorage.getItem('other'), 'x');
});
