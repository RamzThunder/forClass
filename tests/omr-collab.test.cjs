const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../omr-grader.html'), 'utf8');
function source(name){
  const start = html.indexOf(`function ${name}(`);
  const end = html.slice(start + 1).search(/\n(?:async )?function /);
  return html.slice(start, start + 1 + end);
}
const names = ['collabEmail','normalizeCollab','collabState','collabMyEmail','questionAssignee','isPeerQuestion','mergeCollabInfo','applyCollabPeerData','recordIdentity','recordIdentityMap','mergeQrecHasData'];
function setup({me='a@school.kr', collab, records={}, questions=[{id:'q1', label:'1번'}, {id:'q3', label:'3번'}]}={}){
  const ctx = {
    structuredClone,
    state:{activeQuestion:'q1', settings:{collab}, records, questions},
    window:{GoogleDriveSync:{account:() => ({email:me})}},
    normalizedBackupQuestions:data => data.questions || [],
    normalizedBackupRecords:data => structuredClone(data.records || {})
  };
  vm.createContext(ctx);
  vm.runInContext('var GoogleDriveSync = window.GoogleDriveSync;', ctx);
  names.forEach(name => vm.runInContext(source(name), ctx));
  if(collab) ctx.state.settings.collab = ctx.normalizeCollab(collab);
  return ctx;
}
const baseCollab = {groupId:'g1', members:[{email:'a@school.kr'}, {email:'b@school.kr'}], assignments:{q1:'A@school.kr', q3:'b@school.kr'}, assignmentsAt:'2026-10-29T01:00:00Z', peers:{}};

test('only questions assigned to someone else are locked', () => {
  const ctx = setup({collab:baseCollab});
  assert.equal(ctx.isPeerQuestion('q1'), false);
  assert.equal(ctx.isPeerQuestion('q3'), true);
  assert.equal(ctx.isPeerQuestion('q9'), false);
});

test('without collaboration nothing is locked', () => {
  const ctx = setup();
  assert.equal(ctx.isPeerQuestion('q3'), false);
});

test('newer assignments from a colleague win, members are merged', () => {
  const ctx = setup({collab:baseCollab});
  const peer = ctx.normalizeCollab({groupId:'g1', members:[{email:'c@school.kr', name:'C'}], assignments:{q1:'c@school.kr'}, assignmentsAt:'2026-10-29T02:00:00Z'});
  const next = ctx.mergeCollabInfo(ctx.state.settings.collab, peer, {email:'b@school.kr', name:'B 선생님'});
  assert.equal(next.assignments.q1, 'c@school.kr');
  assert.equal(next.members.map(member => member.email).join(','), 'a@school.kr,b@school.kr,c@school.kr');
  assert.equal(next.members[1].name, 'B 선생님');
  const older = ctx.mergeCollabInfo(ctx.state.settings.collab, {...peer, assignmentsAt:'2026-10-28T00:00:00Z'}, null);
  assert.equal(older.assignments.q1, 'a@school.kr');
});

test('pulling copies only the colleague questions and matches students by name', () => {
  const records = {
    '1':{className:'1', number:'1', name:'김가', answers:{q1:{memo:'내 채점', scores:{}}, q3:{memo:'옛 사본', scores:{}}}},
    '2':{className:'1', number:'2', name:'이나', answers:{q3:{memo:'지워질 사본', scores:{}}}}
  };
  const ctx = setup({collab:baseCollab, records});
  const data = {
    questions:[{id:'q1', label:'동료의 1번'}, {id:'q3', label:'동료의 3번', rubric:[{id:'r1'}]}],
    records:{
      '7':{className:'1', number:'1', name:'김가', answers:{q1:{memo:'동료가 쓴 1번', scores:{}}, q3:{memo:'B 채점', scores:{}}}},
      '8':{className:'1', number:'3', name:'박다', answers:{q3:{memo:'새 학생', scores:{}}}}
    }
  };
  const count = ctx.applyCollabPeerData('b@school.kr', data);
  assert.equal(count, 2);
  assert.equal(ctx.state.records['1'].answers.q1.memo, '내 채점');
  assert.equal(ctx.state.records['1'].answers.q3.memo, 'B 채점');
  assert.equal(ctx.state.records['2'].answers.q3, undefined);
  const added = Object.values(ctx.state.records).find(rec => rec.name === '박다');
  assert.equal(added.answers.q3.memo, '새 학생');
  assert.equal(ctx.state.questions.find(q => q.id === 'q1').label, '1번');
  assert.equal(ctx.state.questions.find(q => q.id === 'q3').label, '동료의 3번');
});

test('email list parsing keeps valid unique addresses', () => {
  const sync = require('../google-drive-sync.js');
  assert.deepEqual(sync.parseEmails('B@school.kr, c@school.kr\nb@school.kr 잘못된값'), ['b@school.kr', 'c@school.kr']);
});

test('invite reads the typed emails before the panel is redrawn', () => {
  const body = source('inviteCollabMembers');
  assert.ok(body.indexOf('collabInviteInput') < body.indexOf('runCollabTask'));
  assert.match(html, /id="collabInviteInput"[^>]*value="\$\{escapeHtml\(collabInviteDraft\)\}"/);
});

function loadAsync(ctx, name){
  vm.runInContext('async ' + source(name), ctx);
}

test('invitation shares PDF with existing members and retries failed PDF shares', async () => {
  const ctx = setup({collab:{...baseCollab, sharedWith:['b@school.kr']}});
  const calls = [];
  let fail = true;
  Object.assign(ctx, {
    drivePdfLink:() => ({id:'pdf1', ownerEmail:'a@school.kr'}),
    ensureMyDriveFile:async () => 'json1',
    saveCollab:next => {ctx.state.settings.collab = ctx.normalizeCollab(next);}
  });
  ctx.GoogleDriveSync.files = {share:async (id, email) => {
    calls.push([id, email]);
    if(fail) throw new Error('denied');
  }};
  loadAsync(ctx, 'shareMyCollabFile');
  assert.equal((await ctx.shareMyCollabFile()).length, 1);
  assert.equal(ctx.state.settings.collab.pdfSharedWith['b@school.kr'], undefined);
  fail = false;
  await ctx.shareMyCollabFile();
  await ctx.shareMyCollabFile();
  assert.deepEqual(calls, [['pdf1','b@school.kr'], ['pdf1','b@school.kr']]);
});

test('recipient does not attempt to reshare the owner PDF', async () => {
  const ctx = setup({collab:baseCollab});
  const calls = [];
  Object.assign(ctx, {
    drivePdfLink:() => ({id:'pdf1', ownerEmail:'b@school.kr'}),
    ensureMyDriveFile:async () => 'json1',
    saveCollab:next => {ctx.state.settings.collab = ctx.normalizeCollab(next);}
  });
  ctx.GoogleDriveSync.files = {share:async id => calls.push(id)};
  loadAsync(ctx, 'shareMyCollabFile');
  await ctx.shareMyCollabFile();
  assert.deepEqual(calls, ['json1']);
});

test('PDF permission failure uses PDF Picker and retries the same file', async () => {
  const ctx = setup();
  let attempts = 0;
  ctx.alert = () => {};
  ctx.GoogleDriveSync.files = {downloadBlob:async id => {
    assert.equal(id, 'pdf1');
    if(++attempts === 1) throw {status:404};
    return 'pdf bytes';
  }};
  ctx.GoogleDriveSync.pickerAvailable = () => true;
  ctx.GoogleDriveSync.pickFiles = async options => {
    assert.equal(options.mimeTypes, 'application/pdf');
    return [{id:'pdf1'}];
  };
  loadAsync(ctx, 'downloadDrivePdf');
  assert.equal(await ctx.downloadDrivePdf({id:'pdf1', name:'답안.pdf'}, {}), 'pdf bytes');
  assert.equal(attempts, 2);
});

test('missing PDF link is recovered from peer without replacing an existing PDF', () => {
  const ctx = setup();
  Object.assign(ctx, {drivePdfLink:() => ctx.state.settings.pdfDriveFile, persist:() => {}, offerDrivePdf:() => {}});
  vm.runInContext(source('adoptCollabPdf'), ctx);
  ctx.adoptCollabPdf({settings:{pdfDriveFile:{id:'pdf1'}}}, 'b@school.kr');
  assert.equal(ctx.state.settings.pdfDriveFile.ownerEmail, 'b@school.kr');
  ctx.adoptCollabPdf({settings:{pdfDriveFile:{id:'pdf2'}}}, 'c@school.kr');
  assert.equal(ctx.state.settings.pdfDriveFile.id, 'pdf1');
});
