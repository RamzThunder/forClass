const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../logical-speaking-grader.html'),'utf8');
function setup(getUserMedia){
  const oldTrack={label:'MacBook',readyState:'live',stop(){this.stopped=true;}};
  const hub={stream:{getAudioTracks:()=>[oldTrack],getTracks:()=>[oldTrack]},ctx:{close:()=>Promise.resolve()},users:new Set(['auto']),raf:1};
  const elements={microphoneSelect:{value:'comica'},microphoneStatus:{},activeMicrophone:{}};
  const c=vm.createContext({audioHub:hub,navigator:{mediaDevices:{getUserMedia}},localStorage:{getItem:()=>'',setItem(){}},document:{getElementById:id=>elements[id]},timer:{running:false,countdown:null},rec:{recorder:null},mic:{},toast(){},Uint8Array,window:{AudioContext:class{createAnalyser(){return {frequencyBinCount:256};}createMediaStreamSource(){return {connect(){}};}resume(){return Promise.resolve();}close(){return Promise.resolve();}}}});
  vm.runInContext(html.slice(html.indexOf("let selectedMicrophone="),html.indexOf('function micErrorMessage(')),c);
  c.refreshMicrophoneList=async()=>{};
  return {c,hub,oldTrack,elements};
}
test('오디오 옵션을 완화해도 선택한 장치는 유지한다',async()=>{
  const calls=[];
  const {c}=setup(async constraints=>{calls.push(constraints);if(calls.length===1)throw Object.assign(new Error(),{name:'OverconstrainedError'});return {};});
  await c.requestMicrophone('comica');
  assert.equal(calls.length,2);
  for(const call of calls)assert.equal(call.audio.deviceId.exact,'comica');
});
test('녹음 중에는 마이크를 변경하지 않는다',async()=>{
  let calls=0;const {c,oldTrack}=setup(async()=>{calls++;});
  c.rec.recorder={state:'recording'};
  await c.applyMicrophone();assert.equal(calls,0);assert.equal(oldTrack.stopped,undefined);
});
test('연결 실패 시 기존 입력을 유지한다',async()=>{
  const {c,hub,oldTrack}=setup(async()=>{throw new Error('unplugged');});
  const previous=hub.stream;await c.applyMicrophone();
  assert.equal(hub.stream,previous);assert.equal(oldTrack.stopped,undefined);
});
test('외부 마이크 연결 성공 시 이전 입력을 해제하고 실제 장치명을 표시한다',async()=>{
  const track={label:'Comica',readyState:'live'};
  const stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
  const {c,hub,oldTrack,elements}=setup(async()=>stream);
  await c.applyMicrophone();
  assert.equal(hub.stream,stream);assert.equal(oldTrack.stopped,true);
  assert.match(elements.activeMicrophone.textContent,/Comica/);
  assert.equal(hub.users.has('auto'),true);
});
