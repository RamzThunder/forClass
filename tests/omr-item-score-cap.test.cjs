const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../omr-grader.html'), 'utf8');
const source = name => {
  const start = html.indexOf(`function ${name}(`);
  return html.slice(start, html.indexOf('\n}\n', start) + 3);
};
const ctx = vm.createContext({nonNegativeNumber:value => Math.max(0, Number(value) || 0), rubricPoint:item => Number(item.pt) || 0, rejectDeduct:() => 0});
['scoreFromKeywordHits','keywordScore','itemScoreCap','scoreValue','subMaxScore','questionMaxScore','subDisplayMaxScore'].forEach(name => vm.runInContext(source(name), ctx));

const item = {id:'r', type:'score', pt:2, maxPt:2, accept:'A\nB', acceptScores:{A:2, B:2}, rejectScores:{감점:1}};

test('인정 문구를 여러 개 골라도 항목점수를 넘지 않는다', () => {
  assert.equal(ctx.scoreFromKeywordHits(item, {accept:['A','B']}), 2);
  assert.equal(ctx.scoreFromKeywordHits(item, {accept:['A','B'], reject:['감점']}), 1);
  assert.equal(ctx.scoreFromKeywordHits({...item, maxPt:0}, {accept:['A','B']}), 4);
});

test('예전에 저장된 넘는 점수도 항목점수까지만 읽는다', () => {
  assert.equal(ctx.scoreValue({r:4}, item), 2);
  assert.equal(ctx.scoreValue({r:4}, {...item, maxPt:0}), 4);
});

test('소문항이 없으면 공통 머리에 문항 점수를 만점으로 보인다', () => {
  assert.equal(ctx.subDisplayMaxScore({maxScore:6, subs:[], subScores:{}}, '공통'), 6);
  assert.equal(ctx.subDisplayMaxScore({maxScore:6, subs:['(1)'], subScores:{'(1)':4}}, '(1)'), 4);
  assert.equal(ctx.subDisplayMaxScore({maxScore:6, subs:['(1)'], subScores:{}}, '공통'), 0);
});
