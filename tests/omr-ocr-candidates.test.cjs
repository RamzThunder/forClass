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
const ctx = vm.createContext({normalizeSubValue:value => value, state:{settings:{defaultRejectKeywords:''}}});
['splitKeywords','compactTextWithMap','sourceMatchRanges','rubricCandidateIds','withDefaultRejects','defaultRejectKeywordList','normalizeRubric','detectKeywordsInText','applyKeywordDetection'].forEach(name => vm.runInContext(source(name), ctx));
const rubric = [{id:'r1', name:'인물 비판', sub:'(1)', type:'score', pt:2, accept:'이인국에 대한 비판이다.', ocrKeywords:'비판\n풍자'}];
const candidates = (text, items=rubric, record={}) => [...ctx.rubricCandidateIds(text, items, record)];

test('다르게 쓴 답안도 별도 OCR 키워드로 루브릭 후보를 찾으며 점수는 바꾸지 않는다', () => {
  const record = {scores:{}, keywordHits:{}};
  assert.deepEqual(candidates('소설의 주인공을 비판하고 있다.', rubric, record), ['r1']);
  assert.deepEqual(record, {scores:{}, keywordHits:{}});
  ctx.activeRubric = () => rubric;
  assert.equal(ctx.applyKeywordDetection(record, '소설의 주인공을 비판하고 있다.'), 0);
  assert.deepEqual(record.scores, {});
  assert.deepEqual(record.keywordHits, {});
});

test('여러 키워드는 하나만 있어도 되고 OCR 띄어쓰기 차이도 허용한다', () => {
  assert.deepEqual(candidates('풍 자하고 있다.'), ['r1']);
  assert.deepEqual(candidates('비\n판하고 있다.'), ['r1']);
  assert.deepEqual(candidates('주인공을 묘사하고 있다.'), []);
  assert.deepEqual(candidates(''), []);
});

test('다른 루브릭의 긴 표현이 있어도 해당 항목의 후보 키워드를 누락하지 않는다', () => {
  const items = [...rubric, {id:'r2', ocrKeywords:'주인공을 비판'}];
  assert.deepEqual(candidates('주인공을 비판하고 있다.', items), ['r1','r2']);
});

test('채점 완료·미작성·이미 선택한 항목은 미확정 후보에서 제외된다', () => {
  for(const record of [{completed:true}, {completedSubs:{'(1)':true}}, {unwrittenSubs:{'(1)':true}}, {keywordHits:{r1:{accept:['인정']}}}, {keywordHits:{r1:{reject:['미해당']}}}]){
    assert.deepEqual(candidates('비판', rubric, record), []);
  }
});

test('백업 왕복 및 루브릭 정규화에서 키워드를 보존하고 기존 자료는 빈 값으로 처리한다', () => {
  const restored = ctx.normalizeRubric(JSON.parse(JSON.stringify(rubric)));
  assert.equal(restored[0].ocrKeywords, '비판\n풍자');
  assert.deepEqual(candidates('비판', restored), ['r1']);
  const legacy = ctx.normalizeRubric([{id:'old', name:'기존 항목', accept:'비판'}]);
  assert.equal(legacy[0].ocrKeywords, '');
  assert.deepEqual(candidates('비판', legacy), []);
});

test('키워드를 수정·삭제하면 기존 OCR에서 후보를 새로 계산한다', () => {
  assert.deepEqual(candidates('비판', [{...rubric[0], ocrKeywords:'묘사'}]), []);
  assert.deepEqual(candidates('비판', [{...rubric[0], ocrKeywords:''}]), []);
  assert.deepEqual(candidates('비판', []), []);
});
