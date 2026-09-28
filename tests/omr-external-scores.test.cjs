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
test('문항 카드 저장은 선택형·다른 문항 점수를 유지하고 현재 문항만 수정', () => {
  const c = setup();
  const rec = {externalScores:{selected:30, offlineWrittenScores:[4,6], imported:true}};
  const form = {dataset:{recordKey:'2',questionId:'offline_2'}, reportValidity:() => true};
  c.activeQuestion = () => ({id:'offline_2',offline:true,offlineIndex:1});
  c.currentRecord = () => rec;
  c.recordKey = () => '2';
  c.$ = id => id === 'offlineScoreEditForm' ? form : {value:'8.5'};
  c.commitStudentExternalScores = scores => {c.saved = scores;};
  vm.runInContext(source('saveOfflineStudentScore'), c);
  c.saveOfflineStudentScore({preventDefault(){}});
  assert.equal(c.saved.selected,30);
  assert.deepEqual(Array.from(c.saved.offlineWrittenScores),[4,8.5]);
  assert.equal(c.saved.offlineWritten,12.5);
  c.saved = null;
  form.dataset.recordKey = '1';
  c.saveOfflineStudentScore({preventDefault(){}});
  assert.equal(c.saved,null);
});
function historySetup(){
  const c = setup();
  c.KeywordReview = require('../keyword-review.js');
  c.crypto = require('node:crypto');
  c.state.keywordReview = c.KeywordReview.empty();
  c.state.questions = [{id:'q1',label:'온라인 문항',rubric:[]}];
  c.state.settings.externalOfflineWrittenTitles = ['서술형 3','서술형 4'];
  c.reviewStudentKey = rec => String(rec.studentIndex);
  c.questionTotal = () => 0;
  c.updateReviewChangesCount = () => {};
  c.activeQuestion = () => c.state.questions[0];
  c.keywordFilterLabel = () => '키워드 검토';
  for(const name of ['externalOfflineWrittenTitles','offlineQuestionId','hasExternalScores','externalScoreTotal','gradedQuestionTotal','grandTotal','reviewScoreSnapshot','captureReviewChanges']) vm.runInContext(source(name),c);
  c.resetBaseline = () => {c.reviewScoreBaseline=c.reviewScoreSnapshot();};
  c.resetBaseline();
  return c;
}
test('외부 점수 최초 가져오기는 제외하고 이후 선택형·문항별 수정과 총점 기록', () => {
  const c = historySetup(), rec = c.state.records['2'];
  rec.externalScores = {selected:30,offlineWrittenScores:[4,6],imported:true};
  c.captureReviewChanges();
  assert.equal(c.state.keywordReview.changes.length,0);
  rec.externalScores = c.revisedExternalScores(rec.externalScores,['29','4','8.5']);
  c.captureReviewChanges();
  const rows=c.state.keywordReview.changes;
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>[r.questionLabel,r.before,r.after,r.totalBefore,r.totalAfter]),[['선택형 점수',30,29,40,41.5],['서술형 4',6,8.5,40,41.5]]);
  assert.ok(rows.every(r=>r.context==='외부 점수 수정' && r.name==='테스트'));
  c.captureReviewChanges();
  assert.equal(rows.length,2);
  const restored=c.KeywordReview.restore(JSON.parse(JSON.stringify(c.state.keywordReview)));
  assert.equal(restored.changes.length,2);
});
test('외부 점수 합계가 같아도 각 문항 수정 기록, 0점과 되돌리기도 기록', () => {
  const c=historySetup(),rec=c.state.records['2'];
  rec.externalScores={selected:0,offlineWrittenScores:[4,6],imported:true};
  c.resetBaseline();
  rec.externalScores=c.revisedExternalScores(rec.externalScores,['0','0','10']);
  c.captureReviewChanges();
  assert.equal(c.state.keywordReview.changes.length,2);
  assert.ok(c.state.keywordReview.changes.every(r=>r.totalBefore===10 && r.totalAfter===10));
  rec.externalScores={selected:0,offlineWrittenScores:[4,6],imported:true};
  c.captureReviewChanges();
  assert.equal(c.state.keywordReview.changes.length,4);
  assert.equal(c.state.keywordReview.changes[2].before,0);
  assert.equal(c.state.keywordReview.changes[2].after,4);
});
