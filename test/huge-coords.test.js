import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveLineage } from '../src/lineage.js';

const S = (id, x, y = 0, brightness = 10) => ({ id, x, y, brightness });

const E199 = '1' + '0'.repeat(199);     // 10^199
const E200 = '1' + '0'.repeat(200);     // 10^200（最大位移，double 可表示）
const BASE = (10n ** 400n).toString();  // 10^400 基值
const at = (b, delta) => (10n ** 400n + BigInt(delta)).toString();

test('任务场景一：横移 10^199 的三段直连，距离有限显示为 10^199 且均未超限', () => {
  const frames = [
    [S('a', 0, 0), S('z', 9, 9, 1)],
    [S('b', E199, 0), S('z', 9, 9, 1)],
    [S('c', '2' + '0'.repeat(199), 0), S('z', 9, 9, 1)],
    [S('d', '3' + '0'.repeat(199), 0), S('z', 9, 9, 1)],
  ];
  const r = solveLineage(frames, { startId: 'a', maxMove: 1e200, maxSkip: 0, survivors: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineage.survivors, ['d']);
  assert.equal(r.lineage.misses, 0);
  assert.equal(r.lineage.links.length, 3);
  for (const link of r.lineage.links) {
    assert.equal(link.kind, 'direct');
    const seg = link.segments[0];
    assert.equal(seg.virtual, false);
    // 距离必须有限（不是 Infinity），且就是 double 表示的 10^199（科学计数形式）
    assert.ok(Number.isFinite(seg.distance), `距离不是有限数：${seg.distance}`);
    assert.equal(seg.distance, 1e199);
    assert.notEqual(seg.distance, Infinity);
    // 超限判定来自精确 BigInt 比较：10^199 ≤ 10^200，不得标记超限
    assert.equal(seg.within, true);
  }
});

test('任务场景二：10^400 基值上的跨帧漏检，虚点精确为 (10^400+1, 0)，两段距离各为 1', () => {
  const frames = [
    [S('a', BASE, 0), S('z', 9, 9, 1)],
    [S('m1', 0, 0, 1), S('m2', 0, 5, 1)], // a 附近无斑点，中间帧整帧漏检
    [S('c', at(0, 2), 0), S('z', 9, 9, 1)],
    [S('d', at(0, 3), 0), S('z', 9, 9, 1)],
  ];
  const r = solveLineage(frames, { startId: 'a', maxMove: 1, maxSkip: 1, survivors: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.lineage.misses, 1);
  assert.deepEqual(r.lineage.survivors, ['d']);

  const skip = r.lineage.links.find((l) => l.kind === 'skip');
  assert.ok(skip, '应存在一条跨帧漏检连接');
  assert.equal(skip.from.spot.id, 'a');
  assert.equal(skip.to.spot.id, 'c');
  assert.equal(skip.segments.length, 2);
  const [s1, s2] = skip.segments;
  // 虚点精确位于 (10^400+1, 0)：逐位十进制文本，不是 Infinity，也不是被抹掉差的 10^400
  const expectedMid = at(0, 1);
  assert.equal(s1.to.x, expectedMid);
  assert.equal(s1.to.y, '0');
  assert.equal(s2.from.x, expectedMid);
  assert.equal(s2.from.y, '0');
  assert.equal(s1.to.frame, 1); // 虚点位于被漏检的中间帧（第 2 帧）
  // 两段位移都恰好为 1，且都在最大位移 1 内
  assert.equal(s1.distance, 1);
  assert.equal(s2.distance, 1);
  assert.equal(s1.within, true);
  assert.equal(s2.within, true);

  // 末段直连 c → d 距离 1
  const direct = r.lineage.links.find((l) => l.kind === 'direct');
  assert.ok(direct);
  assert.equal(direct.segments[0].distance, 1);
  assert.equal(direct.segments[0].within, true);
});

test('超大坐标奇数中点：虚点坐标给出精确 .5 文本（含负数），距离仍有限且精确', () => {
  // a(10^400, -1) 跨帧到 c(10^400+3, 0)：中点 (10^400+1.5, -0.5)，总距离 √10，半段 √10/2
  const frames = [
    [S('a', BASE, -1), S('z', 9, 9, 1)],
    [S('m1', 0, 0, 1), S('m2', 0, 5, 1)],
    [S('c', at(0, 3), 0), S('z', 9, 9, 1)],
    [S('d', at(0, 4), 0), S('z', 9, 9, 1)],
  ];
  const r = solveLineage(frames, { startId: 'a', maxMove: 2, maxSkip: 1, survivors: 1 });
  assert.equal(r.ok, true);
  const skip = r.lineage.links.find((l) => l.kind === 'skip');
  assert.ok(skip);
  assert.equal(skip.segments[0].to.x, `${at(0, 1)}.5`);
  assert.equal(skip.segments[0].to.y, '-0.5');
  assert.ok(Number.isFinite(skip.segments[0].distance));
  assert.equal(skip.segments[0].distance, Math.sqrt(10) / 2);
  assert.equal(skip.segments[0].distance, skip.segments[1].distance);
});

test('超大坐标 + 超大最大位移：直连距离有限、within 与精确判定一致', () => {
  // 横纵各移 10^199：距离 √2·10^199；最大位移 2·10^199 可连，1·10^199 不可连。
  // 干扰斑点放在 10^250：距 0 与主链都超过 10^199/2·10^199，不可达。
  const J = '1' + '0'.repeat(250);
  const mk = () => [
    [S('a', 0, 0), S('z', J, J, 1)],
    [S('b', E199, E199), S('z', J, J, 1)],
    [S('c', '2' + '0'.repeat(199), '2' + '0'.repeat(199)), S('z', J, J, 1)],
    [S('d', '3' + '0'.repeat(199), '3' + '0'.repeat(199)), S('z', J, J, 1)],
  ];
  const ok = solveLineage(mk(), { startId: 'a', maxMove: 2e199, maxSkip: 0, survivors: 1 });
  assert.equal(ok.ok, true);
  for (const l of ok.lineage.links) {
    const d = l.segments[0].distance;
    assert.ok(Number.isFinite(d));
    // 相对误差 ≤ 1 ULP：BigInt 精确四舍五入的值甚至可能比
    // Math.SQRT2 * 1e199（两次 double 舍入）更接近真实值。
    const ref = Math.SQRT2 * 1e199;
    assert.ok(Math.abs(d - ref) <= 2 * Number.EPSILON * ref);
    assert.equal(l.segments[0].within, true);
  }
  const no = solveLineage(mk(), { startId: 'a', maxMove: 1e199, maxSkip: 0, survivors: 1 });
  assert.equal(no.ok, false);
  assert.equal(no.brokenGap, 0);
});

test('普通整数坐标：展示距离与旧 Math.sqrt(Number(d2)) 逐位一致', () => {
  const mk = () => [
    [S('a', 0, 0), S('z', 9, 9, 1)],
    [S('b', 3, 4), S('z', 9, 9, 1)],    // 5
    [S('c', 4, 3), S('z', 9, 9, 1)],    // √2
    [S('d', 4, 3), S('z', 9, 9, 1)],    // 0
  ];
  const r = solveLineage(mk(), { startId: 'a', maxMove: 5, maxSkip: 0, survivors: 1 });
  assert.equal(r.ok, true);
  const [d1, d2, d3] = r.lineage.links.map((l) => l.segments[0].distance);
  assert.equal(d1, 5);
  assert.equal(d2, Math.SQRT2);
  assert.equal(d3, 0);
});

test('最大位移无界且距离超 double 上限（10^350）：仍不得展示 Infinity/NaN', () => {
  const E = '1' + '0'.repeat(350);
  const frames = [
    [S('a', 0, 0), S('z', 9, 9, 1)],
    [S('b', E, 0), S('z', 9, 9, 1)],
    [S('c', 0, 0), S('z', 9, 9, 1)],
    [S('d', E, 0), S('z', 9, 9, 1)],
  ];
  const r = solveLineage(frames, { startId: 'a', maxMove: Infinity, maxSkip: 0, survivors: 1 });
  assert.equal(r.ok, true);
  for (const l of r.lineage.links) {
    const d = l.segments[0].distance;
    assert.notEqual(d, Infinity);
    assert.notEqual(d, NaN);
    assert.match(String(d), /^1(\.0+)?e\+?350$/); // 1e350 的科学计数形式
    assert.equal(l.segments[0].within, true);
  }
});
