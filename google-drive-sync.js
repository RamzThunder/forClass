(function(root){
  'use strict';
  // 구글 로그인 + 드라이브 저장. 서버 없이 브라우저에서 Google Identity Services 토큰 방식을 쓴다.
  // 클라이언트 ID는 공개돼도 되는 값이다. client secret은 쓰지 않는다.
  const CLIENT_ID = '376524628394-un7tkhcnicr9tu319mnkvs53klilg0lc.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const AUTH_KEY = 'forClass.google.auth.v1';
  const DOC_PREFIX = 'forClass.drive.doc.v1.';
  const FOLDER_NAME = '평가 도구 모음';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  // 협동채점에서 동료 파일을 처음 열 때 쓰는 구글 파일 선택창(Picker) 설정.
  // API 키는 공개돼도 되는 값이다. Google Cloud 콘솔에서 Picker API를 켜고, 키를 사이트 주소로 제한해 둔다.
  const PICKER_API_KEY = 'AIzaSyCs7nmBRoCbGfjFKCtlYnxhLVRKjkK9-Wg';
  const APP_ID = CLIENT_ID.split('-')[0];

  // ---------- 순수 함수 (테스트 대상) ----------
  function normalizeEmail(value){ return String(value || '').trim().toLowerCase(); }
  function parseEmails(text){
    const found = String(text || '').split(/[\s,;]+/).map(normalizeEmail).filter(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
    return [...new Set(found)];
  }
  function hash(text){
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for(let i=0;i<text.length;i++){
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  // 화면 위치처럼 자주 바뀌지만 채점 내용이 아닌 값은 빼고 비교한다.
  function fingerprint(payload, volatileKeys=[]){
    const copy = {...(payload || {})};
    volatileKeys.forEach(key => delete copy[key]);
    return hash(JSON.stringify(copy));
  }
  // 드라이브 파일 내용이 바뀌었는지 알려 주는 표시. version은 구글 서버 내부 처리로도 올라가서
  // 내용 체크섬(md5Checksum)을 먼저 보고, 없을 때만 리비전 ID와 version을 쓴다.
  function remoteTag(meta){
    return {md5:meta?.md5Checksum || '', rev:meta?.headRevisionId || '', version:String(meta?.version ?? '')};
  }
  function sameRemote(known, meta){
    if(!known || !meta) return false;
    const now = remoteTag(meta);
    if(known.md5 && now.md5) return known.md5 === now.md5;
    if(known.rev && now.rev) return known.rev === now.rev;
    return Boolean(known.version) && known.version === now.version;
  }
  function syncAction({localHash, syncedHash, remoteSame, remoteExists}){
    if(!remoteExists) return 'missing';
    const dirty = localHash !== syncedHash;
    if(remoteSame) return dirty ? 'upload' : 'none';
    return dirty ? 'conflict' : 'download';
  }
  function timeLabel(iso){
    const d = new Date(iso);
    if(Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return `${sameDay ? '' : `${d.getMonth()+1}/${d.getDate()} `}${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function escapeQuery(value){ return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  // ---------- 저장소 ----------
  function storage(){ try{ return root.localStorage || null; }catch{ return null; } }
  function readJson(key){
    try{ return JSON.parse(storage()?.getItem(key) || 'null'); }catch{ return null; }
  }
  function writeJson(key, value){
    try{
      if(value === null) storage()?.removeItem(key);
      else storage()?.setItem(key, JSON.stringify(value));
    }catch{}
  }

  // ---------- 로그인 ----------
  const authListeners = new Set();
  function readAuth(){ return readJson(AUTH_KEY); }
  function emitAuth(){ authListeners.forEach(fn => { try{ fn(authState()); }catch(err){ console.warn(err); } }); }
  function writeAuth(value){ writeJson(AUTH_KEY, value); emitAuth(); }
  function account(){
    const a = readAuth();
    return a && a.email ? {email:a.email, name:a.name || ''} : null;
  }
  function token(){
    const a = readAuth();
    return a && a.token && Number(a.expiresAt) > Date.now() + 60000 ? a.token : '';
  }
  function authState(){
    const a = readAuth();
    if(!a || !a.email) return 'signed-out';
    return token() ? 'signed-in' : 'expired';
  }
  function onAuthChange(fn){
    authListeners.add(fn);
    return () => authListeners.delete(fn);
  }
  if(typeof root.addEventListener === 'function'){
    root.addEventListener('storage', event => { if(event.key === AUTH_KEY) emitAuth(); });
  }

  let gisPromise = null, tokenClient = null, pendingSignIn = null;
  function prepare(){
    if(gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
      const ready = () => {
        try{
          tokenClient = root.google.accounts.oauth2.initTokenClient({
            client_id:CLIENT_ID,
            scope:SCOPE,
            callback:resp => finishSignIn(resp),
            error_callback:err => failSignIn(err?.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : '구글 로그인 창을 열 수 없습니다. 팝업 차단을 확인해 주세요.')
          });
          resolve();
        }catch(err){ reject(err); }
      };
      if(root.google?.accounts?.oauth2){ ready(); return; }
      const doc = root.document;
      if(!doc){ reject(new Error('브라우저에서만 로그인할 수 있습니다.')); return; }
      const script = doc.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = ready;
      script.onerror = () => { gisPromise = null; reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      doc.head.append(script);
    });
    gisPromise.catch(() => {});
    return gisPromise;
  }
  function failSignIn(message){
    const pending = pendingSignIn;
    pendingSignIn = null;
    pending?.reject(new Error(message));
  }
  async function finishSignIn(resp){
    if(!pendingSignIn) return;
    if(resp?.error){ failSignIn(`구글 로그인 실패: ${resp.error_description || resp.error}`); return; }
    if(!root.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)){
      failSignIn('구글 드라이브 권한을 허용해야 저장할 수 있습니다.');
      return;
    }
    try{
      const expiresAt = Date.now() + Number(resp.expires_in || 3600) * 1000;
      const res = await fetch(`${API}/about?fields=user(displayName,emailAddress)`, {headers:{Authorization:`Bearer ${resp.access_token}`}});
      if(!res.ok) throw new Error(`계정 정보를 확인하지 못했습니다 (${res.status}).`);
      const user = (await res.json()).user || {};
      const previous = readAuth();
      if(previous?.email && previous.email !== user.emailAddress) folderCache = null;
      writeAuth({token:resp.access_token, expiresAt, email:user.emailAddress || '', name:user.displayName || ''});
      const pending = pendingSignIn;
      pendingSignIn = null;
      pending?.resolve(account());
    }catch(err){ failSignIn(err.message); }
  }
  // 버튼 클릭 안에서 바로 불러야 팝업이 막히지 않는다. 그래서 스크립트는 prepare()로 미리 불러 둔다.
  function signIn(){
    // 자동 재연결이 이미 창을 띄웠으면 같은 요청을 함께 기다린다(창이 두 번 뜨지 않게).
    if(pendingSignIn && Date.now() - pendingSignIn.at < 120000) return pendingSignIn.promise;
    let settle;
    const promise = new Promise((resolve, reject) => { settle = {resolve, reject}; });
    if(!tokenClient){
      prepare();
      settle.reject(new Error('구글 로그인을 준비하고 있습니다. 잠시 후 다시 눌러 주세요.'));
      return promise;
    }
    pendingSignIn?.reject(new Error('새 로그인 요청으로 취소되었습니다.'));
    pendingSignIn = {...settle, promise, at:Date.now()};
    const known = account();
    tokenClient.requestAccessToken(known ? {prompt:'', login_hint:known.email} : {prompt:'consent'});
    return promise;
  }

  // ---------- 자동 재연결 ----------
  // 토큰은 1시간이면 만료되고 늘릴 수 없다. 팝업은 사용자 클릭 안에서만 열 수 있으므로,
  // 만료됐거나 곧 만료될 때 화면을 처음 클릭하는 순간 조용히 다시 연결한다.
  // 로그아웃 버튼처럼 data-drive-no-auto가 붙은 곳을 누를 때는 하지 않는다.
  const AUTO_REFRESH_BEFORE = 10 * 60000;
  const AUTO_RETRY_AFTER = 10 * 60000;
  let autoBlockedUntil = 0;
  function needsAutoReconnect(now = Date.now()){
    const a = readAuth();
    if(!a || !a.email || pendingSignIn || now < autoBlockedUntil) return false;
    return !a.token || Number(a.expiresAt) - now < AUTO_REFRESH_BEFORE;
  }
  function autoReconnect(event){
    if(event && event.isTrusted === false) return;
    if(event?.target?.closest?.('[data-drive-no-auto]')) return;
    if(!needsAutoReconnect()) return;
    if(!tokenClient){ prepare(); return; }
    autoBlockedUntil = Date.now() + 15000;
    signIn().then(() => { autoBlockedUntil = 0; }, () => { autoBlockedUntil = Date.now() + AUTO_RETRY_AFTER; });
  }
  if(root.document?.addEventListener){
    root.document.addEventListener('click', autoReconnect, true);
    // 단축키로만 채점해도 다시 연결되게 한다(키 입력도 팝업을 열 수 있는 사용자 동작이다).
    root.document.addEventListener('keydown', autoReconnect, true);
    if(account()) prepare();
  }
  async function signOut(){
    const t = readAuth()?.token;
    writeAuth(null);
    folderCache = null;
    if(!t) return;
    try{
      if(root.google?.accounts?.oauth2) root.google.accounts.oauth2.revoke(t, () => {});
      else await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, {method:'POST'});
    }catch{}
  }

  // ---------- 드라이브 API ----------
  class DriveError extends Error{
    constructor(message, kind, status){ super(message); this.kind = kind; this.status = status; }
  }
  function expireToken(){
    const a = readAuth();
    if(a && a.token){ a.token = ''; a.expiresAt = 0; writeAuth(a); }
  }
  async function api(url, options={}){
    const t = token();
    if(!t) throw new DriveError(authState() === 'signed-out' ? '구글 로그인이 필요합니다.' : '구글 로그인이 만료되었습니다.', 'auth');
    let res;
    try{
      res = await fetch(url, {...options, headers:{...(options.headers || {}), Authorization:`Bearer ${t}`}});
    }catch{
      throw new DriveError('인터넷에 연결되어 있지 않습니다.', 'offline');
    }
    if(res.status === 401){ expireToken(); throw new DriveError('구글 로그인이 만료되었습니다.', 'auth', 401); }
    if(!res.ok){
      let message = '';
      try{ message = (await res.json())?.error?.message || ''; }catch{}
      throw new DriveError(`드라이브 요청 실패 (${res.status})${message ? `: ${message}` : ''}`, 'http', res.status);
    }
    return res;
  }
  const FILE_FIELDS = 'id,name,modifiedTime,version,md5Checksum,headRevisionId,ownedByMe,capabilities(canShare),owners(emailAddress)';
  let folderCache = null;
  async function folderId(){
    if(folderCache) return folderCache;
    const q = `mimeType='${FOLDER_MIME}' and appProperties has { key='forClassRoot' and value='1' } and 'me' in owners and trashed=false`;
    const list = await (await api(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`)).json();
    if(list.files?.length){ folderCache = list.files[0].id; return folderCache; }
    const created = await (await api(`${API}/files?fields=id`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:FOLDER_NAME, mimeType:FOLDER_MIME, appProperties:{forClassRoot:'1'}})
    })).json();
    folderCache = created.id;
    return folderCache;
  }
  async function listFiles(app){
    const q = `appProperties has { key='forClassApp' and value='${escapeQuery(app)}' } and 'me' in owners and trashed=false`;
    const res = await api(`${API}/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=50&fields=files(${FILE_FIELDS})`);
    return (await res.json()).files || [];
  }
  async function getMeta(id){
    try{
      const meta = await (await api(`${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS},trashed`)).json();
      return meta.trashed ? null : meta;
    }catch(err){
      if(err.status === 404) return null;
      throw err;
    }
  }
  // 동료 파일 확인용. 주인 계정도 함께 받는다.
  async function peerMeta(id){
    return (await api(`${API}/files/${encodeURIComponent(id)}?fields=id,name,modifiedTime,trashed,appProperties,owners(emailAddress,displayName)`)).json();
  }
  // 앱이 만든 내 파일을 다른 계정에 보기 전용으로 공유한다.
  async function shareFile(id, email, message=''){
    const meta = await getMeta(id);
    if(!meta) throw new DriveError('공유할 파일을 찾을 수 없습니다.', 'http', 404);
    if(meta.ownedByMe !== true){
      throw new DriveError('내 소유 파일인지 확인되지 않아 공유를 중단했습니다. 페이지를 새로고침한 뒤 다시 연결해 주세요.', 'permission');
    }
    if(meta.capabilities?.canShare === false){
      throw new DriveError(`「${meta.name}」은 Google Drive에서 공유가 제한된 파일입니다. 드라이브에서 공유 설정을 확인해 주세요.`, 'permission');
    }
    const params = new URLSearchParams({sendNotificationEmail:'true', fields:'id'});
    if(message) params.set('emailMessage', message);
    try{
      return await (await api(`${API}/files/${encodeURIComponent(id)}/permissions?${params}`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({type:'user', role:'reader', emailAddress:normalizeEmail(email)})
      })).json();
    }catch(err){
      if(err.status === 400 || err.status === 403){
        throw new DriveError(`「${meta.name}」 자동 공유를 Google이 거부했습니다. 내 소유 파일 확인 완료 · 공유 가능: ${meta.capabilities?.canShare === true ? '예' : '확인 불가'}. 협동채점의 「드라이브에서 내 파일 열기」에서 공유를 시도해 주세요.\n${err.message}`, err.kind, err.status);
      }
      throw err;
    }
  }

  function pickerAvailable(){ return Boolean(PICKER_API_KEY); }
  let pickerPromise = null;
  function loadPicker(){
    if(pickerPromise) return pickerPromise;
    pickerPromise = new Promise((resolve, reject) => {
      const fail = () => { pickerPromise = null; reject(new Error('구글 파일 선택창을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      const load = () => root.gapi.load('picker', {callback:resolve, onerror:fail});
      if(root.gapi?.load){ load(); return; }
      const script = root.document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;
      script.onload = load;
      script.onerror = fail;
      root.document.head.append(script);
    });
    return pickerPromise;
  }
  // 나에게 공유된 JSON 파일을 고르게 한다. 고른 파일은 이 앱이 읽을 수 있게 된다.
  async function pickFiles({title='파일 선택', mimeTypes='application/json'}={}){
    if(!PICKER_API_KEY) throw new DriveError('구글 파일 선택창 설정(API 키)이 아직 없습니다.', 'config');
    const t = token();
    if(!t) throw new DriveError('구글 로그인이 필요합니다.', 'auth');
    await loadPicker();
    const picker = root.google.picker;
    return new Promise(resolve => {
      const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(mimeTypes).setOwnedByMe(false);
      new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(t)
        .setDeveloperKey(PICKER_API_KEY)
        .setAppId(APP_ID)
        .setTitle(title)
        .setLocale('ko')
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .setCallback(data => {
          const action = data[picker.Response.ACTION];
          if(action === picker.Action.PICKED) resolve((data[picker.Response.DOCUMENTS] || []).map(doc => ({id:doc[picker.Document.ID], name:doc[picker.Document.NAME]})));
          else if(action === picker.Action.CANCEL) resolve([]);
        })
        .build()
        .setVisible(true);
    });
  }
  async function download(id){
    const text = await (await api(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
    try{ return JSON.parse(text); }
    catch{ throw new DriveError('드라이브 파일이 올바른 JSON이 아닙니다.', 'format'); }
  }
  async function createFile(app, name, text){
    const parent = await folderId();
    const boundary = `forClass${Math.random().toString(36).slice(2)}`;
    const meta = {name, mimeType:'application/json', parents:[parent], appProperties:{forClassApp:app}};
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
    return (await api(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method:'POST',
      headers:{'Content-Type':`multipart/related; boundary=${boundary}`},
      body
    })).json();
  }
  async function updateFile(id, text){
    return (await api(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FILE_FIELDS}`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json; charset=UTF-8'},
      body:text
    })).json();
  }

  // 저장 파일을 바꾸면 이전 파일에 새 파일 위치를 적어 둔다. 협동채점 동료가 이전 파일을 보고 있으면 따라올 수 있게 한다.
  async function setMovedTo(id, movedTo){
    await api(`${API}/files/${encodeURIComponent(id)}?fields=id`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({appProperties:{forClassMovedTo:movedTo || null}})
    });
  }

  // ---------- 자동 백업 ----------
  // 저장 파일은 몇 초마다 덮어써서 드라이브 버전 기록이 남지 않는다. 그래서 사본을 따로 만든다.
  // 백업은 「평가 도구 모음/백업」 폴더에 두고, 채점 파일 목록(forClassApp)에는 나오지 않게 한다.
  const HOUR = 3600e3, DAY = 24 * HOUR;
  const BACKUP = {intervalMs:HOUR, keepAllMs:2 * DAY, keepDailyMs:30 * DAY, keepLatest:3, pruneEveryMs:12 * HOUR};
  const BACKUP_REASONS = {
    hourly:'자동', 'before-open':'불러오기 전', 'before-merge':'합치기 전', 'before-merge-remote':'합치기 전 드라이브 기록',
    'before-remote':'드라이브 기록으로 바꾸기 전', 'before-overwrite':'덮어쓰기 전 드라이브 기록', 'before-restore':'복원 전',
    'before-reset':'새 시험 시작 전', 'before-import':'JSON 불러오기 전'
  };
  let backupFolderCache = null;
  async function backupFolderId(){
    const email = account()?.email || '';
    if(backupFolderCache?.email === email) return backupFolderCache.id;
    const parent = await folderId();
    const q = `mimeType='${FOLDER_MIME}' and appProperties has { key='forClassBackupRoot' and value='1' } and 'me' in owners and trashed=false`;
    const list = await (await api(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`)).json();
    let id = list.files?.[0]?.id;
    if(!id){
      id = (await (await api(`${API}/files?fields=id`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:'백업', mimeType:FOLDER_MIME, parents:[parent], appProperties:{forClassBackupRoot:'1'}})
      })).json()).id;
    }
    backupFolderCache = {email, id};
    return id;
  }
  async function createBackupFile(app, {name, text, exam, reason}){
    const parent = await backupFolderId();
    const boundary = `forClass${Math.random().toString(36).slice(2)}`;
    const meta = {name, mimeType:'application/json', parents:[parent], appProperties:{forClassBackup:app, forClassExam:hash(String(exam || '')), forClassReason:reason}};
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
    return (await api(`${UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,appProperties`, {
      method:'POST',
      headers:{'Content-Type':`multipart/related; boundary=${boundary}`},
      body
    })).json();
  }
  async function listBackups(app){
    const q = `appProperties has { key='forClassBackup' and value='${escapeQuery(app)}' } and 'me' in owners and trashed=false`;
    const files = [];
    let pageToken = '';
    do{
      const res = await api(`${API}/files?q=${encodeURIComponent(q)}&orderBy=createdTime desc&pageSize=1000&fields=nextPageToken,files(id,name,createdTime,size,appProperties)${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      const page = await res.json();
      files.push(...(page.files || []));
      pageToken = page.nextPageToken || '';
    }while(pageToken);
    return files.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
  }
  // 지울 백업 고르기. 시험마다 최근 3개는 항상 두고, 최근 2일은 모두, 30일까지는 하루 1개(그날 마지막)만 둔다.
  function backupsToTrash(files, now=Date.now()){
    const groups = new Map();
    files.forEach(file => {
      const exam = file.appProperties?.forClassExam || '';
      if(!groups.has(exam)) groups.set(exam, []);
      groups.get(exam).push(file);
    });
    const trash = [];
    groups.forEach(list => {
      list.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
      const keptDays = new Set();
      list.forEach((file, index) => {
        const time = Date.parse(file.createdTime);
        const day = new Date(time).toDateString();
        const age = now - time;
        if(index < BACKUP.keepLatest || !(age >= BACKUP.keepAllMs)){ keptDays.add(day); return; }
        if(age < BACKUP.keepDailyMs && !keptDays.has(day)){ keptDays.add(day); return; }
        trash.push(file);
      });
    });
    return trash;
  }
  async function trashOwned(id){
    await api(`${API}/files/${encodeURIComponent(id)}?fields=id,trashed`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({trashed:true})
    });
  }
  function backupStamp(date=new Date()){
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  }

  // ---------- 큰 파일(PDF 등) ----------
  // 같은 파일인지 찾는 열쇠. appProperties 값 길이 제한(약 120바이트) 때문에 해시로 줄인다.
  async function findByKey(app, key){
    const q = `appProperties has { key='forClassApp' and value='${escapeQuery(app)}' } and appProperties has { key='forClassKey' and value='${hash(String(key))}' } and 'me' in owners and trashed=false`;
    const res = await api(`${API}/files?q=${encodeURIComponent(q)}&pageSize=1&fields=files(id,name,size,modifiedTime)`);
    return (await res.json()).files?.[0] || null;
  }
  const UPLOAD_CHUNK = 8 * 1024 * 1024; // 256KB의 배수여야 한다.
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function rangeEnd(res){
    const range = res.headers?.get?.('Range');
    const match = /bytes=0-(\d+)/.exec(range || '');
    return match ? Number(match[1]) + 1 : null;
  }
  // 재개 가능 업로드: 조각마다 올리고, 끊기면 서버가 받은 곳부터 다시 올린다.
  async function uploadLarge({app, key, name, mimeType='application/octet-stream', blob, onProgress}){
    const parent = await folderId();
    const start = await api(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size,modifiedTime`, {
      method:'POST',
      headers:{'Content-Type':'application/json; charset=UTF-8', 'X-Upload-Content-Type':mimeType, 'X-Upload-Content-Length':String(blob.size)},
      body:JSON.stringify({name, mimeType, parents:[parent], appProperties:{forClassApp:app, forClassKey:hash(String(key))}})
    });
    const session = start.headers.get('Location');
    if(!session) throw new DriveError('드라이브 업로드를 시작하지 못했습니다.', 'http');
    const total = blob.size;
    let offset = 0, failures = 0;
    const report = () => { try{ onProgress?.(total ? offset / total : 1); }catch{} };
    const recover = async () => {
      failures += 1;
      if(failures > 6) throw new DriveError('인터넷 연결이 불안정해 업로드를 멈췄습니다. 잠시 후 다시 올려 주세요.', 'offline');
      await wait(Math.min(15000, 1500 * failures));
      try{
        const res = await fetch(session, {method:'PUT', headers:{'Content-Range':`bytes */${total}`}});
        if(res.status === 308){ offset = rangeEnd(res) ?? 0; return null; }
        if(res.ok) return res.json();
      }catch{}
      return null;
    };
    report();
    while(true){
      const end = Math.min(offset + UPLOAD_CHUNK, total);
      let res;
      try{
        res = await fetch(session, {
          method:'PUT',
          headers:{'Content-Range':total ? `bytes ${offset}-${end - 1}/${total}` : 'bytes */0'},
          body:blob.slice(offset, end)
        });
      }catch{
        const done = await recover();
        if(done){ offset = total; report(); return done; }
        continue;
      }
      if(res.status === 308){
        offset = rangeEnd(res) ?? end;
        failures = 0;
        report();
        continue;
      }
      if(res.ok){ offset = total; report(); return res.json(); }
      if(res.status === 401) { expireToken(); throw new DriveError('구글 로그인이 만료되었습니다.', 'auth', 401); }
      if(res.status >= 500 || res.status === 429){
        const done = await recover();
        if(done){ offset = total; report(); return done; }
        continue;
      }
      throw new DriveError(`드라이브 업로드 실패 (${res.status})`, 'http', res.status);
    }
  }
  async function downloadBlob(id, {size=0, mimeType='', onProgress}={}){
    const res = await api(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    const total = Number(res.headers?.get?.('Content-Length')) || Number(size) || 0;
    if(!res.body?.getReader || !total) return res.blob();
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while(true){
      let step;
      try{ step = await reader.read(); }
      catch{ throw new DriveError('내려받는 중에 인터넷 연결이 끊겼습니다.', 'offline'); }
      if(step.done) break;
      chunks.push(step.value);
      received += step.value.length;
      try{ onProgress?.(Math.min(1, received / total)); }catch{}
    }
    return new Blob(chunks, mimeType ? {type:mimeType} : {});
  }

  // ---------- 채점기 하나의 드라이브 파일 ----------
  // options: app, title(), build(), apply(data), merge(data), isEmpty(), volatileKeys,
  //          resolveConflict(info) -> 'merge'|'remote'|'local'|null, onNeedChoice(files), onStatus(status), onPulled(), delay
  function createDoc(options){
    const {app, volatileKeys=[]} = options;
    const key = DOC_PREFIX + app;
    let status = {state:'', message:''};
    let busy = false, again = false, timer = null, applying = false, paused = false;
    // 드라이브에 아직 못 올린 변경이 처음 생긴 시각(0이면 없음)
    let changeSeq = 0, dirtySince = 0;

    // 저장 중인 파일은 구글 계정마다 따로 기억한다. 한 브라우저에서 계정을 오가도
    // 각 계정이 자기 파일로 돌아가게 하고, 다른 계정의 연결을 지우지 않는다.
    // active는 이 기기의 채점 기록을 마지막으로 드라이브와 맞춘 계정이다.
    function currentEmail(){ return normalizeEmail(account()?.email); }
    function readStore(){
      const raw = readJson(key) || {};
      if(raw.byAccount) return {byAccount:{...raw.byAccount}, active:raw.active || ''};
      // 예전 형식: 연결 하나만 저장돼 있었다.
      if(!Object.keys(raw).length) return {byAccount:{}, active:''};
      const owner = normalizeEmail(raw.email) || currentEmail();
      return {byAccount:{[owner]:raw}, active:normalizeEmail(raw.email)};
    }
    function writeStore(next){
      writeJson(key, Object.keys(next.byAccount).length || next.active ? next : null);
    }
    let link = {}, linkEmail = null;
    function loadLink(){
      const email = currentEmail();
      if(email === linkEmail) return;
      linkEmail = email;
      link = readStore().byAccount[email] || {};
    }
    function saveLink(next){
      loadLink();
      link = next || {};
      const all = readStore();
      if(next) all.byAccount[linkEmail] = link;
      else delete all.byAccount[linkEmail];
      writeStore(all);
    }
    function markActive(){
      const all = readStore();
      all.active = currentEmail();
      writeStore(all);
    }
    // 이 기기의 기록이 다른 계정에서 온 것인지. 그대로 올리면 두 계정의 기록이 섞인다.
    function accountSwitched(){
      const active = readStore().active;
      return Boolean(active) && active !== currentEmail() && !options.isEmpty();
    }
    async function askChoice(reason, showDialog){
      const files = await listFiles(app);
      const wasChoosing = status.state === 'choose';
      if(reason === 'account') setStatus('choose', '다른 구글 계정입니다 · 사용할 드라이브 파일을 골라 주세요');
      else{
        saveLink({...link, pendingChoice:true, email:account()?.email || ''});
        setStatus('choose', '드라이브 파일을 골라 주세요');
      }
      if(showDialog || !wasChoosing) options.onNeedChoice?.(files, {reason});
    }
    loadLink();
    function setStatus(state, message){
      status = {state, message};
      try{ options.onStatus?.(status); }catch(err){ console.warn(err); }
    }
    function localFingerprint(payload){ return fingerprint(payload, volatileKeys); }
    function remember(meta, fp){
      // 같은 시험(같은 이름)의 다른 파일로 옮길 때만 표시한다. 다른 시험 파일을 따라가면 안 된다.
      const previous = link.fileId;
      if(previous && previous !== meta.id && link.name && link.name === meta.name) markMoved(previous, meta.id);
      saveLink({fileId:meta.id, name:meta.name, remote:remoteTag(meta), modifiedTime:meta.modifiedTime, syncedHash:fp, email:account()?.email || ''});
      markActive();
    }
    // 실패해도 저장에는 영향이 없다. 내 파일이 아니면(예전 공유 연결) 건너뛴다.
    function markMoved(previous, next){
      Promise.all([setMovedTo(previous, next), setMovedTo(next, null)]).catch(err => console.warn('파일 이동 표시 실패', err));
    }
    function savedMessage(){ return `드라이브 저장됨 · ${timeLabel(link.modifiedTime)}`; }
    function applyData(fn){
      applying = true;
      try{ fn(); }finally{ applying = false; }
    }
    function authStatus(){
      const s = authState();
      if(s === 'signed-out') setStatus('signed-out', '구글 로그인 전 · 이 기기에만 저장됩니다');
      else setStatus('expired', '구글 로그인 만료 · 다시 연결해 주세요');
      return false;
    }

    async function run(task){
      if(paused) return;
      if(busy){ again = true; return; }
      if(authState() !== 'signed-in'){ authStatus(); return; }
      busy = true;
      const seq = changeSeq;
      try{
        loadLink();
        await task();
        // 작업하는 동안 새 변경이 없었고 저장까지 끝났으면, 드라이브에 못 올린 변경이 없다.
        if(status.state === 'saved' && changeSeq === seq) dirtySince = 0;
      }catch(err){
        if(err.kind === 'auth') authStatus();
        else if(err.kind === 'offline') setStatus('offline', '오프라인 · 이 기기에 저장되어 있습니다');
        else setStatus('error', err.message || String(err));
      }finally{
        busy = false;
        if(again){ again = false; schedule(500); }
      }
    }
    async function upload(text, fp){
      setStatus('saving', '드라이브에 저장 중…');
      remember(await updateFile(link.fileId, text), fp);
      setStatus('saved', savedMessage());
      await hourlyBackup(fp);
    }

    // 백업 사본 만들기. data를 주면 그 내용을(드라이브 쪽 기록 등), 아니면 이 기기의 기록을 남긴다.
    // 기기 기록이 비어 있으면 남길 것이 없으니 건너뛴다.
    const backupStateKey = () => `${key}.backup.${currentEmail()}`;
    async function makeBackup(reason, data=null){
      if(!data && options.isEmpty()) return null;
      const payload = data || options.build();
      const title = options.title();
      const name = `${String(title).replace(/\.json$/i, '')} 백업 ${backupStamp()} (${BACKUP_REASONS[reason] || reason}).json`;
      const meta = await createBackupFile(app, {name, text:JSON.stringify(payload), exam:title, reason});
      if(!data) writeJson(backupStateKey(), {at:Date.now(), hash:localFingerprint(payload)});
      await pruneBackups();
      return meta;
    }
    // 1시간이 지났고 마지막 백업 뒤로 바뀐 내용이 있을 때만 만든다. 실패해도 저장은 성공으로 둔다.
    async function hourlyBackup(fp){
      const last = readJson(backupStateKey()) || {};
      if(Date.now() - Number(last.at || 0) < BACKUP.intervalMs || last.hash === fp) return;
      try{ await makeBackup('hourly'); }catch(err){ console.warn('자동 백업 실패', err); }
    }
    // 오래된 백업 정리는 12시간에 한 번만 한다. 지운 백업은 드라이브 휴지통에 30일 동안 남는다.
    async function pruneBackups(force=false){
      const stateKey = `${key}.prune.${currentEmail()}`;
      if(!force && Date.now() - Number(readJson(stateKey)?.at || 0) < BACKUP.pruneEveryMs) return 0;
      writeJson(stateKey, {at:Date.now()});
      let count = 0;
      try{
        for(const file of backupsToTrash(await listBackups(app))){ await trashOwned(file.id); count++; }
      }catch(err){ console.warn('백업 정리 실패', err); }
      return count;
    }
    async function pull(meta, data=null, message='드라이브의 최신 기록을 불러왔습니다'){
      setStatus('loading', '드라이브에서 받는 중…');
      data = data || await download(meta.id);
      applyData(() => options.apply(data));
      remember(meta, localFingerprint(options.build()));
      setStatus('saved', `${message} · ${timeLabel(meta.modifiedTime)}`);
      try{ options.onPulled?.(meta); }catch(err){ console.warn(err); }
    }
    async function mergeAndUpload(meta, data=null){
      setStatus('loading', '드라이브 기록과 합치는 중…');
      data = data || await download(meta.id);
      applyData(() => options.merge(data));
      link = {...link, fileId:meta.id, remote:remoteTag(meta)};
      const payload = options.build();
      await upload(JSON.stringify(payload), localFingerprint(payload));
    }
    async function createNew(payload){
      setStatus('saving', '드라이브에 새 파일을 만드는 중…');
      const text = JSON.stringify(payload);
      const meta = await createFile(app, options.title(), text);
      remember(meta, localFingerprint(payload));
      setStatus('saved', savedMessage());
      await hourlyBackup(localFingerprint(payload));
    }

    // 처음 연결: 기기에 기록이 없으면 가장 최근 파일을 받고, 둘 다 있으면 사용자에게 고르게 한다.
    async function attach(payload, initial){
      const files = await listFiles(app);
      const empty = options.isEmpty();
      if(!files.length){
        if(empty) setStatus('idle', '드라이브 연결됨 · 채점을 시작하면 자동 저장됩니다');
        else await createNew(payload);
        return;
      }
      if(empty && initial && !link.pendingChoice){ await pull(files[0]); return; }
      if(empty && !link.pendingChoice){ setStatus('idle', '드라이브 연결됨 · 채점을 시작하면 자동 저장됩니다'); return; }
      // 새 시험으로 연결을 끊었을 때만 묻지 않고 새 파일을 만든다.
      // 그 밖에는 같은 이름의 파일이 겹쳐 생기지 않도록 사용자가 고르게 한다.
      if(link.detached && !empty){ await createNew(payload); return; }
      await askChoice('choose', initial);
    }

    async function syncNow(reason='auto'){
      clearTimeout(timer); timer = null;
      await run(async () => {
        const payload = options.build();
        const fp = localFingerprint(payload);
        if(accountSwitched()){ await askChoice('account', reason === 'open'); return; }
        if(!link.fileId){ await attach(payload, reason === 'open'); return; }
        if(reason === 'auto' && fp === link.syncedHash && ['saved', 'pending'].includes(status.state)){
          if(status.state === 'pending') setStatus('saved', savedMessage());
          return;
        }
        setStatus('checking', '드라이브 확인 중…');
        const meta = await getMeta(link.fileId);
        if(meta?.ownedByMe === false){
          saveLink(null);
          await createNew(payload);
          return;
        }
        const known = link.remote || {version:link.version};
        let action = syncAction({localHash:fp, syncedHash:link.syncedHash, remoteSame:sameRemote(known, meta), remoteExists:Boolean(meta)});
        let remoteData = null;
        if(action === 'download' || action === 'conflict'){
          // 표시만 바뀌고 내용은 마지막으로 맞춘 그대로면 다른 기기 변경이 아니다.
          remoteData = await download(meta.id);
          if(localFingerprint(remoteData) === link.syncedHash){
            saveLink({...link, remote:remoteTag(meta), modifiedTime:meta.modifiedTime});
            action = fp === link.syncedHash ? 'none' : 'upload';
          }
        }
        if(action === 'none'){ setStatus('saved', savedMessage()); return; }
        if(action === 'upload'){ await upload(JSON.stringify(payload), fp); return; }
        if(action === 'download'){ await pull(meta, remoteData); return; }
        if(action === 'missing'){
          saveLink(null);
          if(options.isEmpty()) setStatus('idle', '드라이브 파일이 삭제되었습니다 · 채점하면 새로 저장됩니다');
          else await createNew(payload);
          return;
        }
        const choice = await options.resolveConflict?.({name:meta.name, modifiedTime:meta.modifiedTime, timeLabel:timeLabel(meta.modifiedTime)});
        // 어느 쪽을 고르든 사라지는 쪽 기록을 먼저 백업한다. 백업이 안 되면 바꾸지 않는다.
        if(choice === 'merge'){
          await makeBackup('before-merge');
          await makeBackup('before-merge-remote', remoteData);
          await mergeAndUpload(meta, remoteData);
        }
        else if(choice === 'remote'){ await makeBackup('before-remote'); await pull(meta, remoteData); }
        else if(choice === 'local'){
          await makeBackup('before-overwrite', remoteData);
          link = {...link, remote:remoteTag(meta)};
          await upload(JSON.stringify(payload), fp);
        }
        else setStatus('conflict', '다른 기기의 변경과 겹칩니다 · 드라이브 창에서 확인해 주세요');
      });
    }
    function schedule(delay=options.delay ?? 3000){
      clearTimeout(timer);
      timer = setTimeout(() => syncNow('auto'), delay);
    }
    // 채점기가 저장할 때마다 부른다. 드라이브에서 받아 적용하는 중에는 무시한다.
    // 바뀐 즉시 '저장 대기'로 표시해, 아직 올라가지 않은 변경이 있다는 걸 보여 준다.
    // 충돌·파일 선택처럼 사용자가 봐야 하는 상태는 덮지 않는다.
    function changed(){
      if(applying || paused || authState() === 'signed-out') return;
      changeSeq++;
      if(!dirtySince) dirtySince = Date.now();
      if(authState() === 'signed-in' && !busy && !['conflict', 'choose'].includes(status.state)){
        setStatus('pending', '저장 대기 중 · 잠시 후 드라이브에 저장됩니다');
      }
      schedule();
    }
    function flush(){ if(timer) syncNow('auto'); }

    const doc = {
      get status(){ return status; },
      get link(){ loadLink(); return {...link}; },
      get applying(){ return applying; },
      // 드라이브에 아직 못 올린 변경이 생긴 시각. 0이면 모두 올라갔다.
      get unsyncedSince(){ return dirtySince; },
      get hasPendingChanges(){ return Boolean(dirtySince || timer || busy); },
      // 다른 탭이 채점을 넘겨받으면 이 탭은 드라이브 저장을 멈춘다.
      pause(){ paused = true; clearTimeout(timer); timer = null; },
      changed, flush,
      sync:() => syncNow('auto'),
      open:() => syncNow('open'),
      list:() => listFiles(app),
      // 드라이브 파일로 바꾸기
      openFile:id => run(async () => {
        const meta = await getMeta(id);
        if(!meta) throw new DriveError('드라이브 파일을 찾을 수 없습니다.', 'http', 404);
        if(meta.ownedByMe === false) throw new DriveError('공유받은 파일은 협동채점의 동료 채점 파일 추가로 연결해 주세요.', 'permission');
        await makeBackup('before-open');
        await pull(meta);
      }),
      // 지금 작업과 드라이브 파일을 합치고 그 파일에 이어서 저장
      mergeFile:id => run(async () => {
        const meta = await getMeta(id);
        if(!meta) throw new DriveError('드라이브 파일을 찾을 수 없습니다.', 'http', 404);
        if(meta.ownedByMe === false) throw new DriveError('공유받은 파일에는 내 채점을 저장할 수 없습니다.', 'permission');
        const remoteData = await download(meta.id);
        await makeBackup('before-merge');
        await makeBackup('before-merge-remote', remoteData);
        await mergeAndUpload(meta, remoteData);
      }),
      // 드라이브 백업 목록(최근 것부터)
      backups:() => listBackups(app),
      // 백업으로 되돌리기. 지금 기록을 먼저 백업하고, 바뀐 내용은 연결된 파일에 이어서 저장한다.
      restoreBackup:id => run(async () => {
        await makeBackup('before-restore');
        setStatus('loading', '백업에서 되돌리는 중…');
        const data = await download(id);
        applyData(() => options.apply(data));
        setStatus('pending', '백업으로 되돌렸습니다 · 잠시 후 드라이브에 저장됩니다');
        schedule(500);
      }),
      // 지금 기록을 바로 백업한다(새 시험 시작 전 등). 실패하면 false.
      async backupNow(reason='manual'){
        if(authState() !== 'signed-in') return false;
        try{ return Boolean(await makeBackup(reason)); }
        catch(err){ console.warn(err); return false; }
      },
      pruneBackups:() => pruneBackups(true),
      createFile:() => run(async () => { await createNew(options.build()); }),
      trashFile:async id => {
        if(busy) throw new DriveError('드라이브 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.', 'busy');
        let trashed = false;
        await run(async () => {
          if(id === link.fileId) throw new DriveError('자동 저장 중인 파일은 삭제할 수 없습니다. 다른 파일을 불러온 뒤 삭제해 주세요.', 'permission');
          const meta = await getMeta(id);
          if(!meta){ trashed = true; return; }
          if(meta.ownedByMe !== true) throw new DriveError('내 소유 파일만 삭제할 수 있습니다.', 'permission');
          await api(`${API}/files/${encodeURIComponent(id)}?fields=id,trashed`, {
            method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({trashed:true})
          });
          trashed = true;
        });
        return trashed;
      },
      // 새 시험을 시작할 때 이전 파일과의 연결을 끊는다. 다음 저장 때 새 파일이 만들어진다.
      detach(){
        clearTimeout(timer); timer = null; saveLink({detached:true, email:account()?.email || ''});
        if(authState() === 'signed-in') setStatus('idle', '드라이브 연결됨 · 채점을 시작하면 새 파일에 저장됩니다');
        else authStatus();
      }
    };

    onAuthChange(state => {
      if(state === 'signed-in' && status.state !== 'saving' && status.state !== 'checking') syncNow('open');
      else if(state !== 'signed-in') authStatus();
    });
    if(root.document && typeof root.document.addEventListener === 'function'){
      root.document.addEventListener('visibilitychange', () => {
        if(root.document.visibilityState === 'hidden') flush();
        else if(authState() === 'signed-in' && !busy) syncNow('focus');
      });
    }
    // 인터넷이 다시 연결되면 밀린 변경을 바로 올린다.
    if(typeof root.addEventListener === 'function') root.addEventListener('online', () => { if(dirtySince) schedule(500); });
    return doc;
  }

  const exported = {CLIENT_ID, SCOPE, AUTH_KEY, DOC_PREFIX, prepare, signIn, signOut, account, authState, onAuthChange, createDoc, timeLabel,
    normalizeEmail, parseEmails, pickerAvailable, pickFiles,
    files:{findByKey, uploadLarge, downloadBlob, getMeta, peerMeta, download, share:shareFile},
    _test:{hash, fingerprint, needsAutoReconnect, blockAuto:until => { autoBlockedUntil = until; }, syncAction, sameRemote, listFiles, getMeta, download, createFile, updateFile, backupsToTrash, BACKUP, resetFolder:() => { folderCache = null; backupFolderCache = null; }}};
  root.GoogleDriveSync = exported;
  if(typeof module !== 'undefined') module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
