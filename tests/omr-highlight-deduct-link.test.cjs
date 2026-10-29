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
function setup(hits){
  const toggled = [];
  const question = {
    label:'1번',
    rubric:[{id:'d1', type:'deduct', name:'맞춤법', reject:'띄어쓰기\n오탈자'}],
    highlightLinks:{blue:{itemId:'d1', keyword:'오탈자'}, purple:{itemId:'gone', keyword:'x'}}
  };
  const ctx = {
    HIGHLIGHT_COLORS:['red','yellow','green','blue','purple'],
    splitKeywords:text => String(text || '').split('\n').filter(Boolean),
    activeQuestion:() => question,
    activeRubric:() => question.rubric,
    currentQuestionRecord:() => ({keywordHits:hits}),
    toggleKeywordHit:(itemId, type, keyword) => toggled.push([itemId, type, keyword]),
    toggled, question
  };
  vm.createContext(ctx);
  ['normalizeHighlightLink','normalizeHighlightLinks','highlightLinkInfo','isDeductKeywordOn','setDeductKeywordFromHighlight','releaseHighlightDeduct']
    .forEach(name => vm.runInContext(source(name), ctx));
  return ctx;
}

test('five highlight colors are offered in the toolbar', () => {
  ['Red','Yellow','Green','Blue','Purple'].forEach(color => assert.match(html, new RegExp(`id="highlight${color}Btn"`)));
});

test('link only counts when the deduct keyword still exists', () => {
  const ctx = setup({});
  assert.equal(ctx.highlightLinkInfo('blue').keyword, '오탈자');
  assert.equal(ctx.highlightLinkInfo('purple'), null);
  assert.equal(ctx.highlightLinkInfo('red'), null);
  assert.deepEqual(Object.keys(ctx.normalizeHighlightLinks({blue:{itemId:'a', keyword:'b'}, pink:{itemId:'a', keyword:'b'}})), ['blue']);
});

test('drawing a linked highlight turns the deduction on once', () => {
  const off = setup({});
  off.setDeductKeywordFromHighlight({itemId:'d1', keyword:'오탈자'}, true);
  assert.deepEqual(off.toggled, [['d1', 'reject', '오탈자']]);
  const on = setup({d1:{reject:['오탈자']}});
  on.setDeductKeywordFromHighlight({itemId:'d1', keyword:'오탈자'}, true);
  assert.deepEqual(on.toggled, []);
});

test('removing the last linked highlight releases the deduction', () => {
  const link = {itemId:'d1', keyword:'오탈자'};
  const ctx = setup({d1:{reject:['오탈자']}});
  ctx.releaseHighlightDeduct({deductLink:link}, [{deductLink:link}]);
  assert.deepEqual(ctx.toggled, []);
  ctx.releaseHighlightDeduct({deductLink:link}, []);
  assert.deepEqual(ctx.toggled, [['d1', 'reject', '오탈자']]);
});
