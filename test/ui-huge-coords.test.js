import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom.js';

// 先装 DOM 桩并种入含超大十进制坐标（10^400 基值）草稿，再导入前端模块：
// 覆盖逐段位移表（Infinity / 超限误标）、帧间虚点与谱系图相对位置三类展示
const dom = installDom();

const B = (10n ** 400n).toString();
const B1 = (10n ** 400n + 1n).toString();
const B2 = (10n ** 400n + 2n).toString();
const B3 = (10n ** 400n + 3n).toString();
const E199 = (10n ** 199n).toString();
const E199x2 = (2n * 10n ** 199n).toString();
const E199x3 = (3n * 10n ** 199n).toString();

const S = (id, x, y, b = 10) => ({ id, x, y, brightness: b });

// 每帧 2 个斑点；各字段输入框按帧内顺序排列，过滤后 x/y 各自索引为 0..7：
//   x: a=0 q0=1 z1=2 z2=3 c=4 q2=5 d=6 q3=7（y 同序）
dom.localStorage.setItem('algae-lineage-draft-v1', JSON.stringify({
  frames: [
    [S('a', B, '0'), S('q0', '0', '9', 1)],
    [S('z1', '0', '0', 1), S('z2', '0', '5', 1)], // a 附近无斑点，必须漏检一帧
    [S('c', B2, '0'), S('q2', '0', '0', 1)],
    [S('d', B3, '0'), S('q3', '0', '0', 1)],
  ],
  params: { startId: 'a', maxMove: 1, maxSkip: 1, survivors: 1 },
}));

await import('../public/app.js');

const byId = dom.byId;

function segRows() {
  return dom.el('#segments-table tbody').children;
}
function svgEls() {
  return byId('lineage-svg')._walk();
}
/** 所有 SVG 属性值中不得出现 Infinity / NaN（图形折叠的典型症状） */
function assertSvgFinite() {
  for (const e of svgEls()) {
    for (const v of Object.values(e.attrs)) {
      assert.ok(!/Infinity|NaN/.test(v), `SVG 属性出现非有限值：${v}`);
    }
  }
}
/** 采用斑点与起点圆（未采用灰点 r=4 / fill #fff、虚点 r=4.5 均排除） */
function adoptedCircles() {
  return svgEls().filter((e) => e.tagName === 'circle' &&
    e.attrs.r !== '4' && e.attrs.r !== '4.5' && e.attrs.fill !== '#fff');
}
function inputs(field) {
  return byId('frames-editor')._walk()
    .filter((e) => e.tagName === 'input' && e.dataset.field === field);
}
function setField(field, idx, value) {
  const editor = byId('frames-editor');
  const inp = inputs(field)[idx];
  inp.value = value;
  editor.dispatch('input', { target: inp });
}
function setParam(id, value) {
  const el = byId(id);
  el.value = value;
  el.dispatch('input');
}

test('超大基值漏检路径：两段距离均为 1、全部 ✓，虚点精确显示 10^400+1', () => {
  byId('btn-solve').dispatch('click');
  assert.equal(byId('broke-view').hidden, true);
  assert.equal(byId('result-view').hidden, false);

  const html = segRows().map((r) => r.innerHTML).join('\n');
  assert.doesNotMatch(html, /Infinity|NaN/);
  assert.doesNotMatch(html, /✗/); // 合法连线一律不得标记超限
  // 漏检两行 + 直连一行，三段位移均为 1 且在限内
  assert.equal(segRows().length, 3);
  assert.equal((html.match(/1 ✓/g) || []).length, 3);
  assert.match(html, /漏检段 1\/2/);
  assert.match(html, /漏检段 2\/2/);
  // 帧间虚点必须精确写出 10^400+1（两行都出现：s1.to 与 s2.from）
  assert.equal((html.match(new RegExp(B1, 'g')) || []).length, 2);
});

test('谱系图：超大坐标下不折叠、不出现 Infinity/NaN', () => {
  assertSvgFinite();
  // 采用斑点 a、c、d（含起点）圆的纵向像素均为有限数
  const cys = adoptedCircles().map((c) => parseFloat(c.attrs.cy));
  assert.equal(cys.length, 3);
  for (const y of cys) assert.ok(Number.isFinite(y));
});

test('谱系图保留共同超大基值上的相对差异：y=10^400 / +2 / +3 三点不重合', () => {
  // 干扰斑点靠 x=0 远离路径（x=10^400 一带）；路径三点 x 同为 10^400，
  // y 依次为 10^400、10^400+2、10^400+3：纵轴范围仅 3，基值再大也必须把
  // 单位差异展开成不同像素。漏检 a→c 总纵向位移 2（每段 1），虚点 y=10^400+1
  setField('x', 4, B); // c 与 a 同 x
  setField('x', 6, B); // d 与 a 同 x
  for (const i of [0, 1, 2, 3, 5, 7]) setField('y', i, B);
  setField('y', 4, B2); // c
  setField('y', 6, B3); // d
  byId('btn-solve').dispatch('click');

  assert.equal(byId('broke-view').hidden, true);
  assertSvgFinite();
  const cyOfAdopted = adoptedCircles().map((c) => Number(c.attrs.cy)).sort((p, q) => p - q);
  assert.equal(new Set(cyOfAdopted).size, 3,
    `三个纵向位置应各不相同，实际：${cyOfAdopted.join(', ')}`);
  // 虚点圆（r=4.5）纵向像素有限，且恰好夹在 a 与 c 之间（对应 10^400+1）
  const virtual = svgEls().find((e) => e.tagName === 'circle' && e.attrs.r === '4.5');
  assert.ok(virtual, '应有漏检虚点圆');
  const vy = Number(virtual.attrs.cy);
  assert.ok(Number.isFinite(vy));
  assert.ok(vy > cyOfAdopted[1] - 0.001 && vy < cyOfAdopted[2] + 0.001,
    `虚点纵向像素 ${vy} 应落在 a 与 c 之间`);
  // 表格虚点坐标的 y 精确为 10^400+1（s1.to 与 s2.from 各出现一次）
  const html = segRows().map((r) => r.innerHTML).join('\n');
  assert.equal((html.match(new RegExp(B1, 'g')) || []).length, 2);
  assert.doesNotMatch(html, /Infinity|NaN|✗/);
});

test('横移 10^199 草稿：三段距离均以科学计数形式 1e+199 显示且全部未超限', () => {
  // 路径斑点 x：a=0、z1=10^199、c=2·10^199、d=3·10^199（帧 1 沿 z1 继续）；
  // 干扰斑点 x=9；y 路径为 0、干扰为 9
  setField('x', 0, '0');
  setField('x', 2, E199);
  setField('x', 4, E199x2);
  setField('x', 6, E199x3);
  for (const i of [1, 3, 5, 7]) setField('x', i, '9');
  for (const i of [0, 2, 4, 6]) setField('y', i, '0');
  for (const i of [1, 3, 5, 7]) setField('y', i, '9');
  setParam('max-move', '1e200');
  setParam('max-skip', '0');
  byId('btn-solve').dispatch('click');

  assert.equal(byId('broke-view').hidden, true);
  const html = segRows().map((r) => r.innerHTML).join('\n');
  assert.doesNotMatch(html, /Infinity|NaN/);
  assert.doesNotMatch(html, /✗/);
  assert.equal(segRows().length, 3); // 三段母女直连
  assert.equal((html.match(/1e\+199 ✓/g) || []).length, 3);
  assertSvgFinite();
});
