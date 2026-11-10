import assert from 'node:assert/strict';
import test from 'node:test';

import { PICK_DEDUPE_WINDOW_MS, isDuplicatePick, pickSignature } from '../lib/shared/pick-dedupe.js';

const PAYLOAD = {
	url: 'https://a.test/x',
	selector: 'button.primary',
	seq: 7,
	rect: { x: 10, y: 20, width: 80, height: 24 },
	comment: '字体太大',
};

test('同一次提交重复投递判为重复', () => {
	const signature = pickSignature(PAYLOAD);
	assert.equal(isDuplicatePick({ signature, at: 1000 }, signature, 1200), true);
});

test('超过去重窗口后允许再记一次', () => {
	const signature = pickSignature(PAYLOAD);
	assert.equal(isDuplicatePick({ signature, at: 1000 }, signature, 1000 + PICK_DEDUPE_WINDOW_MS), false);
});

test('换了元素、位置或备注都不算重复', () => {
	const base = pickSignature(PAYLOAD);
	const cases = [
		pickSignature({ ...PAYLOAD, selector: 'button.secondary' }),
		pickSignature({ ...PAYLOAD, seq: 8 }),
		pickSignature({ ...PAYLOAD, rect: { x: 11, y: 20 } }),
		pickSignature({ ...PAYLOAD, comment: '颜色太浅' }),
		pickSignature({ ...PAYLOAD, url: 'https://a.test/y' }),
	];
	for (const other of cases) assert.notEqual(other, base);
	assert.equal(isDuplicatePick({ signature: base, at: 1000 }, cases[0], 1100), false);
});

test('缺字段的投递不会互相误判为同一份', () => {
	const first = pickSignature({ selector: 'div' }, 'https://a.test/');
	const second = pickSignature({ selector: 'div', seq: 2 }, 'https://a.test/');
	assert.notEqual(first, second);
});

test('没有上一次记录时不算重复', () => {
	assert.equal(isDuplicatePick(null, 'x', 1000), false);
	assert.equal(isDuplicatePick({ signature: undefined, at: 1 }, 'x', 2), false);
});
