const {test, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// 브라우저 대신 쓸 localStorage와 가짜 드라이브
const store = new Map();
globalThis.localStorage = {
  getItem:k => store.has(k) ? store.get(k) : null,
  setItem:(k, v) => store.set(k, String(v)),
  removeItem:k => store.delete(k)
};
let drive;
// 파일 속성. 테스트에서 직접 넣은 파일은 app/key/folder로 흉내 낸다.
function props(f){
  return f.props || {...(f.app ? {forClassApp:f.app} : {}), ...(f.key ? {forClassKey:f.key} : {}), ...(f.folder ? {forClassRoot:'1'} : {})};
}
// 채점 파일(백업·폴더 제외) 수
function gradingFiles(app='omr'){ return [...drive.files.values()].filter(f => !f.trashed && !f.folder && props(f).forClassApp === app).length; }
function backupFiles(){ return [...drive.files.values()].filter(f => !f.trashed && props(f).forClassBackup); }
function resetDrive(){
  drive = {files:new Map(), sessions:new Map(), next:1, calls:[], dropPuts:0};
}
function json(body, status=200){
  return {ok:status < 400, status, json:async () => body, text:async () => typeof body === 'string' ? body : JSON.stringify(body)};
}
globalThis.fetch = async (url, options={}) => {
  const u = new URL(url);
  const method = options.method || 'GET';
  drive.calls.push(`${method} ${u.pathname}`);
  if(drive.offline) throw new TypeError('network');
  const touch = f => { f.version += 1; f.modifiedTime = new Date(Date.now() + f.version).toISOString(); };
  const meta = f => ({
    capabilities:{canShare:f.canShare !== false}, id:f.id, createdTime:f.createdTime || f.modifiedTime, appProperties:props(f), name:f.name, ownedByMe:f.ownedByMe !== false, modifiedTime:f.modifiedTime, version:String(f.version), trashed:f.trashed || false,
    ...(f.folder || drive.noChecksum ? {} : {md5Checksum:crypto.createHash('md5').update(f.bytes || f.content || '').digest('hex')}),
    headRevisionId:drive.noChecksum ? `r${f.version}` : undefined
  });
  // 재개 가능 업로드 세션
  if(u.hostname === 'upload.test'){
    const session = drive.sessions.get(u.pathname);
    const range = options.headers['Content-Range'];
    if(drive.dropPuts > 0 && range !== `bytes */${session.total}`){ drive.dropPuts -= 1; throw new TypeError('network'); }
    const status308 = () => ({ok:false, status:308, headers:{get:k => k === 'Range' && session.received ? `bytes=0-${session.received - 1}` : null}});
    if(range.startsWith('bytes */')) return status308();
    const [, from] = /bytes (\d+)-(\d+)\/(\d+)/.exec(range).map(Number);
    assert.equal(from, session.received, '서버가 받은 곳부터 이어서 올려야 한다');
    const bytes = Buffer.from(await options.body.arrayBuffer());
    session.chunks.push(bytes);
    session.received += bytes.length;
    if(session.received < session.total) return status308();
    const f = {id:`f${drive.next++}`, name:session.meta.name, app:session.meta.appProperties.forClassApp, key:session.meta.appProperties.forClassKey, bytes:Buffer.concat(session.chunks), version:1, modifiedTime:new Date().toISOString()};
    drive.files.set(f.id, f);
    return json({id:f.id, name:f.name, size:String(f.bytes.length)});
  }
  if(u.pathname === '/upload/drive/v3/files' && method === 'POST' && u.searchParams.get('uploadType') === 'resumable'){
    const path = `/session/${drive.next++}`;
    drive.sessions.set(path, {meta:JSON.parse(options.body), total:Number(options.headers['X-Upload-Content-Length']), received:0, chunks:[]});
    return {...json({}), headers:{get:k => k === 'Location' ? `https://upload.test${path}` : null}};
  }
  if(u.pathname === '/drive/v3/files' && method === 'GET'){
    const q = u.searchParams.get('q');
    const clauses = [...q.matchAll(/key='([^']+)' and value='([^']+)'/g)].map(m => [m[1], m[2]]);
    const isFolder = q.includes("mimeType='application/vnd.google-apps.folder'");
    const files = [...drive.files.values()].filter(f => !f.trashed && (!q.includes("'me' in owners") || f.ownedByMe !== false) && Boolean(f.folder) === isFolder && clauses.every(([k, v]) => props(f)[k] === v))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    return json({files:files.map(meta)});
  }
  if(u.pathname === '/drive/v3/files' && method === 'POST'){
    const body = JSON.parse(options.body);
    const f = {id:`f${drive.next++}`, name:body.name, folder:true, props:body.appProperties || {}, version:1, modifiedTime:new Date().toISOString()};
    drive.files.set(f.id, f);
    return json({id:f.id});
  }
  if(u.pathname === '/upload/drive/v3/files' && method === 'POST'){
    const parts = options.body.split(/--forClass\w+/);
    const metaPart = JSON.parse(parts[1].split('\r\n\r\n')[1]);
    const content = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    const f = {id:`f${drive.next++}`, name:metaPart.name, app:metaPart.appProperties.forClassApp, props:metaPart.appProperties, content, version:1, modifiedTime:new Date().toISOString()};
    drive.files.set(f.id, f);
    return json(meta(f));
  }
  if(u.pathname.endsWith('/permissions') && method === 'POST'){
    drive.lastPermission = JSON.parse(options.body);
    if(drive.shareError) return json({error:{message:'sharing denied'}}, drive.shareError);
    return json({id:'permission1'});
  }
  const m = /^\/(upload\/)?drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if(m){
    const f = drive.files.get(m[2]);
    if(!f) return json({error:{message:'not found'}}, 404);
    if(method === 'PATCH'){
      if(options.headers?.['Content-Type'] === 'application/json' && JSON.parse(options.body).trashed === true) f.trashed = true;
      else f.content = options.body;
      touch(f); return json(meta(f));
    }
    if(u.searchParams.get('alt') === 'media' && f.bytes){
      let sent = false;
      return {ok:true, status:200, headers:{get:k => k === 'Content-Length' ? String(f.bytes.length) : null}, body:{getReader:() => ({
        read:async () => {
          if(sent) return {done:true};
          sent = true;
          return {done:false, value:new Uint8Array(f.bytes)};
        }
      })}};
    }
    if(u.searchParams.get('alt') === 'media') return json(f.content);
    return json(meta(f));
  }
  throw new Error(`unexpected ${method} ${url}`);
};

const G = require('../google-drive-sync.js');
const {fingerprint, syncAction, sameRemote} = G._test;

function signIn(email='teacher@example.com'){
  localStorage.setItem(G.AUTH_KEY, JSON.stringify({token:'t', expiresAt:Date.now() + 3600e3, email}));
}
// 채점기 하나를 흉내 낸다.
function grader(app='omr', initial={records:{}}){
  const g = {data:structuredClone(initial), conflicts:[], choices:[], statuses:[]};
  g.doc = G.createDoc({
    app,
    delay:0,
    volatileKeys:['exportedAt'],
    title:() => `[OMR] ${g.data.title || '시험'}.json`,
    build:() => ({...structuredClone(g.data), exportedAt:Math.random()}),
    apply:data => { g.data = structuredClone(data); delete g.data.exportedAt; },
    merge:data => { g.data.records = {...data.records, ...g.data.records}; },
    isEmpty:() => !Object.keys(g.data.records).length,
    resolveConflict:info => { g.conflicts.push(info); return g.conflictChoice; },
    onNeedChoice:files => g.choices.push(files),
    onStatus:s => g.statuses.push(s)
  });
  return g;
}
const last = g => g.statuses.at(-1);

beforeEach(() => { store.clear(); resetDrive(); G._test.resetFolder(); });

test('syncAction: 바뀐 쪽에 따라 올리기·받기·충돌을 고른다', () => {
  const base = {syncedHash:'a', remoteExists:true};
  assert.equal(syncAction({...base, localHash:'a', remoteSame:true}), 'none');
  assert.equal(syncAction({...base, localHash:'b', remoteSame:true}), 'upload');
  assert.equal(syncAction({...base, localHash:'a', remoteSame:false}), 'download');
  assert.equal(syncAction({...base, localHash:'b', remoteSame:false}), 'conflict');
  assert.equal(syncAction({...base, localHash:'a', remoteExists:false}), 'missing');
});

test('sameRemote: version보다 내용 체크섬을 먼저 본다', () => {
  assert.equal(sameRemote({md5:'x', version:'3'}, {md5Checksum:'x', version:'9'}), true);
  assert.equal(sameRemote({md5:'x', version:'3'}, {md5Checksum:'y', version:'3'}), false);
  assert.equal(sameRemote({rev:'r1'}, {headRevisionId:'r1', version:'9'}), true);
  assert.equal(sameRemote({version:'3'}, {version:'3'}), true);
  assert.equal(sameRemote({}, {version:'3'}), false);
});

test('저장 직후 구글 서버가 version만 올려도 충돌로 보지 않는다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const file = drive.files.get(g.doc.link.fileId);
  for(let i=0;i<3;i++){
    file.version += 2;
    g.data.records[`n${i}`] = i;
    await g.doc.sync();
  }
  assert.equal(g.conflicts.length, 0);
  assert.equal(last(g).state, 'saved');
  assert.deepEqual(JSON.parse(file.content).records, {a:1, n0:0, n1:1, n2:2});
});

test('체크섬이 없어도 내용이 마지막 저장과 같으면 충돌로 보지 않는다', async () => {
  signIn();
  drive.noChecksum = true;
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const file = drive.files.get(g.doc.link.fileId);
  file.version += 1;
  g.data.records.b = 2;
  await g.doc.sync();
  assert.equal(g.conflicts.length, 0);
  assert.deepEqual(JSON.parse(file.content).records, {a:1, b:2});
});

test('이전 형식(version만 기억)의 연결도 충돌 없이 이어진다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const key = G.DOC_PREFIX + 'omr';
  // 예전에는 계정별 구분 없이 연결 하나만 저장했다.
  const old = JSON.parse(localStorage.getItem(key)).byAccount['teacher@example.com'];
  delete old.remote;
  old.version = '1';
  localStorage.setItem(key, JSON.stringify(old));
  drive.files.get(old.fileId).version += 3;
  const again = grader('omr', {records:{a:1, b:2}});
  await again.doc.open();
  assert.equal(again.conflicts.length, 0);
  assert.deepEqual(JSON.parse(drive.files.get(old.fileId).content).records, {a:1, b:2});
});

test('fingerprint: 화면 위치 같은 값은 무시하고 채점 내용 변화만 본다', () => {
  const a = fingerprint({records:{1:5}, exportedAt:1}, ['exportedAt']);
  assert.equal(a, fingerprint({records:{1:5}, exportedAt:2}, ['exportedAt']));
  assert.notEqual(a, fingerprint({records:{1:6}, exportedAt:1}, ['exportedAt']));
});

test('로그인 전에는 드라이브에 접근하지 않는다', async () => {
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  assert.equal(last(g).state, 'signed-out');
  assert.equal(drive.calls.length, 0);
});

test('기록이 있으면 처음 연결 때 새 파일을 만들고, 이후 바뀐 것만 저장한다', async () => {
  signIn();
  const g = grader('omr', {title:'중간', records:{a:1}});
  await g.doc.open();
  assert.equal(last(g).state, 'saved');
  const file = drive.files.get(g.doc.link.fileId);
  assert.equal(file.name, '[OMR] 중간.json');
  assert.deepEqual(JSON.parse(file.content).records, {a:1});

  drive.calls.length = 0;
  await g.doc.sync();
  assert.equal(drive.calls.length, 0, '바뀐 게 없으면 요청하지 않는다');

  g.data.records.b = 2;
  await g.doc.sync();
  assert.deepEqual(JSON.parse(file.content).records, {a:1, b:2});
  assert.equal(file.version, 2);
});

test('새 기기에서 기록이 없으면 가장 최근 드라이브 파일을 자동으로 불러온다', async () => {
  signIn();
  const first = grader('omr', {records:{a:1}});
  await first.doc.open();
  store.delete(G.DOC_PREFIX + 'omr');
  const other = grader('omr');
  await other.doc.open();
  assert.deepEqual(other.data.records, {a:1});
  assert.equal(other.doc.link.fileId, first.doc.link.fileId);
});

test('다른 기기에서 바뀐 파일은 다시 열 때 받아 온다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const file = drive.files.get(g.doc.link.fileId);
  file.content = JSON.stringify({records:{a:1, z:9}});
  file.version += 1;
  await g.doc.open();
  assert.deepEqual(g.data.records, {a:1, z:9});
  assert.equal(last(g).state, 'saved');
});

test('양쪽이 모두 바뀌면 묻고, 합치기를 고르면 합친 결과를 저장한다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const file = drive.files.get(g.doc.link.fileId);
  file.content = JSON.stringify({records:{z:9}});
  file.version += 1;
  g.data.records.b = 2;
  g.conflictChoice = 'merge';
  await g.doc.sync();
  assert.equal(g.conflicts.length, 1);
  assert.deepEqual(JSON.parse(file.content).records, {z:9, a:1, b:2});
  assert.equal(last(g).state, 'saved');
});

test('충돌에서 아무것도 고르지 않으면 덮어쓰지 않는다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const file = drive.files.get(g.doc.link.fileId);
  file.content = JSON.stringify({records:{z:9}});
  file.version += 1;
  g.data.records.b = 2;
  await g.doc.sync();
  assert.equal(last(g).state, 'conflict');
  assert.deepEqual(JSON.parse(file.content).records, {z:9});
});

test('기기에도 드라이브에도 기록이 있으면 첫 연결 때 고르게 한다', async () => {
  signIn();
  const first = grader('omr', {records:{a:1}});
  await first.doc.open();
  store.delete(G.DOC_PREFIX + 'omr');
  const other = grader('omr', {records:{b:2}});
  await other.doc.open();
  assert.equal(other.choices.length, 1);
  assert.equal(last(other).state, 'choose');
  await other.doc.sync();
  assert.equal(gradingFiles(), 1, '고르기 전에는 새 파일을 만들지 않는다');
  await other.doc.mergeFile(first.doc.link.fileId);
  assert.deepEqual(JSON.parse(drive.files.get(first.doc.link.fileId).content).records, {a:1, b:2});
});

test('새 시험으로 연결을 끊으면 다음 저장 때 새 파일을 만든다', async () => {
  signIn();
  const g = grader('omr', {title:'중간', records:{a:1}});
  await g.doc.open();
  const oldId = g.doc.link.fileId;
  g.doc.detach();
  g.data = {title:'기말', records:{c:3}};
  await g.doc.sync();
  assert.notEqual(g.doc.link.fileId, oldId);
  assert.equal(drive.files.get(g.doc.link.fileId).name, '[OMR] 기말.json');
  assert.deepEqual(JSON.parse(drive.files.get(oldId).content).records, {a:1});
});

test('오프라인이면 기기에 남겨 두고 연결되면 올린다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  drive.offline = true;
  g.data.records.b = 2;
  await g.doc.sync();
  assert.equal(last(g).state, 'offline');
  drive.offline = false;
  await g.doc.sync();
  assert.deepEqual(JSON.parse(drive.files.get(g.doc.link.fileId).content).records, {a:1, b:2});
});

test('로그인이 만료되면(401) 만료 상태로 바뀐다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => json({}, 401);
  g.data.records.b = 2;
  await g.doc.sync();
  globalThis.fetch = realFetch;
  assert.equal(G.authState(), 'expired');
  assert.equal(last(g).state, 'expired');
});

test('다른 계정으로 로그인하면 이전 계정의 파일 연결을 쓰지 않고, 새 파일도 만들지 않고 고르게 한다', async () => {
  signIn('a@example.com');
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const oldId = g.doc.link.fileId;
  const before = gradingFiles();
  signIn('b@example.com');
  G._test.resetFolder();
  await g.doc.sync();
  assert.notEqual(g.doc.link.fileId, oldId);
  assert.equal(last(g).state, 'choose');
  assert.equal(g.choices.length, 1);
  assert.equal(gradingFiles(), before, '고르기 전에는 새 파일을 만들지 않는다');
  await g.doc.sync();
  assert.equal(g.choices.length, 1, '자동 저장마다 창을 다시 띄우지 않는다');
});

test('계정을 오가도 각 계정은 자기 파일로 돌아가고 같은 이름의 파일이 늘지 않는다', async () => {
  signIn('a@example.com');
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const fileA = g.doc.link.fileId;
  // B 계정으로 바꾸고 B의 새 파일을 만든다.
  signIn('b@example.com');
  await g.doc.sync();
  await g.doc.createFile();
  const fileB = g.doc.link.fileId;
  assert.notEqual(fileB, fileA);
  const count = gradingFiles();
  // A로 돌아오면: 기기 기록은 B와 맞춘 것이라 덮어쓰지 않고 고르게 한다.
  signIn('a@example.com');
  g.data.records.b = 2;
  await g.doc.sync();
  assert.equal(last(g).state, 'choose');
  assert.equal(g.doc.link.fileId, fileA, 'A 계정의 파일 연결을 기억한다');
  assert.equal(gradingFiles(), count, '새 파일을 만들지 않는다');
  assert.deepEqual(JSON.parse(drive.files.get(fileA).content).records, {a:1}, 'A 파일을 B의 기록으로 덮지 않는다');
  // A 파일을 불러오면 다시 그 파일에 이어서 저장한다.
  await g.doc.openFile(fileA);
  g.data.records.c = 3;
  await g.doc.sync();
  assert.equal(g.doc.link.fileId, fileA);
  assert.deepEqual(JSON.parse(drive.files.get(fileA).content).records, {a:1, c:3});
  assert.equal(gradingFiles(), count);
});

test('예전 형식으로 다른 계정 연결이 남아 있어도 새 파일을 만들지 않는다', async () => {
  signIn('a@example.com');
  const g0 = grader('omr', {records:{a:1}});
  await g0.doc.open();
  const fileA = g0.doc.link.fileId;
  localStorage.setItem(G.DOC_PREFIX + 'omr', JSON.stringify({fileId:fileA, email:'a@example.com'}));
  signIn('b@example.com');
  const g = grader('omr', {records:{a:1}});
  const before = gradingFiles();
  await g.doc.sync();
  assert.equal(last(g).state, 'choose');
  assert.equal(gradingFiles(), before);
});

test('연결이 없는데 드라이브에 파일이 있으면 자동 저장이 새 파일을 만들지 않고 고르게 한다', async () => {
  signIn();
  const first = grader('omr', {records:{a:1}});
  await first.doc.open();
  store.delete(G.DOC_PREFIX + 'omr');
  const other = grader('omr', {records:{b:2}});
  const before = gradingFiles();
  await other.doc.sync();
  assert.equal(last(other).state, 'choose');
  assert.equal(other.choices.length, 1);
  assert.equal(gradingFiles(), before);
});

test('큰 PDF는 조각으로 나눠 올리고, 같은 파일을 찾고, 그대로 받아 온다', async () => {
  signIn();
  const bytes = Buffer.alloc(20 * 1024 * 1024 + 123, 7);
  bytes[5] = 1; bytes[bytes.length - 1] = 9;
  const progress = [];
  const meta = await G.files.uploadLarge({app:'omr-pdf', key:'시험.pdf|20971643', name:'시험.pdf', mimeType:'application/pdf', blob:new Blob([bytes]), onProgress:p => progress.push(p)});
  const stored = drive.files.get(meta.id);
  assert.equal(Buffer.compare(stored.bytes, bytes), 0);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.length >= 4, '조각마다 진행률을 알린다');
  assert.equal((await G.files.findByKey('omr-pdf', '시험.pdf|20971643')).id, meta.id);
  assert.equal(await G.files.findByKey('omr-pdf', '시험.pdf|1'), null);
  const got = [];
  const blob = await G.files.downloadBlob(meta.id, {mimeType:'application/pdf', onProgress:p => got.push(p)});
  assert.equal(Buffer.compare(Buffer.from(await blob.arrayBuffer()), bytes), 0);
  assert.equal(blob.type, 'application/pdf');
  assert.equal(got.at(-1), 1);
});

test('PDF를 올리다 인터넷이 끊겨도 받은 곳부터 이어서 올린다', async () => {
  signIn();
  const bytes = Buffer.alloc(17 * 1024 * 1024, 3);
  drive.dropPuts = 1;
  const meta = await G.files.uploadLarge({app:'omr-pdf', key:'k', name:'a.pdf', blob:new Blob([bytes])});
  assert.equal(Buffer.compare(drive.files.get(meta.id).bytes, bytes), 0);
});

test('만료됐거나 10분 안에 만료될 때만 클릭 시 자동 재연결한다', () => {
  const now = Date.now();
  const setAuth = value => localStorage.setItem(G.AUTH_KEY, JSON.stringify(value));
  G._test.blockAuto(0);
  assert.equal(G._test.needsAutoReconnect(now), false, '로그인한 적 없으면 하지 않음');
  setAuth({token:'t', expiresAt:now + 50 * 60000, email:'a@b.c'});
  assert.equal(G._test.needsAutoReconnect(now), false, '아직 넉넉하면 하지 않음');
  setAuth({token:'t', expiresAt:now + 5 * 60000, email:'a@b.c'});
  assert.equal(G._test.needsAutoReconnect(now), true, '곧 만료되면 미리 재연결');
  setAuth({token:'', expiresAt:0, email:'a@b.c'});
  assert.equal(G._test.needsAutoReconnect(now), true, '만료되면 재연결');
  G._test.blockAuto(now + 60000);
  assert.equal(G._test.needsAutoReconnect(now), false, '실패 직후에는 다시 띄우지 않음');
  G._test.blockAuto(0);
});

test('바뀌면 바로 저장 대기로 표시하고, 저장되면 저장됨으로 바뀐다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  assert.equal(last(g).state, 'saved');
  g.data.records.b = 2;
  g.doc.changed();
  assert.equal(last(g).state, 'pending');
  await g.doc.sync();
  assert.equal(last(g).state, 'saved');
  assert.deepEqual(JSON.parse(drive.files.get(g.doc.link.fileId).content).records, {a:1, b:2});
});

test('내용이 그대로면 저장 대기에서 드라이브 요청 없이 저장됨으로 돌아간다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  drive.calls.length = 0;
  g.doc.changed();
  await g.doc.sync();
  assert.equal(last(g).state, 'saved');
  assert.equal(drive.calls.length, 0);
});

test('충돌 확인 중에는 저장 대기로 덮지 않는다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  drive.files.get(g.doc.link.fileId).content = JSON.stringify({records:{z:9}});
  g.data.records.b = 2;
  await g.doc.sync();
  assert.equal(last(g).state, 'conflict');
  g.doc.changed();
  assert.equal(last(g).state, 'conflict');
});


test('shared files and folders are excluded from personal storage discovery', async () => {
  signIn();
  drive.files.set('peer-json', {id:'peer-json', app:'omr', name:'peer', ownedByMe:false, version:1, modifiedTime:'2026-01-01', content:'{}'});
  drive.files.set('peer-folder', {id:'peer-folder', folder:true, ownedByMe:false, version:1, modifiedTime:'2026-01-01'});
  drive.files.set('peer-pdf', {id:'peer-pdf', app:'omr-pdf', key:G._test.hash('answer'), ownedByMe:false, version:1, modifiedTime:'2026-01-01'});
  assert.deepEqual(await G._test.listFiles('omr'), []);
  assert.equal(await G.files.findByKey('omr-pdf', 'answer'), null);
  const g = grader('omr', {records:{a:1}});
  await g.doc.sync();
  assert.notEqual(g.doc.link.fileId, 'peer-json');
  assert.equal([...drive.files.values()].filter(f => f.folder && props(f).forClassRoot).length, 2);
});

test('old shared JSON connection saves local work to a new owned file', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.sync();
  const oldId = g.doc.link.fileId;
  drive.files.get(oldId).ownedByMe = false;
  const original = drive.files.get(oldId).content;
  g.data.records.b = 2;
  await g.doc.sync();
  assert.notEqual(g.doc.link.fileId, oldId);
  assert.equal(drive.files.get(oldId).content, original);
  assert.deepEqual(JSON.parse(drive.files.get(g.doc.link.fileId).content).records, {a:1,b:2});
});


test('sharing verifies actual ownership and sharing capability before mutation', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.sync();
  const id = g.doc.link.fileId;
  const file = drive.files.get(id);
  file.ownedByMe = false;
  await assert.rejects(G.files.share(id, 'peer@example.com'), /내 소유/);
  file.ownedByMe = true;
  file.canShare = false;
  await assert.rejects(G.files.share(id, 'peer@example.com'), /공유가 제한/);
  assert.equal(drive.calls.filter(c => c.endsWith('/permissions')).length, 0);
  file.canShare = true;
  await G.files.share(id, 'PEER@example.com');
  assert.deepEqual(drive.lastPermission, {type:'user', role:'reader', emailAddress:'peer@example.com'});
});

test('Google rejection identifies the verified file and keeps sharing failure visible', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.sync();
  drive.shareError = 400;
  await assert.rejects(G.files.share(g.doc.link.fileId, 'peer@example.com'), err => {
    assert.equal(err.status, 400);
    assert.match(err.message, /내 소유 파일 확인 완료/);
    assert.match(err.message, /드라이브에서 내 파일 열기/);
    return true;
  });
});


test('trash moves only inactive owned files to trash and preserves current work', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.sync();
  const oldId = g.doc.link.fileId;
  await g.doc.createFile();
  const currentId = g.doc.link.fileId;
  assert.equal(await g.doc.trashFile(currentId), false);
  assert.equal(drive.files.get(currentId).trashed, undefined);
  assert.equal(await g.doc.trashFile(oldId), true);
  assert.equal(drive.files.get(oldId).trashed, true);
  assert.deepEqual((await g.doc.list()).map(f => f.id), [currentId]);
  assert.equal(g.doc.link.fileId, currentId);
  assert.deepEqual(g.data.records, {a:1});
});

test('trash rejects peer files and reports server errors without removing files', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.sync();
  const oldId = g.doc.link.fileId;
  await g.doc.createFile();
  drive.files.get(oldId).ownedByMe = false;
  assert.equal(await g.doc.trashFile(oldId), false);
  assert.equal(drive.files.get(oldId).trashed, undefined);
  drive.files.get(oldId).ownedByMe = true;
  drive.offline = true;
  assert.equal(await g.doc.trashFile(oldId), false);
  assert.equal(drive.files.get(oldId).trashed, undefined);
});

// ---------- 자동 백업 ----------
const backupState = (email='teacher@example.com') => G.DOC_PREFIX + 'omr.backup.' + email;
const backupRecords = f => JSON.parse(f.content).records;

test('백업: 첫 저장 때 하나 만들고, 1시간 안이나 바뀐 게 없으면 더 만들지 않는다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  assert.equal(backupFiles().length, 1);
  assert.deepEqual(backupRecords(backupFiles()[0]), {a:1});
  assert.match(backupFiles()[0].name, /^\[OMR\] 시험 백업 \d{4}-\d\d-\d\d \d\d-\d\d \(자동\)\.json$/);
  g.data.records.b = 2;
  await g.doc.sync();
  assert.equal(backupFiles().length, 1, '1시간 안에는 만들지 않는다');
  // 1시간이 지난 것처럼
  const st = JSON.parse(localStorage.getItem(backupState()));
  localStorage.setItem(backupState(), JSON.stringify({...st, at:Date.now() - 2 * 3600e3}));
  g.data.records.c = 3;
  await g.doc.sync();
  assert.equal(backupFiles().length, 2);
  assert.equal(gradingFiles(), 1, '백업은 채점 파일 목록에 나오지 않는다');
  assert.equal((await g.doc.list()).length, 1);
});

test('백업: 불러오기 전에 이 기기 기록을 남긴다', async () => {
  signIn();
  const a = grader('omr', {records:{a:1}});
  await a.doc.open();
  const fileA = a.doc.link.fileId;
  a.data = {records:{x:9}};
  await a.doc.createFile();
  const before = backupFiles().length;
  await a.doc.openFile(fileA);
  const added = backupFiles().slice(before);
  assert.equal(added.length, 1);
  assert.match(added[0].name, /불러오기 전/);
  assert.deepEqual(backupRecords(added[0]), {x:9});
  assert.deepEqual(a.data.records, {a:1});
});

test('백업: 합치기 전에 양쪽 기록을 남긴다', async () => {
  signIn();
  const a = grader('omr', {records:{a:1}});
  await a.doc.open();
  const fileA = a.doc.link.fileId;
  a.data = {records:{a:5, b:2}};
  const before = backupFiles().length;
  await a.doc.mergeFile(fileA);
  const added = backupFiles().slice(before).map(backupRecords);
  assert.deepEqual(added.sort((x, y) => Object.keys(x).length - Object.keys(y).length), [{a:1}, {a:5, b:2}]);
});

test('백업: 충돌에서 덮어쓰기를 고르면 드라이브 쪽 기록을 먼저 남긴다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  drive.files.get(g.doc.link.fileId).content = JSON.stringify({records:{z:9}});
  drive.files.get(g.doc.link.fileId).version += 1;
  g.data.records.b = 2;
  g.conflictChoice = 'local';
  const before = backupFiles().length;
  await g.doc.sync();
  const added = backupFiles().slice(before);
  assert.equal(added.length, 1);
  assert.deepEqual(backupRecords(added[0]), {z:9});
});

test('백업: 백업으로 되돌리면 지금 기록을 먼저 남기고 되돌린 내용을 이어서 저장한다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const [first] = await g.doc.backups();
  g.data.records.b = 2;
  await g.doc.sync();
  await g.doc.restoreBackup(first.id);
  assert.deepEqual(g.data.records, {a:1});
  assert.ok(backupFiles().some(f => /복원 전/.test(f.name) && backupRecords(f).b === 2));
  await g.doc.sync();
  assert.deepEqual(JSON.parse(drive.files.get(g.doc.link.fileId).content).records, {a:1});
});

test('백업 정리: 시험마다 최근 3개, 최근 2일은 모두, 30일까지 하루 1개만 남긴다', () => {
  const now = Date.parse('2026-10-30T12:00:00');
  const at = (h, exam='e1') => ({id:`${exam}-${h}`, createdTime:new Date(now - h * 3600e3).toISOString(), appProperties:{forClassExam:exam}});
  const files = [at(1), at(5), at(30), at(47),            // 2일 안: 모두 남김
    at(50), at(52), at(75), at(80),                         // 3~4일 전: 날마다 마지막 1개
    at(31 * 24), at(40 * 24),                               // 30일 넘음: 삭제
    at(60 * 24, 'e2'), at(61 * 24, 'e2'), at(62 * 24, 'e2'), at(63 * 24, 'e2')]; // 다른 시험: 최근 3개는 남김
  const trashed = G._test.backupsToTrash(files, now).map(f => f.id).sort();
  const dayOf = h => new Date(now - h * 3600e3).toDateString();
  const expectedDaily = [50, 52, 75, 80].filter((h, i, arr) => arr.findIndex(x => dayOf(x) === dayOf(h)) !== i || [1, 5, 30, 47].some(x => dayOf(x) === dayOf(h)));
  const expected = [...expectedDaily.map(h => `e1-${h}`), `e1-${31 * 24}`, `e1-${40 * 24}`, `e2-${63 * 24}`].sort();
  assert.deepEqual(trashed, expected);
});

test('백업 정리: 오래된 백업만 휴지통으로 옮기고 채점 파일은 건드리지 않는다', async () => {
  signIn();
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const old = backupFiles()[0];
  for(let i = 0; i < 4; i++){
    const id = `old${i}`;
    drive.files.set(id, {...old, id, createdTime:new Date(Date.now() - (40 + i) * 24 * 3600e3).toISOString(), trashed:false});
  }
  const count = await g.doc.pruneBackups();
  assert.equal(count, 2, '최근 3개(지금 것 + 40·41일 전)는 남긴다');
  assert.equal(drive.files.get('old1').trashed, false);
  assert.equal(drive.files.get('old2').trashed, true);
  assert.equal(drive.files.get('old3').trashed, true);
  assert.equal(gradingFiles(), 1);
});
