const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../logical-speaking-grader.html'),'utf8');
test('전체 5분에 진행 중 제외 시간을 확정하고 녹음·타이머를 종료한다',()=>{
  const student={};let stopped=false;
  const c=vm.createContext({autoFinishPresentation:true,PRESENTATION_LIMIT:300,fmt:s=>String(s),timer:{elapsed:300,running:true,countdown:null,excludes:[],exRunning:true,exStart:260},mic:{},document:{getElementById:()=>null},clearInterval:()=>{},blockIfTimerLocked:()=>{throw Error('자동 종료가 잠금에 막히면 안 됨');},stopRecording:()=>{stopped=true;},curStudent:()=>student,previewMode:false,stashRecordedTimeInMemo:()=>{},applyTimeJudge:()=>{},save:()=>{},renderRoster:()=>{},renderStage:()=>{},castState:()=>{},toast:()=>{}});
  vm.runInContext(html.slice(html.indexOf('const EXCLUDE_THRESHOLD='),html.indexOf('function inOkRange(')),c);
  vm.runInContext(html.slice(html.indexOf('function finishPresentation('),html.indexOf('function toggleExclude(')),c);
  c.finishPresentation(true);
  assert.equal(student.recordedTime.total,300);assert.equal(student.recordedTime.eff,260);assert.equal(student.recordedTime.excluded,40);
  assert.equal(c.timer.running,false);assert.equal(c.timer.exRunning,false);assert.equal(stopped,true);
});
test('늦게 실행된 타이머도 전체 시간을 300초로 제한한다',()=>{
  let tick,now=0,ended=false;
  const c=vm.createContext({autoFinishPresentation:true,performance:{now:()=>now},PRESENTATION_LIMIT:300,timer:{elapsed:299},setInterval:fn=>{tick=fn;return 1;},finishPresentation:automatic=>{ended=automatic;}});
  const start=html.indexOf('      const startedAt=performance.now(),elapsedAtStart=timer.elapsed;');
  vm.runInContext(html.slice(start,html.indexOf('      },100);',start)+'      },100);'.length),c);
  now=10000;tick();assert.equal(c.timer.elapsed,300);assert.equal(ended,true);
});

test('설정한 전체 제한으로 자동 종료 시점을 변경한다',()=>{
  let tick,now=0,ended=false;
  const c=vm.createContext({autoFinishPresentation:true,performance:{now:()=>now},PRESENTATION_LIMIT:420,timer:{elapsed:419},setInterval:fn=>{tick=fn;return 1;},finishPresentation:automatic=>{ended=automatic;}});
  const start=html.indexOf('      const startedAt=performance.now(),elapsedAtStart=timer.elapsed;');
  vm.runInContext(html.slice(start,html.indexOf('      },100);',start)+'      },100);'.length),c);
  now=2000;tick();assert.equal(c.timer.elapsed,420);assert.equal(ended,true);
});

test('자동 종료를 끄면 제한 시간을 넘어도 타이머가 계속된다',()=>{
  let tick,now=0,ended=false;
  const c=vm.createContext({autoFinishPresentation:false,performance:{now:()=>now},PRESENTATION_LIMIT:300,timer:{elapsed:299},setInterval:fn=>{tick=fn;return 1;},finishPresentation:()=>{ended=true;},document:{getElementById:()=>({classList:{toggle:()=>{}}})},effectiveTime:()=>309,inOkRange:()=>true,state:{okMin:150,okMax:null},fmt:String,refreshJudge:()=>{},refreshElapsedDisplay:()=>{},castState:()=>{}});
  const start=html.indexOf('      const startedAt=performance.now(),elapsedAtStart=timer.elapsed;');
  vm.runInContext(html.slice(start,html.indexOf('      },100);',start)+'      },100);'.length),c);
  now=10000;tick();assert.equal(c.timer.elapsed,309);assert.equal(ended,false);
});
