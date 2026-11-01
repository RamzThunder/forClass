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
const ctx = vm.createContext({normalizeSubValue:value => value, state:{settings:{defaultRejectKeywords:'',autoAssistEnabled:true}}});
['splitKeywords','compactTextWithMap','sourceMatchRanges','normalizeAcceptOcrKeywords','normalizeOcrLinks','rubricCandidateMatches','withDefaultRejects','defaultRejectKeywordList','normalizeRubric','detectKeywordsInText','applyKeywordDetection'].forEach(name => vm.runInContext(source(name), ctx));
const rubric = [{id:'r1', name:'인물 비판', sub:'(1)', type:'score', pt:2, accept:'이인국에 대한 비판이다.', acceptOcrKeywords:{'이인국에 대한 비판이다.':'비판\n풍자'}}];
const candidates = (text, items=rubric, record={}) => [...ctx.rubricCandidateMatches(text, items, record).keys()];

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
  const items = [...rubric, {id:'r2', accept:'다른 문구', acceptOcrKeywords:{'다른 문구':'주인공을 비판'}}];
  assert.deepEqual(candidates('주인공을 비판하고 있다.', items), ['r1','r2']);
});

test('채점 완료·미작성·이미 선택한 항목은 미확정 후보에서 제외된다', () => {
  for(const record of [{completed:true}, {completedSubs:{'(1)':true}}, {unwrittenSubs:{'(1)':true}}, {keywordHits:{r1:{accept:['이인국에 대한 비판이다.']}}}]){
    assert.deepEqual(candidates('비판', rubric, record), []);
  }
});

test('백업 왕복 및 루브릭 정규화에서 키워드를 보존하고 기존 자료는 빈 값으로 처리한다', () => {
  const restored = ctx.normalizeRubric(JSON.parse(JSON.stringify(rubric)));
  assert.deepEqual(Array.from(restored[0].ocrLinks, link => link.keyword), ['비판','풍자']);
  assert.deepEqual(candidates('비판', restored), ['r1']);
  const legacy = ctx.normalizeRubric([{id:'old', name:'기존 항목', accept:'비판'}]);
  assert.equal(legacy[0].ocrLinks.length, 0);
  assert.deepEqual(candidates('비판', legacy), []);
});

test('키워드를 수정·삭제하면 기존 OCR에서 후보를 새로 계산한다', () => {
  assert.deepEqual(candidates('비판', [{...rubric[0], acceptOcrKeywords:{'이인국에 대한 비판이다.':'묘사'}}]), []);
  assert.deepEqual(candidates('비판', [{...rubric[0], acceptOcrKeywords:{}}]), []);
  assert.deepEqual(candidates('비판', []), []);
});


test('같은 루브릭 안에서도 연결된 인정 문구만 후보로 표시한다', () => {
  const item = {id:'r1', accept:'인물 비판\n사회 풍자', acceptOcrKeywords:{'인물 비판':'비판', '사회 풍자':'풍자'}};
  const matches = ctx.rubricCandidateMatches('주인공을 비판한다', [item]);
  assert.deepEqual([...matches.get('r1')], [JSON.stringify(['accept','인물 비판'])]);
  const selected = {keywordHits:{r1:{accept:['인물 비판']}}};
  assert.deepEqual([...ctx.rubricCandidateMatches('비판과 풍자', [item], selected).get('r1')], [JSON.stringify(['accept','사회 풍자'])]);
});

test('이전 항목 키워드는 인정 문구가 하나일 때만 옮기며 명시적 연결 삭제를 되살리지 않는다', () => {
  assert.equal(ctx.normalizeAcceptOcrKeywords({accept:'인물 비판', ocrKeywords:'비판'})['인물 비판'], '비판');
  assert.equal(Object.keys(ctx.normalizeAcceptOcrKeywords({accept:'A\nB', ocrKeywords:'비판'})).length, 0);
  assert.equal(Object.keys(ctx.normalizeAcceptOcrKeywords({accept:'인물 비판', ocrKeywords:'비판', acceptOcrKeywords:{}})).length, 0);
});


test('OCR 키워드별로 인정과 미인정 문구에 독립 연결하며 동일 문구도 유형을 구분한다', () => {
  const item = {id:'r',accept:'같은 문구',reject:'같은 문구',ocrLinks:[
    {keyword:'비판',type:'accept',phrase:'같은 문구'},
    {keyword:'칭찬',type:'reject',phrase:'같은 문구'}
  ]};
  assert.deepEqual([...ctx.rubricCandidateMatches('비판', [item]).get('r')], [JSON.stringify(['accept','같은 문구'])]);
  assert.deepEqual([...ctx.rubricCandidateMatches('칭찬', [item]).get('r')], [JSON.stringify(['reject','같은 문구'])]);
  const selected={keywordHits:{r:{accept:['같은 문구']}}};
  assert.deepEqual([...ctx.rubricCandidateMatches('비판 칭찬', [item], selected).get('r')], [JSON.stringify(['reject','같은 문구'])]);
});

test('감점용 루브릭도 OCR 후보를 표시한다', () => {
  const item={id:'d',type:'deduct',reject:'오개념',ocrLinks:[{keyword:'틀린표현',type:'reject',phrase:'오개념'}]};
  assert.equal(ctx.rubricCandidateMatches('틀린 표현', [item]).get('d').size,1);
});

test('실험실 기능을 끄면 후보를 계산하지 않으며 다시 켜도 연결은 유지된다', () => {
  const before=JSON.stringify(rubric);
  ctx.state.settings.autoAssistEnabled=false;
  assert.equal(ctx.rubricCandidateMatches('비판',rubric).size,0);
  ctx.state.settings.autoAssistEnabled=true;
  assert.equal(ctx.rubricCandidateMatches('비판',rubric).size,1);
  assert.equal(JSON.stringify(rubric),before);
});

test('삭제된 연결 대상은 후보로 표시하지 않으며 키워드는 재연결용으로 보존한다', () => {
  const item={id:'r',accept:'현재 문구',ocrLinks:[{keyword:'비판',type:'accept',phrase:'삭제 문구'}]};
  const links=ctx.normalizeOcrLinks(item);
  assert.equal(links[0].keyword,'비판');
  assert.equal(links[0].type,'');
  assert.equal(ctx.rubricCandidateMatches('비판',[item]).size,0);
});

test('새 연결을 모두 삭제한 후 이전 버전의 연결이 되살아나지 않는다', () => {
  assert.equal(ctx.normalizeOcrLinks({...rubric[0],ocrLinks:[]}).length,0);
});
