const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../logical-speaking-grader.html'),'utf8');
test('공유 명렬 스크립트는 외부 파일 없이 다시 실행할 수 있다',()=>{
  const c=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared-roster.js'),'utf8'),c);
  const standalone=vm.createContext({window:{}});
  vm.runInContext(c.SharedRosterStandaloneSource,standalone);
  assert.equal(typeof standalone.window.SharedRoster.parse,'function');
  assert.ok(standalone.window.SharedRosterStandaloneSource);
});
test('HTML에 넣는 JSON은 스크립트 종료 문자열도 안전하게 보존한다',()=>{
  const c=vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('function sharePayloadJson('),html.indexOf('function buildSharedHtml(')),c);
  const data={title:'</script><script>alert(1)</script>',memo:'한글 & 메모'};
  const encoded=c.sharePayloadJson(data,'id');
  assert.ok(!encoded.includes('<'));
  assert.deepEqual(JSON.parse(encoded),{id:'id',data});
});
test('공유본 첫 실행은 내장 데이터를, 재실행은 새로 저장한 데이터를 사용한다',()=>{
  const source=html.slice(html.indexOf('function load(){'),html.indexOf('function switchClass('));
  const c=vm.createContext({EMBEDDED_SHARE:{data:{title:'공유본'}},LS:'shared',LS_MIRROR:'mirror',localStorage:{getItem:()=>null},applyLoaded:data=>{c.loaded=data;}});
  vm.runInContext(source,c);c.load();assert.equal(c.loaded.title,'공유본');
  c.localStorage.getItem=key=>key==='shared'?JSON.stringify({title:'수정본',savedAt:10}):null;
  c.load();assert.equal(c.loaded.title,'수정본');
});
