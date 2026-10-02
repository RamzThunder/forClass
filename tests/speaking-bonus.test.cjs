const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../logical-speaking-grader.html'), 'utf8');
const rubricSource = html.slice(html.indexOf('function choiceRubric('), html.indexOf('\nlet timer='));
const scoreSource = html.slice(html.indexOf('function checksOf('), html.indexOf('\nfunction gradeOf('));
const editorSource = html.slice(html.indexOf('function removeRubricOption('), html.indexOf('\nfunction wireBonusEditor('));
const context = vm.createContext({selectionMode:'topic',choiceSets:[],state:{rubric:[]}});
vm.runInContext([rubricSource, scoreSource, editorSource].join('\n'), context);

test('모두 체크 보너스는 지정된 항목이 전부 체크된 경우에만 5점을 더한다', () => {
  context.state.rubric = [{name:'근거',base:5,opts:[{desc:'첫째',pt:2},{desc:'둘째',pt:3}],allBonus:{requires:[0,1]}}];
  const student = {checks:{0:[0]},absent:false};
  assert.equal(context.critScore(student,0),7);
  assert.equal(context.rubricMax(student),15);
  student.checks[0].push(1);
  assert.equal(context.critScore(student,0),15);
  student.absent=true;
  assert.equal(context.critScore(student,0),5);
});

test('항목을 삭제하거나 빈 항목을 제외해도 보너스 조건 번호가 유지된다', () => {
  const criterion={opts:[{desc:'삭제'},{desc:'조건 A'},{desc:'조건 B'}],allBonus:{requires:[1,2]}};
  context.removeRubricOption(criterion,0);
  assert.deepEqual(Array.from(criterion.allBonus.requires),[0,1]);
  const normalized=context.normalizedBonus({opts:[{desc:'A'},{desc:''},{desc:'B'}],allBonus:{requires:[0,2]}},[0,2]);
  assert.deepEqual(Array.from(normalized.requires),[0,1]);
});

test('선택문제 루브릭에도 같은 보너스 규칙을 적용한다', () => {
  context.selectionMode='draw';
  context.state.rubric=[{name:'기본',base:1,opts:[]}];
  context.choiceSets=Array.from({length:5},()=>[
    {name:'선택문제 1',base:0,opts:[{desc:'가',pt:1},{desc:'나',pt:1}],allBonus:{requires:[0,1]}},
    {name:'선택문제 2',base:0,opts:[]},
    {name:'선택문제 3',base:0,opts:[]}
  ]);
  const student={choiceSet:0,checks:{1:[0,1]},absent:false};
  assert.equal(context.critScore(student,1),7);
  assert.equal(context.studentTotal(student),8);
});
