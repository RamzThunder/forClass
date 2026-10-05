const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../logical-speaking-grader.html'),'utf8');
function setup(max){
  const student={checks:{}};
  const context=vm.createContext({state:{okMin:150,okMax:max},timer:{elapsed:0},effectiveTime:()=>context.timer.elapsed,curStudent:()=>student,rubricForStudent:()=>[{opts:[{timed:true}]}]});
  vm.runInContext(html.slice(html.indexOf('function fmt(sec)'),html.indexOf('function parseMS(')),context);
  vm.runInContext(html.slice(html.indexOf('function inOkRange('),html.indexOf('function refreshJudge(')),context);
  return {context,student};
}
test('상한 없이 최소 시간부터 자동 체크하며 긴 발표에도 유지한다',()=>{
  const {context:c,student}=setup(null);
  assert.match(c.timeJudgeText(),/2:30 이상/);
  for(const [seconds,expected] of [[149,false],[150,true],[151,true],[3600,true],[149,false]]){
    c.timer.elapsed=seconds;c.applyTimeJudge();
    assert.equal(c.inOkRange(seconds),expected);
    assert.equal(student.checks[0].includes(0),expected);
  }
});
test('최대 시간을 지정하면 기존처럼 상한 초과 시 체크를 해제한다',()=>{
  const {context:c,student}=setup(180);
  for(const [seconds,expected] of [[149,false],[150,true],[180,true],[181,false]]){
    c.timer.elapsed=seconds;c.applyTimeJudge();
    assert.equal(student.checks[0].includes(0),expected);
  }
});
test('상한 없음은 JSON 저장 후에도 유지된다',()=>{
  const loaded=JSON.parse(JSON.stringify({okMax:null}));
  const c=vm.createContext({state:{},sh:loaded});
  const assignment=html.match(/state\.okMax=sh\.okMax[^;]+;/)[0];
  vm.runInContext(assignment,c);assert.equal(c.state.okMax,null);
  c.sh={};vm.runInContext(assignment,c);assert.equal(c.state.okMax,180);
});
