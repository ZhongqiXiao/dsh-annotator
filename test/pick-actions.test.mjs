import assert from 'node:assert/strict';
import test from 'node:test';

import { advancePendingConsume, popLastPick } from '../lib/shared/pick-actions.js';

// HUD 的撤销/完成语义已下沉为纯函数（AGENTS.md：纯函数下沉 shared、测试只测纯函数）。
// 不再实例化 VisualPicker、不探私有字段——host 侧只是对这两个函数的薄委托。

test('popLastPick pops the tail into a new list; empty/invalid input is a no-op', () => {
	const picks = [
		{ id: 'p1', seq: 1 },
		{ id: 'p2', seq: 2 },
	];
	const popped = popLastPick(picks);
	assert.deepEqual(
		popped.remaining.map((pick) => pick.id),
		['p1'],
	);
	assert.equal(popped.removed.id, 'p2');
	// 不原地修改入参：调用方决定何时把 remaining 写回状态。
	assert.equal(picks.length, 2);
	assert.equal(popLastPick([]), null);
	assert.equal(popLastPick(undefined), null);
	assert.equal(popLastPick('nope'), null);
});

test('advancePendingConsume is monotonic and ignores empty pick lists', () => {
	assert.equal(advancePendingConsume(0, 0), 0);
	assert.equal(advancePendingConsume(0, 1), 1);
	assert.equal(advancePendingConsume(3, 2), 4);
	assert.equal(advancePendingConsume(3, 0), 3);
});
