const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../omr-grader.html'), 'utf8');
function source(name){
  const start = html.indexOf(`function ${name}(`);
  const end = html.slice(start + 1).search(/\n(?:async )?function /);
  return html.slice(start, start + 1 + end);
}
function setup(){
  const storage = new Map();
  let ctx;
  ctx = {
    STORAGE_KEY:'omr',
    state:{fileName:'중간.pdf', page:1, activeQuestion:'q1'},
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value)},
    recordKey:page => String(Math.ceil(page / 2)),
    driveDoc:{changed:() => { ctx.changed++; }},
    changed:0,
    storage
  };
  vm.createContext(ctx);
  vm.runInContext('const OCR_TEXT_KEY = `${STORAGE_KEY}.ocrTexts`; let ocrTextStore = null;', ctx);
  ['ocrTextStoreFor','ocrTextId','normalizeOcrEntry','writeOcrTextStore','savedOcrText','saveOcrText','mergeOcrTexts'].forEach(name => vm.runInContext(source(name), ctx));
  return ctx;
}

test('OCR text is kept per student and question', () => {
  const ctx = setup();
  ctx.saveOcrText(3, 'q1', '  답안 글자 ');
  assert.equal(ctx.savedOcrText(4, 'q1'), '답안 글자');
  assert.equal(ctx.savedOcrText(3, 'q2'), '');
  assert.equal(ctx.savedOcrText(1, 'q1'), '');
});

test('OCR text from another exam PDF is not shown', () => {
  const ctx = setup();
  ctx.saveOcrText(1, 'q1', '이전 시험');
  ctx.state.fileName = '기말.pdf';
  assert.equal(ctx.savedOcrText(1, 'q1'), '');
});

test('clearing the text removes it', () => {
  const ctx = setup();
  ctx.saveOcrText(1, 'q1', '글자');
  ctx.saveOcrText(1, 'q1', '');
  assert.equal(ctx.savedOcrText(1, 'q1'), '');
  assert.equal(JSON.parse(ctx.storage.get('omr.ocrTexts')).texts['1|q1'].text, '');
});

test('saving OCR text asks the Drive file to save', () => {
  const ctx = setup();
  ctx.saveOcrText(1, 'q1', '글자');
  ctx.saveOcrText(1, 'q1', '글자');
  assert.equal(ctx.changed, 1);
});

test('merging keeps the newer text for each answer', () => {
  const ctx = setup();
  ctx.saveOcrText(1, 'q1', '이 기기');
  const mine = JSON.parse(ctx.storage.get('omr.ocrTexts')).texts['1|q1'].at;
  ctx.mergeOcrTexts({pdfName:'중간.pdf', texts:{'1|q1':{text:'옛 글자', at:mine - 1000}, '2|q1':{text:'다른 기기', at:5}, '3|q1':'예전 형식'}});
  assert.equal(ctx.savedOcrText(1, 'q1'), '이 기기');
  assert.equal(ctx.savedOcrText(3, 'q1'), '다른 기기');
  assert.equal(ctx.savedOcrText(5, 'q1'), '예전 형식');
  ctx.mergeOcrTexts({pdfName:'중간.pdf', texts:{'1|q1':{text:'', at:mine + 1000}}});
  assert.equal(ctx.savedOcrText(1, 'q1'), '');
});

test('merging text from another exam PDF is ignored unless replacing', () => {
  const ctx = setup();
  ctx.mergeOcrTexts({pdfName:'기말.pdf', texts:{'1|q1':{text:'기말', at:1}}});
  assert.equal(ctx.savedOcrText(1, 'q1'), '');
  ctx.state.fileName = '기말.pdf';
  ctx.mergeOcrTexts({pdfName:'기말.pdf', texts:{'1|q1':{text:'기말', at:1}}}, {replace:true});
  assert.equal(ctx.savedOcrText(1, 'q1'), '기말');
});

test('clearing many review changes leaves tombstones so merges do not bring them back', () => {
  const KeywordReview = require('../keyword-review.js');
  const data = KeywordReview.empty();
  data.changes.push({id:'a'}, {id:'b'}, {id:'c'});
  assert.equal(KeywordReview.deleteChanges(data, ['a', 'b', 'x']), 2);
  assert.deepEqual(data.changes.map(c => c.id), ['c']);
  const merged = KeywordReview.merge(data, {version:1, sessions:{}, changes:[{id:'a'}, {id:'b'}, {id:'d'}]});
  assert.deepEqual(merged.changes.map(c => c.id).sort(), ['c', 'd']);
});
