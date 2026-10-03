import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom.js';

// 先装 DOM 桩并种入含超大十进制亮度（文本形式）的草稿，再导入前端模块：
// 模拟研究员的草稿经 localStorage 恢复后发起复原的完整流程
const dom = installDom();

const P53 = '9007199254740992';   // 2^53
const P53_1 = '9007199254740993'; // 2^53 + 1（Number 无法精确表示）

dom.localStorage.setItem('algae-lineage-draft-v1', JSON.stringify({
  frames: [
    [{ id: 'a', x: 0, y: 0, brightness: 0 }, { id: 'z1', x: 9, y: 9, brightness: 0 }],
    // low 先录入；与 high 同坐标，几何条件完全相同，仅亮度相差 1
    [{ id: 'low', x: 1, y: 0, brightness: P53 }, { id: 'high', x: 1, y: 0, brightness: P53_1 }],
    [{ id: 'c', x: 2, y: 0, brightness: 0 }, { id: 'z3', x: 9, y: 9, brightness: 0 }],
    [{ id: 'd', x: 3, y: 0, brightness: 0 }, { id: 'z4', x: 9, y: 9, brightness: 0 }],
  ],
  params: { startId: 'a', maxMove: 1, maxSkip: 0, survivors: 1 },
}));

await import('../public/app.js');

const byId = dom.byId;

function brightnessInputs() {
  return byId('frames-editor')._walk()
    .filter((e) => e.tagName === 'input' && e.dataset.field === 'brightness');
}
function adoptedRows() {
  return byId('adopted-tables')._walk().filter((e) => e.classList.contains('af-spot'));
}

test('草稿恢复：超大十进制亮度按原文显示，不被四舍五入', () => {
  const vals = brightnessInputs().map((e) => String(e.value));
  assert.ok(vals.includes(P53));
  assert.ok(vals.includes(P53_1));
});

test('复原：采用更亮的 high（而非先录入的 low），总亮度精确显示 2^53+1', () => {
  byId('btn-solve').dispatch('click');

  assert.equal(byId('input-errors').hidden, true); // 不是校验错误，亮度本身合法
  assert.equal(byId('broke-view').hidden, true);
  assert.equal(byId('result-view').hidden, false);

  const summary = byId('summary').innerHTML;
  assert.match(summary, /总亮度/);
  assert.match(summary, new RegExp(P53_1)); // 精确 9007199254740993
  assert.doesNotMatch(summary, new RegExp(`>${P53}<`)); // 不得显示成被舍入的 2^53

  const ids = adoptedRows().map((e) => e.children[0].textContent);
  assert.deepEqual(ids.map((t) => t.replace(/^●\s*/, '')), ['a', 'high', 'c', 'd']);
  // 采用表中 high 的亮度按精确文本显示
  const highRow = adoptedRows().find((e) => e.children[0].textContent.includes('high'));
  assert.match(highRow.children[1].textContent, new RegExp(P53_1));
});

test('真正同亮度时按输入顺序稳定裁决：两个亮度都改成 2^53 后采用先录入的 low', async () => {
  const editor = byId('frames-editor');
  // 亮度框按渲染顺序排列：第 1 帧 2 个，其后是第 2 帧的 low、high（整体第 3、4 个）
  const highB = brightnessInputs()[3];
  highB.value = P53;
  editor.dispatch('input', { target: highB });
  await new Promise((r) => setTimeout(r, 250)); // 等草稿防抖落盘

  byId('btn-solve').dispatch('click');
  assert.equal(byId('broke-view').hidden, true);
  const ids = adoptedRows().map((e) => e.children[0].textContent.replace(/^●\s*/, ''));
  assert.deepEqual(ids, ['a', 'low', 'c', 'd']);
  assert.match(byId('summary').innerHTML, new RegExp(P53));
});
