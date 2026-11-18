import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_SPACE_NAME,
	filterTabsBySpace,
	nextSpaceName,
	normalizeSpaceId,
	pickDefaultContextId,
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
	// ctx-1 是默认空间的 id，ctx-2 是用户建的空间：默认空间里既有默认页，也有
	// 认不出来的 context（扩展页、内部页）——它们不该从标签条里消失。
	assert.deepEqual(
		filterTabsBySpace(tabs, '', 'ctx-1', ['ctx-2']).map((tab) => tab.targetId),
		['a', 'b'],
	);
	assert.deepEqual(
		filterTabsBySpace(tabs, 'ctx-2', 'ctx-1', ['ctx-2']).map((tab) => tab.targetId),
		['c'],
	);
	assert.deepEqual(filterTabsBySpace(null, '', ''), []);
});

test('默认空间的 id 认错了，页面也不能从标签条里消失', () => {
	// 2026-11-18 CI 的假红就是这一条：真实 profile 里同时躺着几个 context，
	// 默认空间被猜成了另一个（扩展的），真正的页面于是被判成「别的空间」。
	const tabs = [{ targetId: 'page', contextId: 'ctx-extension' }];
	assert.deepEqual(
		filterTabsBySpace(tabs, '', 'ctx-extension', ['ctx-incognito']).map((tab) => tab.targetId),
		['page'],
	);
	// 猜错了也不影响「明确属于某个空间」的那些标签：它们只在那个空间里出现。
	assert.deepEqual(filterTabsBySpace(tabs, 'ctx-incognito', 'ctx-x', ['ctx-incognito']), []);
	assert.deepEqual(
		filterTabsBySpace(tabs, '', 'ctx-x', ['ctx-incognito']).map((tab) => tab.targetId),
		['page'],
	);
});

test('默认空间的 context 优先听浏览器自己说', () => {
	assert.equal(
		pickDefaultContextId({
			authoritative: 'ctx-default',
			activeContext: 'ctx-extension',
			pageContexts: ['ctx-extension'],
			targetContexts: ['ctx-extension'],
		}),
		'ctx-default',
	);
	// 没有 authoritative 时按用户眼前这一页走，而不是「第一个不相干的 target」。
	assert.equal(
		pickDefaultContextId({ activeContext: 'ctx-page', pageContexts: ['ctx-other'], targetContexts: ['ctx-ext'] }),
		'ctx-page',
	);
	assert.equal(pickDefaultContextId({ pageContexts: ['', 'ctx-page'], targetContexts: ['ctx-ext'] }), 'ctx-page');
	// 全都认不出时明确返回空串，别编一个 id 出来（下面 filter 会按「未知=默认」兜住）。
	assert.equal(pickDefaultContextId({ targetContexts: ['', undefined] }), '');
	assert.equal(pickDefaultContextId({}), '');
	// 已知空间里的页面不能反过来冒充默认空间。
	assert.equal(pickDefaultContextId({ activeContext: 'ctx-space', knownContexts: ['ctx-space'] }), '');
});
