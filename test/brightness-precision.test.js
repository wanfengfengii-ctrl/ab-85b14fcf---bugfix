import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveLineage, validateInput, isNonNegInt } from '../src/lineage.js';

const P53 = '9007199254740992';   // 2^53（double 可精确表示）
const P53_1 = '9007199254740993'; // 2^53 + 1（double 不可表示，Number 解析会丢成 2^53）

const S = (id, x, y, brightness) => ({ id, x, y, brightness });

/**
 * 任务回归场景：4 帧各 2 斑点；第 2 帧 low/high 同坐标，分别唯一可延续到
 * 之后的 c、d（几何条件完全相同），low 先录入，二者亮度相差 1 且超大。
 */
const draftFrames = (lowB = P53, highB = P53_1) => [
  [S('a', 0, 0, 0), S('z1', 9, 9, 0)],
  [S('low', 1, 0, lowB), S('high', 1, 0, highB)],
  [S('c', 2, 0, 0), S('z3', 9, 9, 0)],
  [S('d', 3, 0, 0), S('z4', 9, 9, 0)],
];
const OPTS = { startId: 'a', maxMove: 1, maxSkip: 0, survivors: 1 };

test('超大亮度不被校验拒绝（契约允许，不设安全整数上限）', () => {
  assert.deepEqual(validateInput(draftFrames(), OPTS), []);
  assert.ok(isNonNegInt(P53_1));
  assert.ok(isNonNegInt(9007199254740992)); // 可精确表示的 number 照常接受
  assert.ok(isNonNegInt(9007199254740993n)); // bigint 同样接受
  assert.ok(isNonNegInt('99999999999999999999999999')); // 远超 2^53 也接受
  assert.ok(!isNonNegInt('-1'));
  assert.ok(!isNonNegInt('1.5'));
  assert.ok(!isNonNegInt(''));
  assert.ok(!isNonNegInt(-1n));
});

test('回归：相差 1 的超大亮度按精确值裁决，采用更亮的 high 而非先录入的 low', () => {
  const r = solveLineage(draftFrames(), OPTS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineage.adopted.map((a) => a.spot.id), ['a', 'high', 'c', 'd']);
  assert.deepEqual(r.lineage.survivors, ['d']);
  assert.equal(r.lineage.misses, 0);
  // 总亮度精确为 2^53+1（十进制文本，不被 double 舍入为 2^53）
  assert.equal(r.lineage.totalBrightness, P53_1);
  assert.equal(typeof r.lineage.totalBrightness, 'string');
  assert.ok(!r.lineage.adopted.some((a) => a.spot.id === 'low'));
});

test('采用斑点亮度按草稿原文（十进制文本）精确回显', () => {
  const r = solveLineage(draftFrames(), OPTS);
  const high = r.lineage.adopted.find((a) => a.spot.id === 'high');
  assert.equal(high.spot.brightness, P53_1);
});

test('真正同亮度时退回输入顺序稳定裁决：low 先录入则采用 low', () => {
  const r = solveLineage(draftFrames(P53, P53), OPTS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineage.adopted.map((a) => a.spot.id), ['a', 'low', 'c', 'd']);
  assert.equal(r.lineage.totalBrightness, P53);
});

test('录入顺序对调后同亮度稳定裁决改采先录入者（与位置/编号无关）', () => {
  const frames = [
    [S('a', 0, 0, 0), S('z1', 9, 9, 0)],
    [S('high', 1, 0, P53_1), S('low', 1, 0, P53_1)],
    [S('c', 2, 0, 0), S('z3', 9, 9, 0)],
    [S('d', 3, 0, 0), S('z4', 9, 9, 0)],
  ];
  const r = solveLineage(frames, OPTS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineage.adopted.map((a) => a.spot.id), ['a', 'high', 'c', 'd']);
  assert.equal(r.lineage.totalBrightness, P53_1);
});

test('普通非负整数亮度：总亮度仍为 number 且裁决结果不变', () => {
  const frames = [
    [S('a', 0, 0, 10), S('z1', 9, 9, 1)],
    [S('low', 1, 0, 40), S('high', 1, 0, 41)],
    [S('c', 2, 0, 10), S('z3', 9, 9, 1)],
    [S('d', 3, 0, 10), S('z4', 9, 9, 1)],
  ];
  const r = solveLineage(frames, OPTS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineage.adopted.map((a) => a.spot.id), ['a', 'high', 'c', 'd']);
  assert.equal(r.lineage.totalBrightness, 71);
  assert.equal(typeof r.lineage.totalBrightness, 'number');
});

test('字符串与 number 混录的普通亮度结论一致（精确解析，不丢值）', () => {
  const mk = (b2) => [
    [S('a', 0, 0, '10'), S('z1', 9, 9, 1)],
    [S('low', 1, 0, b2), S('high', 1, 0, b2)],
    [S('c', 2, 0, 10), S('z3', 9, 9, 1)],
    [S('d', 3, 0, 10), S('z4', 9, 9, 1)],
  ];
  const rs = solveLineage(mk('40'), OPTS);
  const rn = solveLineage(mk(40), OPTS);
  assert.equal(rs.ok, true);
  assert.equal(rn.ok, true);
  assert.equal(rs.lineage.totalBrightness, rn.lineage.totalBrightness);
  assert.deepEqual(rs.lineage.adopted.map((a) => a.spot.id),
                   rn.lineage.adopted.map((a) => a.spot.id));
});

test('远超过 2^53 的亮度精确累加：两斑点之和不被舍入', () => {
  const BIG = '10000000000000000000000000'; // 10^25
  const frames = [
    [S('a', 0, 0, BIG), S('z1', 9, 9, 0)],
    [S('b', 1, 0, 0), S('z2', 9, 9, BIG)],
    [S('c', 2, 0, BIG), S('z3', 9, 9, 0)],
    [S('d', 3, 0, 0), S('z4', 9, 9, 0)],
  ];
  const r = solveLineage(frames, OPTS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineage.adopted.map((a) => a.spot.id), ['a', 'b', 'c', 'd']);
  // 10^25 + 10^25 = 2×10^25，逐位精确
  assert.equal(r.lineage.totalBrightness, '20000000000000000000000000');
});
