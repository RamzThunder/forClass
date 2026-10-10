const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../logical-speaking-grader.html'),'utf8');
const c=vm.createContext({referenceExamples:[]});
vm.runInContext(html.slice(html.indexOf('function conceptTermGroups('),html.indexOf('function safeFileName(')),c);
test('필수 조건은 모두 충족해야 하며 대체 표현은 하나만 있어도 충족한다',()=>{
  const option={requiredTerms:['물','선택적 투과성 막 / 반투과성 막']};
  const result=c.conceptReviewHTML('물이 반투과성 막을 통과한다.',option);
  assert.match(result,/필수 조건 2\/2 충족/);
  assert.match(result,/<mark>물<\/mark>/);
  assert.match(result,/<mark>반투과성 막<\/mark>/);
  assert.match(c.conceptReviewHTML('물만 설명',option),/필수 조건 1\/2 충족/);
  assert.equal(c.hasConceptRules({requiredTerms:[' / ',' ']}),false);
});
test('용어는 항목별로 검사하고 공통 예문은 모든 항목에 적용한다',()=>{
  const first={requiredTerms:['삼투'],referenceExamples:['물이 이동한다.']};
  const second=JSON.parse(JSON.stringify({requiredTerms:['확산'],referenceExamples:['입자가 이동한다.']}));
  c.referenceExamples=['물이 이동한다.'];
  assert.match(c.conceptReviewHTML('삼투: 물이 이동한다.',first),/등록 예문 1개와 일치/);
  const result=c.conceptReviewHTML('삼투: 물이 이동한다.',second);
  assert.match(result,/필수 조건 0\/1 충족/);
  assert.match(result,/등록 예문 1개와 일치/);
  c.referenceExamples=[];
  assert.ok(!result.includes('✓ 포함'));
});
test('메모를 켠 항목만 용어·공통 예문을 표시하고 끄면 기준을 보존한다',()=>{
  Object.assign(c,{critScore:()=>0,checksOf:()=>[],detailItems:()=>[],detailBadgesHTML:()=>'',memoLabelsFor:()=>['근거 메모'],optMemoValue:(om,oi)=>om[oi]||''});
  vm.runInContext(html.slice(html.indexOf('function critHTML('),html.indexOf('function collectMemos(')),c);
  vm.runInContext(html.slice(html.indexOf('function conceptEditorHTML('),html.indexOf('function memoEditorHTML(')),c);
  const option={desc:'개념 설명',pt:2,requiredTerms:['삼투'],memo:true};
  c.referenceExamples=['삼투'];
  const render=()=>c.critHTML({optmemos:{0:{0:'삼투'}}},{name:'개념',opts:[option]},0);
  const result=render();
  assert.match(result,/등록 예문 1개와 일치/);
  assert.match(c.conceptEditorHTML(option,0,0),/concept-setting/);
  option.memo=false;
  assert.ok(!render().includes('class="optmemo"'));
  assert.ok(!render().includes('concept-review'));
  assert.equal(c.conceptEditorHTML(option,0,0),'');
  assert.deepEqual(option.requiredTerms,['삼투']);
  option.memo=true;
  assert.match(render(),/필수 조건 1\/1 충족/);
  c.referenceExamples=[];
  assert.match(result,/class="optmemo"/);assert.match(result,/필수 조건 1\/1 충족/);
  assert.match(result,/data-ci="0" data-oi="0" data-mi="0"/);
});

test('기존 항목별 예문을 공통으로 합치며 삭제한 예문이 다시 생기지 않는다',()=>{
  const criteria=[{opts:[{referenceExamples:['예문 A','예문 B'],requiredTerms:['물']}]},{opts:[{referenceExamples:['예문 B']}]}];
  assert.equal(JSON.stringify(c.migrateCommonExamples(['예문 A'],criteria)),JSON.stringify(['예문 A','예문 B']));
  assert.equal(criteria[0].opts[0].referenceExamples,undefined);
  assert.equal(criteria[0].opts[0].requiredTerms[0],'물');
  assert.equal(c.migrateCommonExamples([],criteria).length,0);
});
