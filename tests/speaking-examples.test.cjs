const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../logical-speaking-grader.html'),'utf8');
const c=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function normalizeExampleText('),html.indexOf('function normalizeRequiredTerms(')),c);
vm.runInContext(html.slice(html.indexOf('function esc('),html.indexOf('\n',html.indexOf('function esc('))),c);
test('전체 예문을 발언 안에서 찾고 연속 공백·줄바꿈을 정규화한다',()=>{
  assert.equal(c.matchingExamples('예를 들면 “나는\n  학교에 간다.”라고 말했습니다.',['나는 학교에 간다.']).length,1);
  assert.equal(c.matchingExamples('나는 학교에 간다.',['나는 학교에 간다.',' 나는  학교에 간다. ']).length,1);
});
test('단어를 바꾸거나 부분만 입력한 발언은 예문과 일치하지 않는다',()=>{
  for(const text of ['나는 도서관에 간다.','나는 학교에','너와나는 학교에 간다.'])assert.equal(c.matchingExamples(text,['나는 학교에 간다.']).length,0);
  assert.equal(c.matchingExamples('나는 학교에 간다고',['나는 학교에 간다']).length,0);
  assert.equal(c.matchingExamples('나는 학교에 간다',['나는 학교에 간다.']).length,0);
});
test('입력 대기와 일치 없음 상태를 구분하고 예문 HTML은 이스케이프한다',()=>{
  assert.match(c.exampleReviewHTML('', ['예문']),/입력하면/);
  assert.match(c.exampleReviewHTML('다른 말',['예문']),/일치하는 부분 없음/);
  const output=c.exampleReviewHTML('<img src=x>', ['<img src=x>']);
  assert.match(output,/&lt;img src=x&gt;/);assert.ok(!output.includes('<img'));
});
