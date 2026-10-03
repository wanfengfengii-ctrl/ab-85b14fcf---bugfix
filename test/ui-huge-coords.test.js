import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom.js';

// 先装 DOM 桩并种入任务场景一草稿（横坐标每帧横移 10^199，最大位移 10^200）
const dom = installDom();

const E199 = '1' + '0'.repeat(199);
const STEP2 = '2' + '0'.repeat(199);
const STEP3 = '3' + '0'.repeat(199);

dom.localStorage.setItem('algae-lineage-draft-v1', JSON.stringify({
  frames: [
    [{ id: 'a', x: 0, y: 0, brightness: 10 }, { id: 'z', x: 9, y: 9, brightness: 1 }],
    [{ id: 'b', x: E199, y: 0, brightness: 10 }, { id: 'z', x: 9, y: 9, brightness: 1 }],
    [{ id: 'c', x: STEP2, y: 0, brightness: 10 }, { id: 'z', x: 9, y: 9, brightness: 1 }],
    [{ id: 'd', x: STEP3, y: 0, brightness: 10 }, { id: 'z', x: 9, y: 9, brightness: 1 }],
  ],
  params: { startId: 'a', maxMove: '1e200', maxSkip: 0, survivors: 1 },
}));

await import('../public/app.js');

const byId = dom.byId;

function segRows() {
  return byId('segments-table tbody').children.map((r) => r.innerHTML);
}
function setField(frameIdx, spotIdx, field, value) {
  const editor = byId('frames-editor');
  const inputs = editor._walk()
    .filter((e) => e.tagName === 'input' && e.dataset.field === field);
  const input = inputs[frameIdx * 2 + spotIdx];
  assert.ok(input, `字段不存在: 帧${frameIdx} 斑点${spotIdx} ${field}`);
  input.value = String(value);
  editor.dispatch('input', { target: input });
}
function setParam(key, value) {
  const el = byId(key === 'maxMove' ? 'max-move' : key === 'maxSkip' ? 'max-skip' : 'survivors');
  el.value = String(value);
  el.dispatch('input');
}
function solve() {
  byId('btn-solve').dispatch('click');
  assert.equal(byId('broke-view').hidden, true, byId('broke-view').innerHTML);
  assert.equal(byId('result-view').hidden, false);
}

test('场景一：三段直连距离有限显示为 10^199（科学计数形式）且全部未超限', () => {
  solve();
  const rows = segRows();
  assert.equal(rows.length, 3);
  for (const html of rows) {
    assert.match(html, /母女直连/);
    assert.match(html, /1e\+199/); // 等价科学计数形式
    assert.match(html, /✓/);       // 未超限
    assert.doesNotMatch(html, /Infinity/);
    assert.doesNotMatch(html, /NaN/);
    assert.doesNotMatch(html, /✗/);
  }
  // SVG 中所有坐标属性都必须是有限数
  const svgHtml = byId('lineage-svg')._walk()
    .flatMap((e) => Object.values(e.attrs)).join(' ');
  assert.doesNotMatch(svgHtml, /NaN|Infinity/);
});

test('场景二：改为 10^400 基值漏检路径后，虚点精确显示为 (10^400+1, 0)，两段距离各为 1', () => {
  const Bb = 10n ** 400n;
  const B = Bb.toString();
  const B1 = (Bb + 1n).toString();
  const B2 = (Bb + 2n).toString();
  const B3 = (Bb + 3n).toString();

  // 帧 0：a 位于基值
  setField(0, 0, 'x', B);
  // 帧 1：整帧无邻近斑点（漏检）
  setField(1, 0, 'id', 'm1'); setField(1, 0, 'x', 0); setField(1, 0, 'y', 0);
  setField(1, 1, 'id', 'm2'); setField(1, 1, 'x', 0); setField(1, 1, 'y', 5);
  // 帧 2：c 位于基值 +2
  setField(2, 0, 'id', 'c'); setField(2, 0, 'x', B2);
  // 帧 3：d 位于基值 +3
  setField(3, 0, 'id', 'd'); setField(3, 0, 'x', B3);
  setParam('maxMove', 1);
  setParam('maxSkip', 1);
  solve();

  const rows = segRows();
  // 两段漏检 + 一段直连
  const all = rows.join('\n');
  assert.match(all, /漏检段 1\/2/);
  assert.match(all, /漏检段 2\/2/);
  assert.match(all, /母女直连/);
  // 虚点精确坐标（帧间虚点行各出现一次 B+1）
  assert.equal((all.match(new RegExp(`\\(${B1}, 0\\)`, 'g')) || []).length, 2);
  assert.doesNotMatch(all, /Infinity/);
  assert.doesNotMatch(all, /NaN/);
  // 两段漏检距离与末段直连距离均为 1，且全部未超限
  assert.equal((all.match(/<td class="num">1 ✓/g) || []).length, 3);
  assert.doesNotMatch(all, /✗/);
  // 采用表回显精确坐标文本
  const adopted = byId('adopted-tables')._walk().map((e) => e.textContent).join(' ');
  assert.match(adopted, new RegExp(B2));
  assert.match(adopted, new RegExp(B3));

  // SVG 虚点圆心与各属性全部有限，无 NaN/Infinity
  const svgHtml = byId('lineage-svg')._walk()
    .flatMap((e) => Object.values(e.attrs)).join(' ');
  assert.doesNotMatch(svgHtml, /NaN|Infinity/);
});

test('共同超大基值：谱系图保留同帧斑点的相对差异，不折叠也不出现 NaN/Infinity', () => {
  // 把每帧的干扰斑点挪到 (10^400, 10^400+1)：与主路径共享超大基值，仅 y 相差 1。
  // 旧实现经 Number 求 yMax-yMin 得到 NaN，两个位置会塌缩；修复后 cy 必须明显不同。
  const Bb = 10n ** 400n;
  const B = Bb.toString();
  const Bplus1 = (Bb + 1n).toString();
  for (let f = 0; f < 4; f++) {
    setField(f, 1, 'id', 'z');
    setField(f, 1, 'x', B);
    setField(f, 1, 'y', Bplus1);
  }
  solve();

  const walk = byId('lineage-svg')._walk();
  const circles = walk.filter((e) => e.tagName === 'circle');
  assert.ok(circles.length >= 8); // 每帧 2 个斑点（含虚点）
  const cys = new Set(circles.map((c) => c.attrs.cy));
  // 同帧 y=0（主链）与 y=10^400+1（干扰）的圆心必须落在不同高度
  assert.ok(cys.size >= 2, `圆心高度被折叠：${[...cys].join(',')}`);
  const values = walk.flatMap((e) => Object.values(e.attrs)).join(' ');
  assert.doesNotMatch(values, /NaN|Infinity/);
  // 主链斑点（y=0，比例上的最低点）存在；干扰斑点在最高点附近
  const mainCy = Math.max(...circles.map((c) => Number(c.attrs.cy)));
  const junkCy = Math.min(...circles.map((c) => Number(c.attrs.cy)));
  assert.ok(Number.isFinite(mainCy) && Number.isFinite(junkCy));
  assert.ok(mainCy - junkCy > 100, `相对差未保留：${mainCy} vs ${junkCy}`);
});
