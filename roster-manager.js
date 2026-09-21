(function(){
  'use strict';
  const $ = id=>document.getElementById(id);
  let students = [], pending = null, request = 0;
  function message(text, error=false){$('rosterMessage').textContent=text;$('rosterMessage').style.color=error?'var(--red)':'var(--muted)';}
  function renderRows(){
    const list = students.filter(s=>!$('rosterClassFilter').value || s.className===$('rosterClassFilter').value);
    $('rosterCount').textContent=`${list.length}명 · 원래 번호 유지`;
    $('rosterRows').replaceChildren(...list.map(s=>{
      const tr=document.createElement('tr');
      [s.grade || '—',s.classNumber,s.number,s.name].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});
      return tr;
    }));
  }
  function preview(list){
    students=list;
    const groups=SharedRoster.groups({students});
    $('rosterClassFilter').replaceChildren(new Option(`전체 ${Object.keys(groups).length}개 반`,''),...Object.entries(groups).map(([cls,items])=>new Option(`${cls}반 · ${items.length}명`,cls)));
    $('rosterPreview').hidden=false;renderRows();
  }
  function summary(data){$('savedRosterSummary').textContent=`등록됨: ${Object.keys(SharedRoster.groups(data)).length}개 반 · ${data.students.length}명 · ${new Date(data.savedAt).toLocaleString('ko-KR')}`;}
  $('rosterClassFilter').addEventListener('change',renderRows);
  $('sharedRosterFile').addEventListener('change',async event=>{
    const token=++request, file=event.target.files[0];
    pending=null;$('saveSharedRoster').disabled=true;
    if(!file)return;
    message('명렬을 읽고 있습니다…');
    try{
      const list=await SharedRoster.readFile(file);
      if(token!==request)return;
      pending={students:list,source:file.name};preview(list);
      $('saveSharedRoster').disabled=false;
      message(`${list.length}명을 인식했습니다. 반별 목록과 번호를 확인한 뒤 ‘세 채점기에 적용’을 눌러 주세요. 아직 저장하지 않았습니다.`);
    }catch(error){if(token===request){$('rosterPreview').hidden=true;message(error.message,true);}}
  });
  $('saveSharedRoster').addEventListener('click',()=>{
    if(!pending)return;
    try{
      const data=SharedRoster.save(pending.students,pending.source);
      summary(data);pending=null;$('saveSharedRoster').disabled=true;
      message('공통 명렬을 저장했습니다. 세 채점기를 열면 같은 명렬이 적용됩니다.');
    }catch{message('저장하지 못했습니다. 브라우저 저장 공간과 저장 허용 여부를 확인해 주세요.',true);}
  });
  try{const data=SharedRoster.load();if(data){summary(data);preview(data.students);message('저장된 공통 명렬입니다. 새 파일을 적용하면 이 명렬을 교체합니다.');}}
  catch(error){message(error.message,true);}
  window.addEventListener('storage',event=>{
    if(event.key!==SharedRoster.KEY)return;
    try{const data=SharedRoster.load();if(data){summary(data);if(!pending)preview(data.students);message('다른 화면에서 공통 명렬이 변경되었습니다.');}}catch(error){message(error.message,true);}
  });
})();
