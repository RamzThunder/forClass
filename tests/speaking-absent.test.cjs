const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../logical-speaking-grader.html'),'utf8');
test('미응시 상태에서는 해제 버튼만 채점 잠금에서 제외한다',()=>{
  const elements=['absentBtn','doneBtn','rubricOption'].map(id=>({id,disabled:false}));
  const ctx=vm.createContext({document:{getElementById:()=>({querySelectorAll:()=>elements})}});
  vm.runInContext(html.slice(html.indexOf('function applyStudentLock('),html.indexOf('function renderStage(')),ctx);
  ctx.applyStudentLock({done:true,absent:true});
  assert.equal(elements[0].disabled,false);
  assert.equal(elements[2].disabled,true);
  ctx.applyStudentLock({done:true,absent:false});
  assert.equal(elements[0].disabled,true);
});
test('미응시 처리 후 해제하면 완료 잠금도 해제하여 재채점할 수 있다',()=>{
  const button={};
  const ctx=vm.createContext({s:{absent:false,done:false,checks:{0:[0]}},document:{getElementById:()=>button},save(){},renderRoster(){},renderStage(){},toast(){},rubricMin:()=>0});
  const start=html.indexOf("  document.getElementById('absentBtn').onclick=");
  vm.runInContext(html.slice(start,html.indexOf("  document.getElementById('simpleBtn')",start)),ctx);
  button.onclick();assert.equal(ctx.s.absent,true);assert.equal(ctx.s.done,true);
  button.onclick();assert.equal(ctx.s.absent,false);assert.equal(ctx.s.done,false);
});
