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

test('삭제와 빈 항목 제외 후 자동 체크 조건 번호를 보정한다', () => {
  const criterion={opts:[{desc:'삭제'},{desc:'조건 A'},{desc:'자동',requires:[1]}]};
  context.removeRubricOption(criterion,0);
  assert.deepEqual(Array.from(criterion.opts[1].requires),[0]);
  const normalized=context.normalizedOptions({opts:[{desc:'A'},{desc:''},{desc:'B',requires:[0]}]},[0,2]);
  assert.deepEqual(Array.from(normalized[1].requires),[0]);
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

test('자동 항목은 모든 조건 충족 시 자신의 배점을 더하고 조건 해제 시 연쇄 해제된다', () => {
  context.selectionMode='topic';
  context.state.rubric=[{base:0,opts:[{pt:1},{pt:2},{pt:7,requires:[0,1]},{pt:3,requires:[2]}]}];
  const student={checks:{0:[0,2,3]}};
  assert.equal(context.critScore(student,0),1);
  student.checks[0].push(1);
  assert.deepEqual(Array.from(context.checksOf(student,0)),[0,1,2,3]);
  assert.equal(context.critScore(student,0),13);
  student.checks[0]=[1,2,3];
  assert.equal(context.critScore(student,0),2);
});

test('비어 있거나 순환하는 조건은 저장을 막고 자동 체크하지 않는다', () => {
  for(const opts of [[{requires:[]}],[{requires:[0]}],[{requires:[1]},{requires:[0]}]]){
    assert.equal(context.invalidAutoChecks({opts}),true);
    context.state.rubric=[{base:0,opts}];
    assert.deepEqual(Array.from(context.checksOf({checks:{0:[0,1]}},0)),[]);
  }
  assert.equal(context.invalidAutoChecks({opts:[{}, {requires:[0]}, {requires:[1]}]}),false);
});

test('세부 배지는 모두 체크해야 부모 배점과 연계 항목이 반영된다',()=>{
  context.selectionMode='topic';
  context.state.rubric=[{base:0,opts:[{pt:5,details:[{id:'a',label:'A'},{id:'b',label:'B'}]},{pt:2,requires:[0]}]}];
  const student={checks:{0:[0]},detailChecks:{a:true}};
  assert.equal(context.critScore(student,0),0);
  student.detailChecks.b=true;
  assert.equal(context.critScore(student,0),7);
  const restored=JSON.parse(JSON.stringify(student));
  assert.equal(context.critScore(restored,0),7);
  delete student.detailChecks.a;
  assert.equal(context.critScore(student,0),0);
  assert.equal(context.critScore({checks:{}},0),0);
  restored.absent=true;
  assert.equal(context.critScore(restored,0),0);
});

test('세부항목과 연계 조건을 함께 설정하면 둘 다 충족해야 한다',()=>{
  context.state.rubric=[{base:0,opts:[{pt:1},{pt:5,details:[{id:'x',label:'X'}],requires:[0]}]}];
  const student={checks:{0:[]},detailChecks:{x:true}};
  assert.equal(context.critScore(student,0),0);
  student.checks[0]=[0];assert.equal(context.critScore(student,0),6);
  student.detailChecks={};assert.equal(context.critScore(student,0),1);
});

test('세부항목 이름은 비워서 저장할 수 없고 삭제 후에도 남은 ID가 유지된다',()=>{
  assert.equal(context.invalidAutoChecks({opts:[{details:[{id:'x',label:' '}]}]}),true);
  const c={opts:[{desc:'빈칸'},{desc:'부모',details:[{id:'stable',label:'세부'}]}]};
  const cleaned=context.normalizedOptions(c,[1]);
  assert.equal(cleaned[0].details[0].id,'stable');
});
