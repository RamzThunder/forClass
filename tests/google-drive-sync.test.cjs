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
    id:f.id, name:f.name, modifiedTime:f.modifiedTime, version:String(f.version), trashed:f.trashed || false,
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
    const app = /value='([^']+)'/.exec(q)[1];
    const fileKey = /key='forClassKey' and value='([^']+)'/.exec(q)?.[1];
    const isFolder = q.includes('forClassRoot');
    const files = [...drive.files.values()].filter(f => !f.trashed && (isFolder ? f.folder : f.app === app) && (!fileKey || f.key === fileKey))
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
  const old = JSON.parse(localStorage.getItem(key));
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
