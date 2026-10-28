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
// 학생 1명 = 2쪽 (1,3,5,...쪽이 학생 첫 쪽)
function setup(candidatePages){
  const state = {pdf:{}, page:1, activeClass:'1반', keywordFilter:null, unwrittenOcr:{candidates:candidatePages.map(page => ({page})), status:''}};
  const c = vm.createContext({state, visited:[], toasts:[],
    studentIndexForPage:page => Math.ceil(page / 2), firstPageForStudentIndex:index => index * 2 - 1,
    pageWithCurrentSide:page => page, saveCurrent(){}, updateChrome(){},
    showToast:message => c.toasts.push(message),
    goPage:async page => { c.visited.push(page); state.page = page; }});
  for(const name of ['isOcrUnwrittenFilter','ocrCandidateBasePage','stopOcrUnwrittenBrowse','removeOcrCandidate','keywordFilterPages']) vm.runInContext(source(name), c);
  for(const name of ['startOcrUnwrittenBrowse','advanceOcrCandidateAfterMark']) vm.runInContext('async ' + source(name), c);
  return c;
}

test('미작성 후보 넘겨보기: 후보 학생만 순서대로 묶고 첫 후보로 이동한다', async () => {
  const c = setup([7, 2, 3]);
  await c.startOcrUnwrittenBrowse();
  assert.deepEqual([...c.keywordFilterPages()], [1, 3, 7]);
  assert.equal(c.state.activeClass, '');
  assert.deepEqual([...c.visited], [1]);
});

test('미작성 후보 넘겨보기: 이동 버튼은 그 후보에서 시작한다', async () => {
  const c = setup([1, 5, 9]);
  await c.startOcrUnwrittenBrowse(6);
  assert.deepEqual([...c.visited], [5]);
});

test('미작성 후보 넘겨보기: 전체 미작성 표시 후 다음 후보로 넘어가고, 목록에서 빠진다', async () => {
  const c = setup([1, 5, 9]);
  await c.startOcrUnwrittenBrowse(5);
  c.removeOcrCandidate(5);
  await c.advanceOcrCandidateAfterMark(5);
  assert.equal(c.state.page, 9);
  assert.deepEqual(c.state.unwrittenOcr.candidates.map(x => x.page), [1, 9]);
  // ←로 돌아갈 수 있도록 넘겨보기 목록은 그대로 둔다.
  assert.deepEqual([...c.keywordFilterPages()], [1, 5, 9]);
});

test('미작성 후보 넘겨보기: 마지막 후보면 머물고 안내한다', async () => {
  const c = setup([1, 5]);
  await c.startOcrUnwrittenBrowse(5);
  await c.advanceOcrCandidateAfterMark(5);
  assert.equal(c.state.page, 5);
  assert.match(c.toasts.at(-1), /마지막 후보/);
});

test('미작성 후보 넘겨보기: 다른 학생을 표시하면 이동하지 않는다', async () => {
  const c = setup([1, 5, 9]);
  await c.startOcrUnwrittenBrowse(1);
  await c.advanceOcrCandidateAfterMark(9);
  assert.equal(c.state.page, 1);
});

test('미작성 후보 넘겨보기: 끄면 필터가 해제된다', async () => {
  const c = setup([1]);
  await c.startOcrUnwrittenBrowse();
  c.stopOcrUnwrittenBrowse();
  assert.equal(c.state.keywordFilter, null);
});
