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
  function summary(data){const classes=Object.keys(SharedRoster.groups(data)).length;$('savedRosterSummary').textContent=`등록됨: ${classes}개 반 · ${data.students.length}명 · ${new Date(data.savedAt).toLocaleString('ko-KR')}`;const badge=$('rosterBadge');if(badge){badge.textContent=`${classes}개 반 · ${data.students.length}명`;badge.classList.add('ready');}}
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
      driveDoc?.changed();
    }catch{message('저장하지 못했습니다. 브라우저 저장 공간과 저장 허용 여부를 확인해 주세요.',true);}
  });

  // ---------- 구글 드라이브 저장 ----------
  // 공통 명렬도 채점 기록처럼 드라이브 「평가 도구 모음」 폴더에 파일 하나로 자동 저장하고, 다른 기기에서 열면 받아 온다.
  // 명렬은 합치지 않는다. 양쪽이 다르면 어느 쪽을 쓸지 묻는다.
  let driveDoc=null;
  function driveStatus(status){
    const el=$('rosterDriveStatus');
    if(!el)return;
    el.textContent=status.message||'';
    el.style.color=['error','conflict','expired'].includes(status.state)?'var(--red)':'var(--muted)';
  }
  function emptyRoster(){return {version:1,students:[]};}
  function setupDrive(){
    if(!window.GoogleDriveSync)return;
    driveDoc=GoogleDriveSync.createDoc({
      app:'roster',
      title:()=> '[명렬] 공통 학생 명렬.json',
      build:()=>{try{return SharedRoster.load()||emptyRoster();}catch{return emptyRoster();}},
      apply:data=>{
        const saved=SharedRoster.restore(data);
        summary(saved);if(!pending)preview(saved.students);
        message('드라이브에서 공통 명렬을 불러왔습니다.');
      },
      merge:()=>{},
      isEmpty:()=>{try{return !SharedRoster.load();}catch{return true;}},
      resolveConflict:info=>confirm(`다른 기기에서 바꾼 공통 명렬(${info.timeLabel})과 이 기기의 명렬이 다릅니다.\n\n확인: 드라이브 명렬 사용\n취소: 이 기기 명렬로 드라이브 덮어쓰기`)?'remote':'local',
      // 처음 연결할 때 이 기기와 드라이브 모두 명렬이 있으면 고르게 한다. 저장 작업이 끝난 뒤 물어야 해서 한 박자 늦춘다.
      onNeedChoice:files=>setTimeout(()=>{
        const file=files[0];
        if(confirm(`드라이브에 저장된 공통 명렬이 있습니다(${GoogleDriveSync.timeLabel(file.modifiedTime)}).\n\n확인: 드라이브 명렬 불러오기\n취소: 이 기기 명렬을 드라이브에 저장`))driveDoc.openFile(file.id);
        else driveDoc.mergeFile(file.id);
      },0),
      onStatus:driveStatus
    });
    driveDoc.open();
  }
  setupDrive();
  try{const data=SharedRoster.load();if(data){summary(data);preview(data.students);message('저장된 공통 명렬입니다. 새 파일을 적용하면 이 명렬을 교체합니다.');}}
  catch(error){message(error.message,true);}
  window.addEventListener('storage',event=>{
    if(event.key!==SharedRoster.KEY)return;
    try{const data=SharedRoster.load();if(data){summary(data);if(!pending)preview(data.students);message('다른 화면에서 공통 명렬이 변경되었습니다.');}}catch(error){message(error.message,true);}
  });
})();
