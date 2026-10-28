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
const c = vm.createContext({});
vm.runInContext('const INK_BLANK_RATIO = 0.004; const INK_SHORT_SHARE = .3;', c);
for(const name of ['inkGridFromPixels','dilateInkCells','printedInkMask','inkRatiosForGrids','inkShortLimit','inkCandidateReason']) vm.runInContext(source(name), c);

const W = 240, H = 90, GW = 80, GH = 30;
// 흰 종이에 인쇄된 밑줄 두 개가 있는 답안 칸
function sheet({shift=0, paper=250}={}){
  const px = new Uint8ClampedArray(W * H * 4).fill(paper);
  for(let i = 3; i < px.length; i += 4) px[i] = 255;
  const paint = (x, y, rgb) => { if(x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; };
  for(const lineY of [40, 75]) for(let x = 5; x < W - 5; x++){ paint(x, lineY + shift, [60,60,60]); paint(x, lineY + 1 + shift, [60,60,60]); }
  return {px, paint};
}
function write(paint, words, rgb=[20,20,20], offset=0){
  for(let w = 0; w < words; w++){
    const x0 = 10 + offset + w * 22;
    for(let t = 0; t < 14; t++){ paint(x0 + t, 20 + Math.round(t / 2), rgb); paint(x0 + t, 21 + Math.round(t / 2), rgb); paint(x0 + 7, 14 + t, rgb); }
  }
}
const grid = s => c.inkGridFromPixels(s.px, W, H, GW, GH);

test('잉크 격자: 빈 종이는 잉크가 없고, 진한 펜 자국은 잡힌다', () => {
  const blank = sheet();
  assert.equal([...grid({px:new Uint8ClampedArray(W * H * 4).fill(250)}).cells].filter(Boolean).length, 0);
  write(blank.paint, 2);
  assert.ok([...grid(blank).cells].filter(Boolean).length > 10);
});

test('잉크 격자: 파란 펜도 잉크로 본다', () => {
  const s = sheet();
  write(s.paint, 2, [70, 90, 210]);
  const lines = [...grid(sheet()).cells].filter(Boolean).length;
  assert.ok([...grid(s).cells].filter(Boolean).length > lines + 10);
});

test('인쇄된 줄은 빼고 판정: 빈 답안은 미작성 추정, 쓴 답안은 후보가 아니다', () => {
  const pages = [];
  for(let i = 0; i < 10; i++){
    const s = sheet({shift:i % 2});          // 스캔이 1px씩 밀려도 인쇄물로 본다
    if(i >= 3) write(s.paint, 3 + (i % 4), [20,20,20], (i * 7) % 20);
    pages.push(grid(s));
  }
  const ratios = c.inkRatiosForGrids(pages);
  for(let i = 0; i < 3; i++) assert.equal(c.inkCandidateReason(ratios[i], false), '미작성 추정', `빈 답안 ${i}: ${ratios[i]}`);
  for(let i = 3; i < 10; i++) assert.equal(c.inkCandidateReason(ratios[i], false), '', `쓴 답안 ${i}: ${ratios[i]}`);
});

test('학생 대부분이 같은 자리에 글씨를 써도 글씨를 인쇄물로 지우지 않는다', () => {
  const pages = [];
  for(let i = 0; i < 10; i++){
    const s = sheet();
    if(i > 0) write(s.paint, 10);          // 9명이 똑같은 자리에 꽉 채워 씀
    pages.push(grid(s));
  }
  const ratios = c.inkRatiosForGrids(pages);
  assert.equal(c.inkCandidateReason(ratios[0], false), '미작성 추정');
  for(let i = 1; i < 10; i++) assert.equal(c.inkCandidateReason(ratios[i], true), '', `쓴 답안 ${i}: ${ratios[i]}`);
});

test('글씨 적음 옵션: 두 글자만 쓴 답안을 후보로 올린다', () => {
  const pages = [];
  for(let i = 0; i < 8; i++){
    const s = sheet();
    write(s.paint, i === 0 ? 2 : 9, [20,20,20], (i * 5) % 18);
    pages.push(grid(s));
  }
  const ratios = c.inkRatiosForGrids(pages);
  const limit = c.inkShortLimit(ratios);
  assert.equal(c.inkCandidateReason(ratios[0], false, limit), '');
  assert.equal(c.inkCandidateReason(ratios[0], true, limit), '글씨 적음');
  for(let i = 1; i < 8; i++) assert.equal(c.inkCandidateReason(ratios[i], true, limit), '');
});

test('학생이 적으면 인쇄물을 빼지 않는다(학생 답을 인쇄물로 잘못 지우지 않게)', () => {
  const s = sheet();
  write(s.paint, 3);
  const ratios = c.inkRatiosForGrids([grid(s), grid(s)]);
  assert.ok(ratios[0] > 0.01);
});

