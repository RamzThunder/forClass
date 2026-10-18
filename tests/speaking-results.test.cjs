const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../logical-speaking-grader.html'),'utf8');
function setup(){
  const ctx=vm.createContext({classes:['10','2','1','3'],currentClass:'2',classStudents:{'10':[{no:1,name:'열반'}],'1':[{no:2,name:'일반'}],'2':[{no:99,name:'옛명단'}],'3':[]},state:{rubric:[],students:[{no:10,name:'십번',memo:'쉼표, "인용"'},{no:2,name:'이번',absent:true}]},selectionMode:'topic',rubricMax:()=>10,studentTotal:()=>5,rubricForStudent:()=>[],topicFull:()=>'',paperStatusText:()=>'',gradeOf:()=> 'C',clsLabel:c=>c});
  ctx.sortedStudents=()=>ctx.state.students;
  vm.runInContext(html.slice(html.indexOf('function fullTsv('),html.indexOf('\nfunction copy(',html.indexOf('function fullTsv('))),ctx);
  return ctx;
}
test('전체 반은 반·번호 숫자순으로 정렬하고 현재 명단과 발표 순서를 보존한다',()=>{
  const c=setup(),before=JSON.stringify([c.classes,c.classStudents,c.state]);
  const rows=JSON.parse(JSON.stringify(c.allClassResultRows()));
  assert.deepEqual(rows.slice(1).map(r=>[r[0],r[2]]),[['1',2],['2',2],['2',10],['10',1]]);
  assert.deepEqual(rows.slice(1).map(r=>r[1]),[1,2,1,1]);
  rows.forEach(r=>assert.equal(r.length,rows[0].length));
  assert.ok(rows[2].includes('발표안함'));
  assert.equal(JSON.stringify([c.classes,c.classStudents,c.state]),before);
});
test('CSV는 쉼표·따옴표·줄바꿈을 한 셀 안에 보존한다',()=>{
  const c=setup();
  assert.equal(c.resultCsv([['반','근거'],['2','쉼표, "인용"\n다음 줄']]),'"반","근거"\r\n"2","쉼표, ""인용""\n다음 줄"');
  assert.match(c.resultCsv(c.allClassResultRows()),/쉼표, ""인용""/);
});
test('인쇄용 HTML은 채점대상 반의 학생과 총점만 담고 원래 순서를 보존한다',()=>{
  const c=setup();
  c.speakingClasses=()=>['10','2','3'];
  c.appTitle='수행 <평가>';
  c.esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  c.state.students[0].name='<script>학생</script>';
  c.state.students[0].memo='비공개 총평';
  const before=JSON.stringify(c.state);
  const printed=c.buildScorePrintHtml();
  assert.ok(printed.indexOf('<h2>2반')<printed.indexOf('<h2>10반'));
  assert.ok(printed.indexOf('2번 이번')<printed.indexOf('10번 &lt;script&gt;학생'));
  assert.ok(!printed.includes('<h2>1반'));
  assert.ok(!printed.includes('<h2>3반'));
  assert.ok(!printed.includes('비공개 총평'));
  assert.ok(!printed.includes('옛명단'));
  assert.ok(!printed.includes('<script>'));
  assert.match(printed,/<th scope="col">학생<\/th><th scope="col">총점<\/th>/);
  assert.match(printed,/<td>5<\/td>/);
  assert.match(printed,/section\+section\{break-before:page\}/);
  assert.equal(JSON.stringify(c.state),before);
});
