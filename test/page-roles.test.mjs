import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearPairTo,
	delegationSummary,
	groupPicks,
	includedPicks,
	isResend,
	normalizeSpec,
	pageHudInfo,
	pageKeyOf,
	pagePickCounts,
	pairAllUnpaired,
	pairIdsOf,
	pairRows,
	pairTo,
	pairedTargetsOf,
	pickRoleOf,
	refLabelOf,
	refLabelsOf,
	setPairIds,
	targetTitleOf,
	unpair,
	unpairAll,
} from '../lib/shared/page-roles.js';

const url = (path) => 'https://example.com' + path;

test('pageKeyOf drops the hash and the trailing slash so one page is one key', () => {
	assert.equal(pageKeyOf(url('/docs/')), pageKeyOf(url('/docs')));
	assert.equal(pageKeyOf(url('/docs#intro')), pageKeyOf(url('/docs')));
	assert.notEqual(pageKeyOf(url('/docs?v=2')), pageKeyOf(url('/docs')));
	assert.equal(pageKeyOf('about:blank'), '');
});

test('the role belongs to the pick: one page can hold both kinds', () => {
	const key = pageKeyOf(url('/page'));
	const picks = [
		{ id: 't1', pageKey: key, role: 'target' },
		{ id: 'r1', pageKey: key, role: 'reference' },
	];
	// 同一个页签上标的两处，一左一右：页面不再是角色的依据。
	assert.equal(pickRoleOf(picks[0]), 'target');
	assert.equal(pickRoleOf(picks[1]), 'reference');
	// 缺字段与脏值都按「要改这里」算，不把标注吞掉。
	assert.equal(pickRoleOf({ id: 'p2' }), 'target');
	assert.equal(pickRoleOf({ id: 'p3', role: 'nonsense' }), 'target');
	assert.equal(pickRoleOf(null), 'target');
});

test('reference labels follow the page order of the reference picks', () => {
	const picks = [
		{ id: 'r1', pageKey: pageKeyOf(url('/a')), role: 'reference' },
		{ id: 'r2', pageKey: pageKeyOf(url('/a')), role: 'reference' },
		{ id: 't1', pageKey: pageKeyOf(url('/page')), role: 'target' },
		{ id: 'r3', pageKey: pageKeyOf(url('/b')), role: 'reference' },
	];
	assert.equal(refLabelOf(picks, pageKeyOf(url('/a'))), 'R1');
	assert.equal(refLabelOf(picks, pageKeyOf(url('/b'))), 'R2');
	assert.equal(refLabelOf(picks, pageKeyOf(url('/page'))), '', '只有改动的页不占 R 号');
	assert.deepEqual(
		[...refLabelsOf(picks)],
		[
			[pageKeyOf(url('/a')), 'R1'],
			[pageKeyOf(url('/b')), 'R2'],
		],
	);
	// 把 /a 的两处参照都改成改动，编号必须重排而不是留空洞。
	picks[0].role = 'target';
	picks[1].role = 'target';
	assert.equal(refLabelOf(picks, pageKeyOf(url('/b'))), 'R1');
	assert.equal(refLabelOf(picks, pageKeyOf(url('/a'))), '');
});

test('pagePickCounts splits one page by role', () => {
	const key = pageKeyOf(url('/page'));
	const picks = [
		{ id: 't1', pageKey: key, role: 'target' },
		{ id: 't2', pageKey: key, role: 'target' },
		{ id: 'r1', pageKey: key, role: 'reference' },
	];
	assert.deepEqual(pagePickCounts(picks, key), { target: 2, reference: 1, total: 3, included: 3 });
	// included=false 是「已引用、下一轮默认不再带」的参照：总数要算它，插入数不算。
	picks.push({ id: 'r2', pageKey: key, role: 'reference', included: false });
	assert.deepEqual(pagePickCounts(picks, key), { target: 2, reference: 2, total: 4, included: 3 });
	assert.deepEqual(pagePickCounts(picks, pageKeyOf(url('/elsewhere'))), {
		reference: 0,
		target: 0,
		total: 0,
		included: 0,
	});
});

// HUD 的「复制提示词」不能是第三份自己拼的文案：host 把同一份 markdown 顺带下发，
// 页面只放进剪贴板，复制出去的内容与面板复制、工具输出逐字相同。
test('pageHudInfo carries the host prompt for the HUD copy button', () => {
	const page = url('/page');
	const info = pageHudInfo({ url: page, picks: [], prompt: '页面元素标注（0 处）' });
	assert.equal(info.prompt, '页面元素标注（0 处）');
	// 没传就空字符串，页面侧据此提示「还没有标注」，不会复制出 undefined。
	assert.equal(pageHudInfo({ url: page }).prompt, '');
	assert.equal(pageHudInfo({ url: page, prompt: null }).prompt, '');
});

// HUD 的「复制提示词」在一条标注都没有时必须是禁用的：host 的 prompt 在零标注时
// 也是非空串（annotation-markdown 的空态文案），所以判据只能是 pickCount。
test("pageHudInfo counts every pick, not just this page's", () => {
	const page = url('/page');
	const other = url('/other');
	assert.equal(pageHudInfo({ url: page, picks: [] }).pickCount, 0);
	const picks = [
		{ id: 'a', role: 'target', pageKey: pageKeyOf(page) },
		{ id: 'b', role: 'reference', pageKey: pageKeyOf(other) },
	];
	const info = pageHudInfo({ url: page, picks });
	// 本页只有 a，但复制提示词复制的是一条改动 + 一条参照：按钮得是可点的。
	assert.equal(info.count, 1);
	assert.equal(info.pickCount, 2);
	assert.equal(pageHudInfo({ url: page, picks: 'not-an-array' }).pickCount, 0);
});

test('pageHudInfo speaks for the landing, not for the page', () => {
	const page = url('/page');
	const picks = [{ id: 't1', role: 'target', pageKey: pageKeyOf(page) }];

	// 没设落点：点下去就是改动。
	const idle = pageHudInfo({ url: page, picks, mode: 'pick', specs: ['布局'] });
	assert.equal(idle.role, 'target');
	assert.equal(idle.landing, '');
	assert.equal(idle.count, 1);
	assert.deepEqual(idle.specs, ['布局']);
	assert.equal(idle.mode, 'pick');

	// 设了参照落点：即使这一页一处参照都还没有，HUD 也必须说「参考」，并预告编号。
	const armed = pageHudInfo({ url: page, picks, landing: 'reference', mode: 'pick' });
	assert.equal(armed.role, 'reference');
	assert.equal(armed.landing, 'reference');
	assert.equal(armed.refLabel, 'R1');
	assert.equal(armed.targetCount, 1);
	assert.equal(armed.referenceCount, 0);

	// 这一页已经有参照，就拿它自己的编号。
	const withRef = picks.concat([{ id: 'r1', role: 'reference', pageKey: pageKeyOf(url('/other')) }]);
	const second = pageHudInfo({ url: url('/next'), picks: withRef, landing: 'reference' });
	assert.equal(second.refLabel, 'R2');

	const targetLanding = pageHudInfo({ url: page, picks: withRef, landing: 'target' });
	assert.equal(targetLanding.role, 'target');
	assert.equal(targetLanding.refLabel, '', '改动落点不该带 R 号');
});

test('delegationSummary is deterministic and names the reference pages and dimensions', () => {
	const refs = [{ id: 'r1', role: 'reference', pageKey: pageKeyOf(url('/ref')), spec: ['布局', '配色'] }];
	const withTarget = refs.concat([{ id: 't1', role: 'target', pageKey: pageKeyOf(url('/page')), pageTitle: '列表页' }]);
	assert.equal(delegationSummary({ picks: withTarget }), '参照 R1 的布局、配色，改「列表页」上的改动标注。');
	assert.equal(delegationSummary({ picks: refs }), '按 R1 的布局、配色新建。');
	assert.equal(delegationSummary({ picks: [] }), '', '没有参照就没什么可汇总');
	assert.equal(
		delegationSummary({ picks: withTarget, activeTitle: '别的页' }),
		'参照 R1 的布局、配色，改「列表页」上的改动标注。',
	);
	// 没有携带标题的旧数据才回落到当前活动页。
	assert.equal(
		delegationSummary({ picks: refs.concat([{ id: 't1', role: 'target' }]), activeTitle: '列表页' }),
		'参照 R1 的布局、配色，改「列表页」上的改动标注。',
	);
	// 被取消勾选的参照不参与汇总。
	assert.equal(delegationSummary({ picks: [{ ...refs[0], included: false }] }), '');
});

test('targetTitleOf prefers the first target pick, then the active page', () => {
	assert.equal(targetTitleOf([{ id: 't1', role: 'target', pageTitle: '列表页' }], '活动页'), '列表页');
	assert.equal(targetTitleOf([{ id: 't1', role: 'target' }], '活动页'), '活动页');
	assert.equal(targetTitleOf([], ''), '');
});

test('normalizeSpec keeps known dimensions in canonical order', () => {
	assert.deepEqual(normalizeSpec(['配色', '布局', '布局', '不存在的']), ['布局', '配色']);
	assert.deepEqual(normalizeSpec(null), []);
});

test('an inserted reference is only a resend when it is checked again', () => {
	const pick = { id: 'p1', role: 'reference', included: true, referencedAt: 1 };
	assert.equal(isResend(pick), true);
	assert.equal(isResend({ ...pick, included: false }), false, '取消勾选后不该标重发');
	assert.equal(isResend({ id: 'p2', role: 'target', included: true, referencedAt: 1 }), false);
});

test('includedPicks is what an insert really sends', () => {
	const picks = [
		{ id: 't1', role: 'target' },
		{ id: 'r1', role: 'reference', included: false },
		{ id: 'r2', role: 'reference', included: true },
	];
	assert.deepEqual(
		includedPicks(picks, 'reference').map((pick) => pick.id),
		['r2'],
	);
	assert.deepEqual(
		includedPicks(picks, 'target').map((pick) => pick.id),
		['t1'],
	);
});

test('groupPicks keeps each side in list order', () => {
	const picks = [{ id: 'a', role: 'target' }, { id: 'b', role: 'reference' }, { id: 'c' }];
	const groups = groupPicks(picks);
	assert.deepEqual(
		groups.targets.map((pick) => pick.id),
		['a', 'c'],
	);
	assert.deepEqual(
		groups.references.map((pick) => pick.id),
		['b'],
	);
});

test('deleting a pick clears pairIds that pointed at it', () => {
	const picks = [
		{ id: 't1', role: 'target', pairId: 'r1' },
		{ id: 't2', role: 'target', pairId: 'r2' },
	];
	clearPairTo(picks, 'r1');
	assert.equal(picks[0].pairId, null, '指向被删参考的目标要解开，别留悬空 id');
	assert.equal(picks[1].pairId, 'r2', '别的配对不受影响');
	assert.deepEqual(clearPairTo(picks, ''), picks, '空 id 不动任何东西');
});

test('pairAllUnpaired spreads one reference over the targets still unpaired', () => {
	const picks = [
		{ id: 't1', role: 'target', pairId: 'r2' },
		{ id: 't2', role: 'target' },
		{ id: 't3', role: 'target' },
		{ id: 'r1', role: 'reference' },
	];
	const touched = pairAllUnpaired(picks, 'r1');
	assert.deepEqual(touched, ['t2', 't3']);
	assert.equal(picks[0].pairId, 'r2', '已经配对的不覆盖，那可能是用户特意挑的另一条参考');
	assert.deepEqual(pairAllUnpaired(picks, ''), [], '没给参考就不动');
});

test('one target can follow several references, and pairId always mirrors the first', () => {
	const picks = [
		{ id: 't1', role: 'target' },
		{ id: 'r1', role: 'reference' },
		{ id: 'r2', role: 'reference' },
	];
	assert.equal(pairTo(picks, 't1', 'r1'), true);
	assert.equal(pairTo(picks, 't1', 'r2'), true);
	assert.equal(pairTo(picks, 't1', 'r1'), false, '重复挂同一条参考不报错也不重复');
	assert.deepEqual(pairIdsOf(picks[0]), ['r1', 'r2']);
	assert.equal(picks[0].pairId, 'r1', 'pairId 是第一条，agent 契约只认这一个字段');

	assert.deepEqual(pairedTargetsOf(picks, 'r2'), ['t1']);
	assert.equal(unpair(picks, 't1', 'r1'), true);
	assert.deepEqual(pairIdsOf(picks[0]), ['r2'], '解开一条后 pairId 顺移到下一条');
	assert.equal(picks[0].pairId, 'r2');
	assert.equal(unpairAll(picks, 't1'), true);
	assert.deepEqual(pairIdsOf(picks[0]), []);
	assert.equal(picks[0].pairId, null);
	assert.equal(unpairAll(picks, 't1'), false, '已经空了就不算改动');
});

test('pairIdsOf tolerates old records that only carry pairId', () => {
	assert.deepEqual(pairIdsOf({ id: 't1', pairId: 'r1' }), ['r1']);
	assert.deepEqual(pairIdsOf({ id: 't1', pairId: null }), []);
	assert.deepEqual(pairIdsOf({ id: 't1', pairIds: ['r1', 'r1', ''], pairId: 'r2' }), ['r2', 'r1'], '去重且没有空 id');
	setPairIds({ id: 't1' }, ['r3']);
	assert.deepEqual(pairIdsOf({ id: 't1', pairIds: ['r3'], pairId: 'r3' }), ['r3']);
});

test('pairRows hands the panel every reference attached to one target', () => {
	const page = url('/page');
	const picks = [
		{ id: 't1', role: 'target', pageKey: pageKeyOf(page), pairIds: ['r1', 'r2'], pairId: 'r1' },
		{ id: 't2', role: 'target', pageKey: pageKeyOf(page) },
		{ id: 'r1', role: 'reference', pageKey: pageKeyOf(url('/a')) },
		{ id: 'r2', role: 'reference', pageKey: pageKeyOf(url('/b')) },
		{ id: 'r3', role: 'reference', pageKey: pageKeyOf(url('/c')) },
	];
	const rows = pairRows(picks);
	assert.equal(rows.length, 3, '两条目标 + 一条没人认领的参考');
	assert.deepEqual(
		rows[0].refs.map((ref) => ref.id),
		['r1', 'r2'],
	);
	assert.equal(rows[0].ref.id, 'r1', 'ref 保留第一条，兼容只读一条的调用方');
	assert.equal(rows[2].target, null);
	assert.equal(rows[2].ref.id, 'r3', '没配到任何改动的参考单独成行');
});
