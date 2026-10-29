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
    return (await api(`${API}/files/${encodeURIComponent(id)}?fields=id,name,modifiedTime,trashed,owners(emailAddress,displayName)`)).json();
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
    let link = readJson(key) || {};
    let status = {state:'', message:''};
    let busy = false, again = false, timer = null, applying = false;

    function saveLink(next){ link = next || {}; writeJson(key, next ? link : null); }
    function setStatus(state, message){
      status = {state, message};
      try{ options.onStatus?.(status); }catch(err){ console.warn(err); }
    }
    function localFingerprint(payload){ return fingerprint(payload, volatileKeys); }
    function remember(meta, fp){
      saveLink({fileId:meta.id, name:meta.name, remote:remoteTag(meta), modifiedTime:meta.modifiedTime, syncedHash:fp, email:account()?.email || ''});
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
      if(busy){ again = true; return; }
      if(authState() !== 'signed-in'){ authStatus(); return; }
      busy = true;
      try{
        if(link.email && link.email !== account()?.email) saveLink(null);
        await task();
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
      if(link.pendingChoice || initial){
        if(empty && initial && !link.pendingChoice){ await pull(files[0]); return; }
        saveLink({pendingChoice:true, email:account()?.email || ''});
        setStatus('choose', '드라이브 파일을 골라 주세요');
        if(initial) options.onNeedChoice?.(files);
        return;
      }
      if(empty) setStatus('idle', '드라이브 연결됨 · 채점을 시작하면 자동 저장됩니다');
      else await createNew(payload);
    }

    async function syncNow(reason='auto'){
      clearTimeout(timer); timer = null;
      await run(async () => {
        const payload = options.build();
        const fp = localFingerprint(payload);
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
        if(choice === 'merge') await mergeAndUpload(meta, remoteData);
        else if(choice === 'remote') await pull(meta, remoteData);
        else if(choice === 'local'){ link = {...link, remote:remoteTag(meta)}; await upload(JSON.stringify(payload), fp); }
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
      if(applying || authState() === 'signed-out') return;
      if(authState() === 'signed-in' && !busy && !['conflict', 'choose'].includes(status.state)){
        setStatus('pending', '저장 대기 중 · 잠시 후 드라이브에 저장됩니다');
      }
      schedule();
    }
    function flush(){ if(timer) syncNow('auto'); }

    const doc = {
      get status(){ return status; },
      get link(){ return {...link}; },
      get applying(){ return applying; },
      changed, flush,
      sync:() => syncNow('auto'),
      open:() => syncNow('open'),
      list:() => listFiles(app),
      // 드라이브 파일로 바꾸기
      openFile:id => run(async () => {
        const meta = await getMeta(id);
        if(!meta) throw new DriveError('드라이브 파일을 찾을 수 없습니다.', 'http', 404);
        if(meta.ownedByMe === false) throw new DriveError('공유받은 파일은 협동채점의 동료 채점 파일 추가로 연결해 주세요.', 'permission');
        await pull(meta);
      }),
      // 지금 작업과 드라이브 파일을 합치고 그 파일에 이어서 저장
      mergeFile:id => run(async () => {
        const meta = await getMeta(id);
        if(!meta) throw new DriveError('드라이브 파일을 찾을 수 없습니다.', 'http', 404);
        if(meta.ownedByMe === false) throw new DriveError('공유받은 파일에는 내 채점을 저장할 수 없습니다.', 'permission');
        await mergeAndUpload(meta);
      }),
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
        clearTimeout(timer); timer = null; saveLink(null);
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
    return doc;
  }

  const exported = {CLIENT_ID, SCOPE, AUTH_KEY, DOC_PREFIX, prepare, signIn, signOut, account, authState, onAuthChange, createDoc, timeLabel,
    normalizeEmail, parseEmails, pickerAvailable, pickFiles,
    files:{findByKey, uploadLarge, downloadBlob, getMeta, peerMeta, download, share:shareFile},
    _test:{hash, fingerprint, needsAutoReconnect, blockAuto:until => { autoBlockedUntil = until; }, syncAction, sameRemote, listFiles, getMeta, download, createFile, updateFile, resetFolder:() => { folderCache = null; }}};
  root.GoogleDriveSync = exported;
  if(typeof module !== 'undefined') module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
