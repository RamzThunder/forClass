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

  // ---------- 순수 함수 (테스트 대상) ----------
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
  function syncAction({localHash, syncedHash, knownVersion, remoteVersion, remoteExists}){
    if(!remoteExists) return 'missing';
    const dirty = localHash !== syncedHash;
    if(String(remoteVersion) === String(knownVersion)) return dirty ? 'upload' : 'none';
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
    return new Promise((resolve, reject) => {
      if(!tokenClient){
        prepare();
        reject(new Error('구글 로그인을 준비하고 있습니다. 잠시 후 다시 눌러 주세요.'));
        return;
      }
      pendingSignIn?.reject(new Error('새 로그인 요청으로 취소되었습니다.'));
      pendingSignIn = {resolve, reject};
      const known = account();
      tokenClient.requestAccessToken(known ? {prompt:'', login_hint:known.email} : {prompt:'consent'});
    });
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
  const FILE_FIELDS = 'id,name,modifiedTime,version';
  let folderCache = null;
  async function folderId(){
    if(folderCache) return folderCache;
    const q = `mimeType='${FOLDER_MIME}' and appProperties has { key='forClassRoot' and value='1' } and trashed=false`;
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
    const q = `appProperties has { key='forClassApp' and value='${escapeQuery(app)}' } and trashed=false`;
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
      saveLink({fileId:meta.id, name:meta.name, version:String(meta.version), modifiedTime:meta.modifiedTime, syncedHash:fp, email:account()?.email || ''});
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
    async function pull(meta, message='드라이브의 최신 기록을 불러왔습니다'){
      setStatus('loading', '드라이브에서 받는 중…');
      const data = await download(meta.id);
      applyData(() => options.apply(data));
      remember(meta, localFingerprint(options.build()));
      setStatus('saved', `${message} · ${timeLabel(meta.modifiedTime)}`);
      try{ options.onPulled?.(meta); }catch(err){ console.warn(err); }
    }
    async function mergeAndUpload(meta){
      setStatus('loading', '드라이브 기록과 합치는 중…');
      const data = await download(meta.id);
      applyData(() => options.merge(data));
      link = {...link, fileId:meta.id, version:String(meta.version)};
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
        if(reason === 'auto' && fp === link.syncedHash && status.state === 'saved') return;
        setStatus('checking', '드라이브 확인 중…');
        const meta = await getMeta(link.fileId);
        const action = syncAction({localHash:fp, syncedHash:link.syncedHash, knownVersion:link.version, remoteVersion:meta?.version, remoteExists:Boolean(meta)});
        if(action === 'none'){ setStatus('saved', savedMessage()); return; }
        if(action === 'upload'){ await upload(JSON.stringify(payload), fp); return; }
        if(action === 'download'){ await pull(meta); return; }
        if(action === 'missing'){
          saveLink(null);
          if(options.isEmpty()) setStatus('idle', '드라이브 파일이 삭제되었습니다 · 채점하면 새로 저장됩니다');
          else await createNew(payload);
          return;
        }
        const choice = await options.resolveConflict?.({name:meta.name, modifiedTime:meta.modifiedTime, timeLabel:timeLabel(meta.modifiedTime)});
        if(choice === 'merge') await mergeAndUpload(meta);
        else if(choice === 'remote') await pull(meta);
        else if(choice === 'local'){ link = {...link, version:String(meta.version)}; await upload(JSON.stringify(payload), fp); }
        else setStatus('conflict', '다른 기기의 변경과 겹칩니다 · 드라이브 창에서 확인해 주세요');
      });
    }
    function schedule(delay=options.delay ?? 3000){
      clearTimeout(timer);
      timer = setTimeout(() => syncNow('auto'), delay);
    }
    // 채점기가 저장할 때마다 부른다. 드라이브에서 받아 적용하는 중에는 무시한다.
    function changed(){
      if(applying || authState() === 'signed-out') return;
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
        await pull(meta);
      }),
      // 지금 작업과 드라이브 파일을 합치고 그 파일에 이어서 저장
      mergeFile:id => run(async () => {
        const meta = await getMeta(id);
        if(!meta) throw new DriveError('드라이브 파일을 찾을 수 없습니다.', 'http', 404);
        await mergeAndUpload(meta);
      }),
      createFile:() => run(async () => { await createNew(options.build()); }),
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
    _test:{hash, fingerprint, syncAction, listFiles, getMeta, download, createFile, updateFile, resetFolder:() => { folderCache = null; }}};
  root.GoogleDriveSync = exported;
  if(typeof module !== 'undefined') module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
