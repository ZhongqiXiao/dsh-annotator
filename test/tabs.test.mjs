import assert from 'node:assert/strict';
import test from 'node:test';

import { TAB_LIMIT, mergeTab, splitTabs } from '../lib/shared/tabs.js';

const page = (targetId, url, title, contextId) => ({ targetId, url, title, contextId });

test('新标签追加到末尾，已有标签原地更新不打乱顺序', () => {
	const tabs = [];
	mergeTab(tabs, page('a', 'https://a.test', 'A', 'ctx1'));
	mergeTab(tabs, page('b', 'https://b.test', 'B', 'ctx1'));
	mergeTab(tabs, page('a', 'https://a.test/next', 'A2', 'ctx1'));
	assert.deepEqual(
		tabs.map((tab) => [tab.targetId, tab.url, tab.title]),
		[
			['a', 'https://a.test/next', 'A2'],
			['b', 'https://b.test', 'B'],
		],
	);
});

test('同一地址但本次没带标题时保留旧标题', () => {
	const tabs = [page('a', 'https://a.test', '真标题', 'ctx1')];
	mergeTab(tabs, { targetId: 'a', url: 'https://a.test', browserContextId: 'ctx1' });
	assert.equal(tabs[0].title, '真标题');
});

test('地址变了就认新标题，哪怕这次标题还是空的', () => {
	const tabs = [page('a', 'https://a.test', '旧标题', 'ctx1')];
	mergeTab(tabs, { targetId: 'a', url: 'https://b.test', browserContextId: 'ctx1' });
	assert.equal(tabs[0].title, '');
	mergeTab(tabs, { targetId: 'a', url: 'https://b.test', title: '新标题' });
	assert.equal(tabs[0].title, '新标题');
});

test('contextId 缺失时沿用旧值，别把已知空间的页退回默认空间', () => {
	const tabs = [page('a', 'https://a.test', 'A', 'ctx1')];
	mergeTab(tabs, { targetId: 'a', url: 'https://a.test', title: 'A' });
	assert.equal(tabs[0].contextId, 'ctx1');
	mergeTab(tabs, { targetId: 'a', url: 'https://a.test', title: 'A', browserContextId: 'ctx2' });
	assert.equal(tabs[0].contextId, 'ctx2');
});

test('没有 targetId 的脏数据直接忽略', () => {
	const tabs = [page('a', 'https://a.test', 'A', '')];
	mergeTab(tabs, { url: 'https://x.test' });
	mergeTab(tabs, null);
	assert.equal(tabs.length, 1);
});

test('标签条只平铺前 10 个，其余进「更多」', () => {
	const tabs = Array.from({ length: 12 }, (_, index) =>
		page('t' + index, 'https://t' + index + '.test', 'T' + index, ''),
	);
	const { visible, extra } = splitTabs(tabs);
	assert.equal(TAB_LIMIT, 10);
	assert.equal(visible.length, 10);
	assert.equal(extra.length, 2);
	assert.equal(extra[0].targetId, 't10');
	assert.deepEqual(splitTabs(tabs.slice(0, 10)).extra, []);
	assert.deepEqual(splitTabs(undefined).visible, []);
});
