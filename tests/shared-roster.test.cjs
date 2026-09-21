const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../shared-roster.js');
const fixture = '\ufeff학년,반,번호,성명,비고\r\n3,4,25,학생가,\r\n3,4,27,학생나,"메모, 여러 줄\n내용"\r\n3,4,31,학생다,\r\n';

test('학교 CSV: 학년/반/성명 열 인식, 결번과 31번 유지',()=>{
  const students = R.parse(fixture);
  assert.deepEqual(students.map(s=>s.number),[25,27,31]);
  assert.equal(students[0].className,'3-4');
  assert.equal(students[1].name,'학생나');
});
test('열 순서, BOM, TSV, 동명이인과 여러 학년 구분',()=>{
  const students = R.parse('이름\t번호\t반\t학년\n동명\t02\t1\t3\n동명\t2\t1\t2');
  assert.deepEqual(students.map(s=>[s.className,s.number]),[['2-1',2],['3-1',2]]);
});
test('잘못된 파일과 중복 번호는 일부만 적용하지 않고 거부',()=>{
  for(const text of ['', '학년,반,번호,성명', '반,번호,성명\n1,2,A\n1,2,B', '반,번호,성명\n1,0,A', '반,번호,성명\n1,2,', '반,번호,성명\n1,2,"A'])
    assert.throws(()=>R.parse(text));
});
test('글쓰기: 결번은 null, 같은 반·번호·이름의 점수만 보존',()=>{
  const data = {students:R.parse(fixture)};
  const previous = {'4':[{num:25,name:'학생가',score:90},{num:27,name:'다른학생',score:100}]};
  const result = R.project(data,previous,s=>({name:s.name,score:0}),true)['3-4'];
  assert.equal(result[24].score,90);
  assert.equal(result[25],null);
  assert.equal(result[26].num,27);
  assert.equal(result[26].score,0);
  assert.equal(result[30].num,31);
});
test('말하기: 압축된 배열에서도 원래 번호와 녹음 ID/채점 내용 보존',()=>{
  const data={students:R.parse(fixture)};
  const old={'3-4':[{no:27,name:'학생나',id:'recording-id',memo:'보존',done:true}]};
  const list=R.project(data,old,s=>({name:s.name,done:false}))['3-4'];
  assert.deepEqual(list.map(s=>s.no),[25,27,31]);
  assert.equal(list[1].id,'recording-id');
  assert.equal(list[1].memo,'보존');
});
test('여러 학년일 때 학년 없는 과거 점수를 추측하여 옮기지 않음',()=>{
  const data={students:R.parse('학년,반,번호,성명\n2,1,1,A\n3,1,1,A')};
  const result=R.project(data,{'1':[{no:1,name:'A',score:100}]},s=>({name:s.name,score:0}));
  assert.equal(result['2-1'][0].score,0);assert.equal(result['3-1'][0].score,0);
});
test('UTF-8 및 CP949 파일 읽기',async()=>{
  const utf=Buffer.from(fixture);
  assert.equal((await R.readFile({arrayBuffer:async()=>utf.buffer.slice(utf.byteOffset,utf.byteOffset+utf.length)})).length,3);
  const bytes=Buffer.from([0xb9,0xdd,44,0xb9,0xf8,0xc8,0xa3,44,0xbc,0xba,0xb8,0xed,10,49,44,50,55,44,65]);
  assert.equal((await R.readFile({arrayBuffer:async()=>bytes}))[0].number,27);
});
test('폴더의 예시 CSV를 원본 행과 대조 (개인 정보는 테스트 출력에 포함하지 않음)',()=>{
  const folder=path.join(__dirname,'..');
  const files=fs.readdirSync(folder).filter(f=>f.endsWith('.csv'));
  for(const file of files){
    const text=fs.readFileSync(path.join(folder,file),'utf8');
    const original=R.rows(text).slice(1), students=R.parse(text);
    assert.equal(students.length,original.length);
    for(const row of original){assert.ok(students.some(s=>s.grade===row[0]&&s.classNumber===row[1]&&s.number===Number(row[2])&&s.name===row[3]));}
    const writing=R.project({students},{},s=>({name:s.name}),true);
    const speaking=R.project({students},{},s=>({name:s.name}));
    for(const s of students){assert.equal(writing[s.className][s.number-1].num,s.number);assert.ok(speaking[s.className].some(x=>x.no===s.number&&x.name===s.name));}
  }
});
test('OMR: 명렬 변경 시 기존 답안 페이지의 학생 연결 보존',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../omr-grader.html'),'utf8');
  const code=html.slice(html.indexOf('function applySharedOmrRoster('),html.indexOf('\nfunction parseRoster(text)'));
  const old=[{className:'4',number:'25',name:'학생가'},{className:'4',number:'27',name:'학생나'}];
  const state={roster:old,records:{1:{},2:{}},missingRosterKeys:[]};
  const context={state,SharedRoster:{backup(){}},STORAGE_KEY:'test',els:{rosterText:{}},rosterStudentKey:s=>[s.className,s.number,s.name].join('|'),formatRosterLine:s=>[s.className,s.number,s.name].join(','),applyRosterToRecords(){},persist(){}};
  vm.createContext(context);vm.runInContext(code,context);
  context.applySharedOmrRoster({students:R.parse('학년,반,번호,성명\n3,4,27,학생나\n3,4,31,학생다')});
  assert.equal(state.roster[0].number,'27');
  assert.equal(state.answerRoster[0].number,'25');
  assert.equal(state.answerRoster[1].number,'27');
});
test('공통 명렬 저장·재조회 및 변경 전 백업을 같은 버전에서 덮어쓰지 않음',()=>{
  const store=new Map();
  global.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
  const data=R.save(R.parse(fixture),'test.csv');
  assert.equal(R.load().revision,data.revision);
  localStorage.setItem('grader',JSON.stringify({score:80}));
  R.backup('grader',data.revision);
  localStorage.setItem('grader',JSON.stringify({score:90}));
  R.backup('grader',data.revision);
  assert.equal(JSON.parse(localStorage.getItem('grader.beforeSharedRoster')).data.score,80);
  localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
  assert.throws(()=>R.save(R.parse(fixture),'failed.csv'));
  assert.equal(R.load().revision,data.revision);
  delete global.localStorage;
});
