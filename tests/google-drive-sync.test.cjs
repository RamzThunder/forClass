const {test, beforeEach} = require('node:test');
const assert = require('node:assert/strict');

// 브라우저 대신 쓸 localStorage와 가짜 드라이브
const store = new Map();
globalThis.localStorage = {
  getItem:k => store.has(k) ? store.get(k) : null,
  setItem:(k, v) => store.set(k, String(v)),
  removeItem:k => store.delete(k)
};
let drive;
function resetDrive(){
  drive = {files:new Map(), next:1, calls:[]};
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
  const meta = f => ({id:f.id, name:f.name, modifiedTime:f.modifiedTime, version:String(f.version), trashed:f.trashed || false});
  if(u.pathname === '/drive/v3/files' && method === 'GET'){
    const q = u.searchParams.get('q');
    const app = /value='([^']+)'/.exec(q)[1];
    const isFolder = q.includes('forClassRoot');
    const files = [...drive.files.values()].filter(f => !f.trashed && (isFolder ? f.folder : f.app === app))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    return json({files:files.map(meta)});
  }
  if(u.pathname === '/drive/v3/files' && method === 'POST'){
    const body = JSON.parse(options.body);
    const f = {id:`f${drive.next++}`, name:body.name, folder:true, version:1, modifiedTime:new Date().toISOString()};
    drive.files.set(f.id, f);
    return json({id:f.id});
  }
  if(u.pathname === '/upload/drive/v3/files' && method === 'POST'){
    const parts = options.body.split(/--forClass\w+/);
    const metaPart = JSON.parse(parts[1].split('\r\n\r\n')[1]);
    const content = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    const f = {id:`f${drive.next++}`, name:metaPart.name, app:metaPart.appProperties.forClassApp, content, version:1, modifiedTime:new Date().toISOString()};
    drive.files.set(f.id, f);
    return json(meta(f));
  }
  const m = /^\/(upload\/)?drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
  if(m){
    const f = drive.files.get(m[2]);
    if(!f) return json({error:{message:'not found'}}, 404);
    if(method === 'PATCH'){ f.content = options.body; touch(f); return json(meta(f)); }
    if(u.searchParams.get('alt') === 'media') return json(f.content);
    return json(meta(f));
  }
  throw new Error(`unexpected ${method} ${url}`);
};

const G = require('../google-drive-sync.js');
const {fingerprint, syncAction} = G._test;

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
  const base = {syncedHash:'a', knownVersion:'3', remoteExists:true};
  assert.equal(syncAction({...base, localHash:'a', remoteVersion:'3'}), 'none');
  assert.equal(syncAction({...base, localHash:'b', remoteVersion:'3'}), 'upload');
  assert.equal(syncAction({...base, localHash:'a', remoteVersion:'4'}), 'download');
  assert.equal(syncAction({...base, localHash:'b', remoteVersion:'4'}), 'conflict');
  assert.equal(syncAction({...base, localHash:'a', remoteExists:false}), 'missing');
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
  assert.equal(drive.files.size, 2, '고르기 전에는 새 파일을 만들지 않는다(폴더 1 + 파일 1)');
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

test('다른 계정으로 로그인하면 이전 계정의 파일 연결을 쓰지 않는다', async () => {
  signIn('a@example.com');
  const g = grader('omr', {records:{a:1}});
  await g.doc.open();
  const oldId = g.doc.link.fileId;
  signIn('b@example.com');
  G._test.resetFolder();
  await g.doc.sync();
  assert.notEqual(g.doc.link.fileId, oldId);
});
