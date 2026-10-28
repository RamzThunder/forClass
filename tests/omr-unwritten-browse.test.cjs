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

function renderSetup(candidates, page, browsing=true){
  const el = () => ({textContent:'', innerHTML:'', disabled:false, checked:false, classList:{toggle(){}}});
  const els = {unwrittenOcrPanel:el(), runUnwrittenOcrBtn:el(), unwrittenOcrShortInput:el(), unwrittenOcrStatus:el(), browseUnwrittenOcrBtn:el(), unwrittenOcrList:el()};
  const state = {pdf:{}, page, settings:{unwrittenOcrEnabled:true}, keywordFilter:browsing ? {kind:'ocrUnwritten', pages:[1,5,9]} : null, unwrittenOcr:{running:false, status:'', candidates}};
  const c = vm.createContext({state, els, escapeHtml:String, activeQuestion:() => ({label:'1번'}),
    studentIndexForPage:p => Math.ceil(p / 2), firstPageForStudentIndex:i => i * 2 - 1});
  for(const name of ['isOcrUnwrittenFilter','ocrCandidateBasePage','renderUnwrittenOcrCandidates']) vm.runInContext(source(name), c);
  return c;
}

test('미작성 후보 넘겨보기: 화면에 띄운 후보는 확인함으로 바뀌고 미리보기가 접힌다', () => {
  const candidates = [1, 5, 9].map(page => ({page, studentText:`${page}쪽`, reason:'미작성 추정', thumb:'data:x'}));
  const c = renderSetup(candidates, 5);
  c.renderUnwrittenOcrCandidates();
  assert.equal(candidates[1].viewed, true);
  assert.equal(candidates[0].viewed, undefined);
  assert.equal((c.els.unwrittenOcrList.innerHTML.match(/unwrittenOcrThumb/g) || []).length, 2);
  assert.match(c.els.unwrittenOcrStatus.textContent, /확인 1명/);
  c.state.page = 1; c.renderUnwrittenOcrCandidates();
  c.state.page = 9; c.renderUnwrittenOcrCandidates();
  assert.equal((c.els.unwrittenOcrList.innerHTML.match(/unwrittenOcrThumb/g) || []).length, 0);
  assert.match(c.els.unwrittenOcrStatus.textContent, /모두 확인/);
});

test('미작성 후보: 넘겨보기 전에는 미리보기를 그대로 보여 준다', () => {
  const candidates = [1, 5].map(page => ({page, studentText:`${page}쪽`, reason:'미작성 추정', thumb:'data:x'}));
  const c = renderSetup(candidates, 1, false);
  c.renderUnwrittenOcrCandidates();
  assert.equal((c.els.unwrittenOcrList.innerHTML.match(/unwrittenOcrThumb/g) || []).length, 2);
});

test('미작성 후보 찾기: 문항 답안 칸이 뒷면에 있으면 뒷면을 잘라 검사한다', async () => {
  const cropped = [];
  const state = {pdf:{}, page:1, settings:{unwrittenIncludeFewInk:true}, keywordFilter:null, unwrittenOcr:{running:false, candidates:[], status:''}};
  const c = vm.createContext({state, showToast(){}, updateChrome(){}, renderUnwrittenOcrCandidates(){}, setUnwrittenOcrStatus(){}, console,
    isOcrUnwrittenFilter:() => false,
    baseProgressPages:() => [1, 3],
    isQuestionCompletedOnPage:() => false,
    pageWithStudentCropSide:page => page + 1,          // 이 문항은 뒷면(짝수 쪽)에 있다
    cropCanvasForPage:async page => { cropped.push(page); return {page}; },
    inkGridFromCanvas:canvas => canvas, inkThumb:() => 'thumb',
    inkRatiosForGrids:grids => grids.map(() => 0), inkShortLimit:() => 0.01,
    inkCandidateReason:() => '미작성 추정', studentTextForPage:page => `${page}쪽`});
  vm.runInContext('async ' + source('runUnwrittenOcrScan'), c);
  await c.runUnwrittenOcrScan();
  assert.deepEqual(cropped, [2, 4]);
  assert.deepEqual([...state.unwrittenOcr.candidates.map(x => x.page)], [1, 3]);
});
