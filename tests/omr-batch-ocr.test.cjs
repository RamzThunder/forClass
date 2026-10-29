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
  const ctx = {
    STORAGE_KEY:'omr',
    state:{fileName:'중간.pdf', page:1, activeQuestion:'q1'},
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value)},
    recordKey:page => String(Math.ceil(page / 2)),
    storage
  };
  vm.createContext(ctx);
  vm.runInContext('const OCR_TEXT_KEY = `${STORAGE_KEY}.ocrTexts`; let ocrTextStore = null;', ctx);
  ['ocrTextStoreFor','ocrTextId','savedOcrText','saveOcrText'].forEach(name => vm.runInContext(source(name), ctx));
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
  assert.equal(JSON.parse(ctx.storage.get('omr.ocrTexts')).texts['1|q1'], undefined);
});
