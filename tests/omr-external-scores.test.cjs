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
function setup(){
  const state = {settings:{externalOfflineWrittenCount:2}, lastPdfName:'시험.pdf', questions:[{id:'q1'}], records:{'2':{studentIndex:2, page:3, className:'1반', number:'2', name:'테스트'}}, page:1};
  const context = vm.createContext({state, URL, window:{location:{href:'https://example.test/omr-grader.html'}}, nonNegativeNumber:value => Math.max(0, Number(value) || 0), studentIndexForPage:page => Math.ceil(page / 2), firstPageForStudentIndex:index => index * 2 - 1, showToast:message => {context.message = message;}, saveCurrent(){}, persist(){}, loadRecordIntoForm(){}, updateChrome(){}, document:{querySelectorAll:() => []}, $:() => ({scrollIntoView(){}, querySelector:() => ({focus(){}})})});
  for(const name of ['externalOfflineWrittenCount','externalScoreNumber','normalizeExternalScores','revisedExternalScores','studentScoreEditUrl']) vm.runInContext(source(name), context);
  vm.runInContext('async ' + source('openStudentScoreLink'), context);
  return context;
}
test('외부 점수 수정: 소수·0점 반영, 문항 합계 재계산, 기존 입력 보존', () => {
  const c = setup();
  const original = {selected:30, offlineWrittenScores:[4,6], imported:true};
  const result = c.revisedExternalScores(original, ['0','2.5','6']);
  assert.equal(result.selected, 0);
  assert.equal(result.offlineWritten, 8.5);
  assert.equal(result.imported, true);
  assert.deepEqual(original.offlineWrittenScores, [4,6]);
});
test('빈 점수, 음수, 숫자가 아닌 값은 저장 거부', () => {
  const c = setup();
  for(const value of ['', '-1', 'abc', 'Infinity']) assert.equal(c.revisedExternalScores({}, [value,'1','2']), null);
});
test('학생 링크로 PDF가 닫힌 상태에서도 정확한 학생과 마지막 페이지 선택', async () => {
  const c = setup();
  c.state.activeClass = '다른 반';
  c.state.keywordFilter = {kind:'keyword'};
  c.state.settings.incompleteOnly = true;
  const url = c.studentScoreEditUrl(c.state.records['2']);
  await c.openStudentScoreLink(new URL(url).hash);
  assert.equal(c.state.page, 3);
  assert.equal(c.state.lastPdfPage, 3);
  assert.equal(c.state.activeClass, '');
  assert.equal(c.state.keywordFilter, null);
  assert.equal(c.state.settings.incompleteOnly, false);
});
test('다른 시험·학생으로 바뀐 자료에는 학생 링크를 적용하지 않음', async () => {
  for(const change of [c => c.state.lastPdfName = '다른.pdf', c => c.state.records['2'].name = '다른 학생', c => c.state.questions = [{id:'q2'}]]){
    const c = setup();
    const hash = new URL(c.studentScoreEditUrl(c.state.records['2'])).hash;
    change(c);
    await c.openStudentScoreLink(hash);
    assert.equal(c.state.page, 1);
    assert.match(c.message, /채점 자료가 없습니다/);
  }
});
test('채점 HTML의 인라인 스크립트 구문 검사', () => {
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){
    const result = require('node:child_process').spawnSync(process.execPath, ['--check', '--input-type=module'], {input:match[1], encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
  }
});
