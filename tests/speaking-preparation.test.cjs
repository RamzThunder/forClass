const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../logical-speaking-grader.html'),'utf8');
function setup(){
  let now=0;
  const c=vm.createContext({preparationSeconds:30,fmt:s=>String(s),performance:{now:()=>now},document:{getElementById:()=>null},setInterval:()=>1,clearInterval:()=>{},curStudent:()=>({}),timer:{running:false,countdown:null},castState:()=>{},toast:()=>{}});
  vm.runInContext(html.slice(html.indexOf('const preparation='),html.indexOf('let timer={')),c);
  return {c,advance:ms=>{now+=ms;},remaining:()=>vm.runInContext('preparation.remaining',c)};
}
test('준비 시간은 일시정지 중 유지되며 재개 후 0에서 종료한다',()=>{
  const {c,advance,remaining}=setup();
  c.togglePreparation();advance(12500);c.tickPreparation();assert.equal(remaining(),17500);
  c.togglePreparation();advance(5000);assert.equal(remaining(),17500);
  c.togglePreparation();advance(18000);c.tickPreparation();assert.equal(remaining(),0);
  assert.equal(vm.runInContext('preparation.handle',c),null);
  assert.equal(c.timer.running,false);
  c.togglePreparation();assert.equal(remaining(),30000);
  c.resetPreparation();assert.equal(vm.runInContext('preparation.deadline',c),null);
});
test('발표 중이거나 완료·미응시 학생이면 준비 타이머를 시작하지 않는다',()=>{
  const {c}=setup();
  c.timer.running=true;c.togglePreparation();assert.equal(vm.runInContext('preparation.deadline',c),null);
  c.timer.running=false;
  for(const student of [{done:true},{absent:true},null]){
    c.curStudent=()=>student;c.togglePreparation();assert.equal(vm.runInContext('preparation.deadline',c),null);
  }
});

test('변경한 준비 시간을 초기화와 재시작에 적용한다',()=>{
  const {c,advance,remaining}=setup();
  c.preparationSeconds=45;c.resetPreparation();assert.equal(remaining(),45000);
  c.togglePreparation();advance(45000);c.tickPreparation();assert.equal(remaining(),0);
  c.togglePreparation();assert.equal(remaining(),45000);
});
