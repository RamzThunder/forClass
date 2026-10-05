const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../logical-speaking-grader.html'),'utf8');
const ctx=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function moveRubricEntry('),html.indexOf('function remapAllRubricRecords(')),ctx);
const clone=x=>JSON.parse(JSON.stringify(x));
test('하위 항목 이동 시 연계 조건도 원래 항목을 따라간다',()=>{
  const c={opts:[{optionId:'a'},{optionId:'b'},{optionId:'c',requires:[0,1]}]};
  ctx.moveRubricOption(c,0,2);
  assert.deepEqual(clone(c.opts.map(o=>o.optionId)),['b','c','a']);
  assert.deepEqual(clone(c.opts[1].requires),[2,0]);
  ctx.moveRubricOption(c,0,-1);
  assert.deepEqual(clone(c.opts.map(o=>o.optionId)),['b','c','a']);
});
test('루브릭·하위 항목 이동 후 점수 기록과 메모를 항목별로 보존한다',()=>{
  const old=[{rubricId:'a',opts:[{optionId:'x'},{optionId:'y'}]},{rubricId:'b',opts:[{optionId:'z'}]},{rubricId:'choice',opts:[{optionId:'q'}]}];
  const next=[clone(old[1]),{rubricId:'a',opts:[{optionId:'y'},{optionId:'x'}]},clone(old[2])];
  const student={checks:{0:[1],1:[0],2:[0]},cmemos:{0:'A',1:'B',2:'선택'},optmemos:{0:{1:['메모']},2:{0:'선택 메모'}},detailChecks:{stable:true}};
  ctx.remapRubricRecords(student,old,next);
  assert.deepEqual(clone(student.checks),{0:[0],1:[0],2:[0]});
  assert.deepEqual(clone(student.cmemos),{0:'B',1:'A',2:'선택'});
  assert.deepEqual(clone(student.optmemos),{1:{0:['메모']},2:{0:'선택 메모'}});
  assert.deepEqual(student.detailChecks,{stable:true});
  const saved=clone(student);ctx.remapRubricRecords(student,next,next);
  assert.deepEqual(clone(student),saved);
});
test('추가·삭제와 순서 변경이 섞여도 새 항목에 옛 기록이 붙지 않는다',()=>{
  const old=[{rubricId:'removed',opts:[]},{rubricId:'keep',opts:[{optionId:'gone'},{optionId:'stay'}]}];
  const next=[{rubricId:'keep',opts:[{optionId:'stay'},{optionId:'new'}]},{rubricId:'new',opts:[]}];
  const student={checks:{1:[0,1]},cmemos:{0:'삭제',1:'유지'}};
  ctx.remapRubricRecords(student,old,next);
  assert.deepEqual(clone(student.checks),{0:[0]});
  assert.deepEqual(clone(student.cmemos),{0:'유지'});
});

test('순서를 바꿔도 수동 입력 시간은 해당 항목에 유지된다',()=>{
  const old=[{rubricId:'a',opts:[{optionId:'x'},{optionId:'y'}]}];
  const next=[{rubricId:'a',opts:[{optionId:'y'},{optionId:'x'}]}];
  const student={timedValues:{0:{0:150,1:null}}};
  ctx.remapRubricRecords(student,old,next);
  assert.deepEqual(clone(student.timedValues),{0:{0:null,1:150}});
});
