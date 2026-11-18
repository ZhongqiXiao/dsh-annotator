import assert from 'node:assert/strict';
import test from 'node:test';

import { VisualPicker } from '../lib/session.js';

/**
 * 一个只回 `Target.getTargets` 的假 CDP：refreshTabs 的对账逻辑不碰其它命令。
 * 已经在 attached 里的标签不会再走 attach 分支，用例因此不需要模拟整个握手。
 */
function fakeCdp(picker, targetInfos) {
	picker.cdp = {
		closed: false,
		sent: [],
		async send(method) {
			this.sent.push(method);
			if (method === 'Target.getTargets') return { targetInfos };
			return {};
		},
	};
	picker.tabsRefreshedAt = 0;
	return picker;
}

test('refreshTabs 会把已经关掉、事件却没送到的标签剪掉', async () => {
	const picker = new VisualPicker();
	picker.state.tabs = [
		{ targetId: 'ghost', url: 'about:blank', title: 'about:blank', contextId: 'ctx-a' },
		{ targetId: 'live', url: 'http://127.0.0.1:1/a', title: 'a', contextId: 'ctx-a' },
	];
	picker.attached.set('ghost', 's-ghost');
	picker.attached.set('live', 's-live');
	picker.overlayOk.set('ghost', true);
	picker.activeTargetId = 'ghost';
	fakeCdp(picker, [
		{ targetId: 'live', type: 'page', url: 'http://127.0.0.1:1/a', title: 'a', browserContextId: 'ctx-a' },
	]);

	await picker.refreshTabs({ force: true });

	assert.deepEqual(
		picker.state.tabs.map((tab) => tab.targetId),
		['live'],
		'浏览器里已经没有的目标不应留在标签条上',
	);
	assert.equal(picker.attached.has('ghost'), false, '幽灵标签的 CDP 会话也要一并丢掉');
	assert.equal(picker.overlayOk.has('ghost'), false);
	assert.equal(picker.activeTargetId, null, '活动页被剪掉后不能继续指向它');
	assert.ok(!picker.snapshot().tabs.some((tab) => tab.targetId === 'ghost'));
});

test('refreshTabs 不会因为一个目标都没回就把标签条清空', async () => {
	const picker = new VisualPicker();
	picker.state.tabs = [{ targetId: 'live', url: 'http://127.0.0.1:1/a', title: 'a', contextId: 'ctx-a' }];
	fakeCdp(picker, []);

	await picker.refreshTabs({ force: true });

	assert.deepEqual(
		picker.state.tabs.map((tab) => tab.targetId),
		['live'],
		'获取失败（空列表）时保持原样，别把面板清空成假象',
	);
});
