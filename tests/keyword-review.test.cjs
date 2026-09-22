const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../keyword-review.js');
const meta={questionId:'q1',itemId:'r1',type:'accept',keyword:'근거',kind:'keyword'};
const targets=Array.from({length:28},(_,i)=>({key:'student'+i,page:i+1}));

test('검토 서명은 키 순서와 무관하고 긴 루브릭도 작은 크기로 저장',()=>{
  assert.equal(R.fingerprint({a:1,b:2}),R.fingerprint({b:2,a:1}));
  assert.notEqual(R.fingerprint({score:1}),R.fingerprint({score:2}));
  assert.ok(R.fingerprint({rubric:'기준'.repeat(10000)}).length<40);
});

test('28명 중 직접 확인한 학생만 집계하고 재실행 후 이어서 검토',()=>{
  const data=R.empty(),s=R.ensure(data,meta,targets);
  assert.equal(R.stats(s,()=> 'original').reviewed,0);
  targets.slice(0,9).forEach(t=>R.mark(s,t,'original'));
  const restored=R.restore(JSON.parse(JSON.stringify(data))).sessions[R.key(meta)];
  assert.equal(R.stats(restored,()=> 'original').reviewed,9);
  assert.equal(R.stats(restored,()=> 'original').total,28);
  assert.equal(R.complete(restored,()=> 'original'),false);
});
test('잘못 체크한 키워드를 해제해도 검토 인원과 학생을 유지',()=>{
  const data=R.empty(),s=R.ensure(data,meta,targets);
  R.ensure(data,meta,targets.slice(1));
  assert.equal(s.targets.length,28);
  assert.equal(s.targets[0].key,'student0');
  R.ensure(data,meta,[{key:'new',page:29}]);
  assert.equal(s.targets.length,29);
});
test('전체 학생 검토 뒤 키워드 완료를 명시적으로 표시하고 점수 변경 시 재검토',()=>{
  const s=R.ensure(R.empty(),meta,targets);
  targets.forEach(t=>R.mark(s,t,'before'));
  assert.equal(R.stats(s,()=> 'before').completed,false);
  assert.equal(R.complete(s,()=> 'before'),true);
  assert.equal(R.stats(s,()=> 'before').completed,true);
  const signature=t=>t.key==='student0'?'after':'before';
  assert.equal(R.stats(s,signature).reviewed,27);
  assert.equal(R.stats(s,signature).completed,false);
  R.mark(s,targets[0],'after');
  assert.equal(R.complete(s,signature),true);
  R.mark(s,targets[0],'after');
  assert.equal(R.stats(s,signature).reviewed,27);
  assert.equal(R.stats(s,signature).completed,false);
});
test('문항·키워드·선택/미선택별 검토 상태 분리',()=>{
  const data=R.empty();R.ensure(data,meta,targets);
  for(const changed of [{questionId:'q2'},{itemId:'r2'},{keyword:'다른 키워드'},{kind:'keywordMissing'},{type:'reject'}]){
    const session=R.ensure(data,{...meta,...changed},targets);
    assert.notEqual(session,data.sessions[R.key(meta)]);
  }
  assert.equal(Object.keys(data.sessions).length,6);
});
test('점수 변화만 기록하고 검토 밖의 변경은 제외; 되돌리기는 별도 기록',()=>{
  const before={a:{score:3,total:10,choices:['근거'],name:'예시',className:'3-1'}};
  const after={a:{score:1,total:8,choices:[],name:'예시',className:'3-1'}};
  assert.equal(R.differences(before,after,'',()=> 'id').length,0);
  assert.equal(R.differences(null,after,'검토',()=> 'id').length,0);
  const [event]=R.differences(before,after,'근거 검토',()=> 'id1');
  assert.equal(event.before,3);assert.equal(event.after,1);
  assert.equal(event.totalBefore,10);assert.equal(event.totalAfter,8);
  assert.equal(event.detail,'해제: 근거');
  const [undo]=R.differences(after,before,'근거 검토',()=> 'id2');
  assert.equal(undo.before,1);assert.equal(undo.after,3);
  assert.equal(R.differences(after,after,'검토',()=> 'id').length,0);
});
test('채점 기록이 없어지는 0점 수정과 새 기록 생성도 추적',()=>{
  const existing={a:{score:2,total:2,choices:['근거']}};
  assert.equal(R.differences(existing,{},'검토',()=> 'id')[0].after,0);
  assert.equal(R.differences({},existing,'검토',()=> 'id')[0].before,0);
});
test('JSON 병합 시 수정 내역은 중복되지 않고 검토 완료는 재확인',()=>{
  const a=R.empty(),s=R.ensure(a,meta,[targets[0]]);
  R.mark(s,targets[0],'grade');R.complete(s,()=> 'grade');
  a.changes.push({id:'event',before:1,after:0});
  const merged=R.merge(a,JSON.parse(JSON.stringify(a)));
  assert.equal(merged.changes.length,1);
  assert.equal(R.stats(merged.sessions[R.key(meta)],()=> 'grade').completed,false);
});
