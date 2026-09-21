(function(root){
  'use strict';
  const KEY = 'forClass.sharedRoster.v1';
  function rows(text){
    text = text.replace(/^\uFEFF/, '');
    const separator = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
    const result = []; let row = [], cell = '', quoted = false;
    for(let i=0;i<text.length;i++){
      const c = text[i];
      if(c === '"'){
        if(quoted && text[i+1] === '"'){cell += '"'; i++;}
        else quoted = !quoted;
      }else if(!quoted && (c === separator || c === '\n' || c === '\r')){
        row.push(cell.trim()); cell = '';
        if(c !== separator){
          if(row.some(Boolean)) result.push(row);
          row = [];
          if(c === '\r' && text[i+1] === '\n') i++;
        }
      }else cell += c;
    }
    if(quoted) throw new Error('닫히지 않은 따옴표가 있습니다. CSV 형식을 확인해 주세요.');
    row.push(cell.trim()); if(row.some(Boolean)) result.push(row);
    return result;
  }
  function parse(text){
    const table = rows(text);
    if(!table.length) throw new Error('파일에 학생 명렬이 없습니다.');
    const header = table.shift().map(s=>s.replace(/\s/g,'').toLowerCase());
    const column = names => header.findIndex(s=>names.includes(s));
    const gi = column(['학년','grade']), ci = column(['반','학급','class']);
    const ni = column(['번호','출석번호','number','no']), namei = column(['성명','이름','학생명','name']);
    if(ci < 0 || ni < 0 || namei < 0) throw new Error('첫 줄에 반, 번호, 성명(또는 이름) 열이 필요합니다.');
    const seen = new Set();
    const students = table.map((r,i)=>{
      const grade = gi < 0 ? '' : (r[gi] || '').replace(/학년$/, '').trim();
      const cls = (r[ci] || '').replace(/반$/, '').trim();
      const rawNo = r[ni] || '', name = r[namei] || '';
      if((gi >= 0 && !/^\d+$/.test(grade)) || !/^\d+$/.test(cls) || !/^\d+$/.test(rawNo) || !name)
        throw new Error(`${i+2}행의 학년, 반, 번호, 성명을 확인해 주세요.`);
      const number = Number(rawNo);
      if(number < 1 || number > 999 || Number(cls) < 1 || (grade && Number(grade) < 1))
        throw new Error(`${i+2}행의 학년·반·번호 범위를 확인해 주세요. 번호는 1~999까지 가능합니다.`);
      const className = grade ? `${Number(grade)}-${Number(cls)}` : String(Number(cls));
      const key = `${className}/${number}`;
      if(seen.has(key)) throw new Error(`${i+2}행: ${className}반 ${number}번이 중복되었습니다.`);
      seen.add(key);
      return {grade:grade ? String(Number(grade)) : '', classNumber:String(Number(cls)), className, number, name};
    });
    if(!students.length) throw new Error('학생이 한 명 이상 있어야 합니다.');
    students.sort((a,b)=>Number(a.grade)-Number(b.grade)||Number(a.classNumber)-Number(b.classNumber)||a.number-b.number);
    return students;
  }
  async function readFile(file){
    const bytes = await file.arrayBuffer();
    let text;
    try{text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);}
    catch{ text = new TextDecoder('euc-kr', {fatal:true}).decode(bytes); }
    return parse(text);
  }
  function load(){
    const raw = root.localStorage.getItem(KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(data.version !== 1 || !Array.isArray(data.students) || !data.students.length) throw new Error('저장된 공통 명렬을 읽을 수 없습니다. 홈에서 다시 등록해 주세요.');
    return data;
  }
  function save(students, source){
    const data = {version:1, revision:Date.now()+'_'+Math.random().toString(36).slice(2), source, savedAt:Date.now(), students};
    root.localStorage.setItem(KEY, JSON.stringify(data));
    return data;
  }
  function groups(data){
    const result = {};
    data.students.forEach(s=>(result[s.className] ||= []).push(s));
    return result;
  }
  // A grade-less legacy class is unambiguous only when the shared roster has one grade.
  function oldClass(previous, student, data){
    if(previous[student.className]) return previous[student.className];
    if(new Set(data.students.map(s=>s.grade)).size === 1)
      return previous[student.classNumber] || previous[student.classNumber+'반'] || [];
    return [];
  }
  function backup(key, revision){
    const raw = root.localStorage.getItem(key);
    if(!raw) return;
    const backupKey = key+'.beforeSharedRoster';
    const old = root.localStorage.getItem(backupKey);
    if(old && JSON.parse(old).revision === revision) return;
    root.localStorage.setItem(backupKey, JSON.stringify({revision, savedAt:Date.now(), data:JSON.parse(raw)}));
  }
  function project(data, previous, create, sparse=false){
    const result = {};
    Object.entries(groups(data)).forEach(([cls, students])=>{
      const old = oldClass(previous, students[0], data);
      const next = sparse ? Array.from({length:Math.max(31,...students.map(s=>s.number))},()=>null) : [];
      students.forEach(s=>{
        const found = old.find(o=>o && Number(o.num ?? o.no) === s.number && o.name === s.name);
        const value = found ? {...found} : create(s);
        if(sparse){value.num=s.number;next[s.number-1]=value;}
        else{value.no=s.number;next.push(value);}
      });
      result[cls]=next;
    });
    return result;
  }
  function notice(message){
    const host = document.querySelector('[data-shared-roster-status]');
    if(!host) return;
    let el = document.getElementById('sharedRosterNotice');
    if(!el){
      el = document.createElement('div'); el.id = 'sharedRosterNotice'; el.setAttribute('role','status');
      el.style.cssText = 'margin-bottom:12px;padding:10px 14px;border-radius:8px;background:#e9f7fb;color:#17445a;font:14px/1.6 system-ui;';
      host.append(el);
    }
    el.replaceChildren(document.createTextNode(message+' '));
    const link = document.createElement('a'); link.href = 'index.html#shared-roster'; link.textContent = '공통 명렬 관리';
    link.style.cssText = 'color:inherit;text-decoration:underline'; el.append(link);
  }
  function connect(apply, selectors){
    let data;
    try{data = load(); if(data) apply(data);}
    catch(error){notice('공통 명렬 적용 실패: '+error.message); return;}
    if(!data) return;
    notice(`공통 명렬 ${data.students.length}명 사용 중 · 반 표시는 학년-반입니다. 명렬 수정은 홈에서 합니다.`);
    selectors.forEach(selector=>document.querySelectorAll(selector).forEach(el=>{
      el.disabled = true; el.title = '홈의 공통 명렬 관리에서 수정해 주세요.';
    }));
    root.addEventListener('storage', event=>{
      if(event.key === KEY) notice('공통 명렬이 변경되었습니다. 현재 작업을 저장한 뒤 이 화면을 새로고침하면 반영됩니다.');
    });
    root.addEventListener('pageshow', ()=>{
      try{if(load()?.revision !== data.revision) notice('공통 명렬이 변경되었습니다. 현재 작업을 저장한 뒤 이 화면을 새로고침하면 반영됩니다.');}catch{}
    });
  }
  root.SharedRoster = {KEY, rows, parse, readFile, load, save, groups, oldClass, backup, project, connect};
  if(typeof module !== 'undefined') module.exports = root.SharedRoster;
})(typeof window !== 'undefined' ? window : globalThis);
