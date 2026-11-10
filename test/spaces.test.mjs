import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_SPACE_NAME,
	filterTabsBySpace,
	nextSpaceName,
	normalizeSpaceId,
	sanitizeSpaceName,
} from '../lib/shared/spaces.js';

test('空间名压平控制字符与连续空白，超长截断', () => {
	assert.equal(sanitizeSpaceName('  注册\t页面  '), '注册 页面');
	assert.equal(sanitizeSpaceName('a\u0000b\u001fc'), 'a b c');
	assert.equal(sanitizeSpaceName(''), null);
	assert.equal(sanitizeSpaceName('   '), null);
	assert.equal(sanitizeSpaceName(undefined), null);
	assert.equal(sanitizeSpaceName('x'.repeat(50)).length, 40);
});

test('自动编号避开已占用的名字', () => {
	assert.equal(nextSpaceName([]), '空间');
	assert.equal(nextSpaceName(['空间']), '空间 2');
	assert.equal(nextSpaceName(['空间', '空间 2']), '空间 3');
	assert.equal(nextSpaceName([], DEFAULT_SPACE_NAME), DEFAULT_SPACE_NAME);
});

test('空值归一到默认空间', () => {
	assert.equal(normalizeSpaceId(undefined), '');
	assert.equal(normalizeSpaceId(null), '');
	assert.equal(normalizeSpaceId('ctx-2'), 'ctx-2');
});

test('标签按 context 归属空间，未识别的算默认空间', () => {
	const tabs = [
		{ targetId: 'a', contextId: 'ctx-1' },
		{ targetId: 'b', contextId: '' },
		{ targetId: 'c', contextId: 'ctx-2' },
	];
	assert.deepEqual(
		filterTabsBySpace(tabs, '', 'ctx-1').map((tab) => tab.targetId),
		['a', 'b'],
	);
	assert.deepEqual(
		filterTabsBySpace(tabs, 'ctx-2', 'ctx-1').map((tab) => tab.targetId),
		['c'],
	);
	assert.deepEqual(
		filterTabsBySpace(tabs, '', '').map((tab) => tab.targetId),
		['b'],
	);
	assert.deepEqual(filterTabsBySpace(null, '', ''), []);
});
