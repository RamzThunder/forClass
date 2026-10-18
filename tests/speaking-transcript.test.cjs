const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../logical-speaking-grader.html'),'utf8');
function setup(extra={}){
  const writes=[],audio=[];
  const popup={closed:false,document:{open(){},write(s){writes.push(s)},close(){}},buildPlayer(...args){audio.push(args)}};
  let opens=0;
  const ctx=vm.createContext({window:{open(){opens++;return popup}},currentClass:'1',previewMode:false,baseDirHandle:null,toast(){},JSON,URL:{revokeObjectURL(){}},...extra});
  vm.runInContext(html.slice(html.indexOf('let transcriptPopup='),html.indexOf('/* ===== 전사본 연결 ===== */')),ctx);
  return {ctx,popup,writes,audio,get opens(){return opens}};
}
test('열린 팝업은 학생 이동과 잠금 변경을 따라가며 닫은 팝업은 다시 열지 않는다',async()=>{
  const x=setup();
  const a={id:'a',no:1,name:'가',transcript:'첫 전사'};
  const b={id:'b',no:2,name:'나',transcript:null,done:true};
  x.ctx.syncTranscriptPopup(a);assert.equal(x.opens,0);
  await x.ctx.openTranscriptPopup(a);
  x.ctx.syncTranscriptPopup(b);
  assert.equal(x.opens,1);
  assert.match(x.writes.at(-1),/2번 나/);
  assert.match(x.writes.at(-1),/var initialText=""/);
  assert.match(x.writes.at(-1),/var locked=true/);
  const count=x.writes.length;x.ctx.syncTranscriptPopup(b);assert.equal(x.writes.length,count);
  x.ctx.syncTranscriptPopup(null);assert.match(x.writes.at(-1),/학생을 선택/);
  x.ctx.syncTranscriptPopup(a);assert.match(x.writes.at(-1),/첫 전사/);
  x.popup.closed=true;x.ctx.syncTranscriptPopup(b);assert.equal(x.opens,1);
});
test('음원 검색을 기다리지 않고 전사본을 즉시 전환한다',async()=>{
  let release;
  const x=setup({baseDirHandle:{queryPermission:()=>new Promise(r=>{release=r})}});
  const pending=x.ctx.openTranscriptPopup({id:'a',no:1,name:'가',transcript:'즉시 표시'});
  assert.match(x.writes.at(-1),/즉시 표시/);
  x.ctx.baseDirHandle=null;
  await x.ctx.openTranscriptPopup({id:'b',no:2,name:'나',transcript:'다음 학생'},x.popup);
  release('denied');await pending;
  assert.match(x.writes.at(-1),/다음 학생/);
  assert.equal(x.audio.length,0);
});
