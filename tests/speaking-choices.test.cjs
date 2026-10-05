const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../logical-speaking-grader.html'),'utf8');
function setup(){
  const sets=[1,4,2,3,5].map(n=>Array.from({length:n},(_,i)=>({name:`선택문제 ${i+1}`,prompt:`문제 ${i+1}`,base:0,opts:[]})));
  const c=vm.createContext({choiceSets:sets,choiceSetTitles:['첫 제목','둘째 제목'],selectionMode:'draw',state:{rubric:[]},paperStatusText:()=>'',topicFull:()=>'',optMemoText:()=>'',fmt:()=>'',gradeOf:()=>''});
  vm.runInContext(html.slice(html.indexOf('function choiceSetTitle('),html.indexOf('\nlet timer=')),c);
  vm.runInContext(html.slice(html.indexOf('function checksOf('),html.indexOf('function gradeOf(')),c);
  vm.runInContext(html.slice(html.indexOf('function fullTsv('),html.indexOf('\nfunction copy(',html.indexOf('function fullTsv('))),c);
  return c;
}
test('각 뽑기의 가변 문제 수와 제목을 선택 상태에 맞춰 반환한다',()=>{
  const c=setup();
  assert.equal(c.choiceRubric({choiceSet:0}).length,1);
  assert.equal(c.choiceRubric({choiceSet:1}).length,4);
  assert.equal(c.choiceQuestionNumbers().length,5);
  assert.equal(c.choiceSetTitle({choiceSet:1}),'둘째 제목');
  assert.equal(c.choiceSetTitle({choiceSet:null}),'');
  c.selectionMode='topic';assert.equal(c.choiceSetTitle({choiceSet:0}),'');
});
test('문제 수가 서로 다르고 뽑기를 선택하지 않아도 TSV 열 수는 일치한다',()=>{
  const c=setup();
  c.state.students=[0,1,4,null].map((choiceSet,i)=>({no:i+1,name:'학생',choiceSet,checks:{}}));
  c.sortedStudents=()=>c.state.students;
  const rows=c.fullTsv().split('\n').map(row=>row.split('\t'));
  rows.forEach(row=>assert.equal(row.length,rows[0].length));
  assert.ok(rows[0].includes('선택문제 5 내용'));
});

test('개별 문제 제목을 유지하고 빈 제목만 기본 이름으로 보완한다',()=>{
  const c=setup();
  assert.equal(c.choiceQuestionTitle({name:'  문장의 짜임 탐구  '},0),'문장의 짜임 탐구');
  assert.equal(c.choiceQuestionTitle({name:'   '},3),'선택문제 4');
  assert.equal(c.choiceQuestionTitle({},1),'선택문제 2');
  c.choiceSets[0][0].name='직접 정한 제목';
  assert.equal(c.choiceRubric({choiceSet:0})[0].name,'직접 정한 제목');
});
