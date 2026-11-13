import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearPairTo,
	delegationSummary,
	includedPicks,
	isResend,
	MAX_REFERENCE_PAGES,
	normalizeSpec,
	pageKeyOf,
	pageRoleOf,
	pairAllUnpaired,
	pickRoleOf,
	refLabelOf,
	rewritePickRoles,
	setPageRole,
	targetPageOf,
} from '../lib/shared/page-roles.js';

const url = (path) => 'https://example.com' + path;

test('pageKeyOf drops the hash and the trailing slash so one page is one key', () => {
	assert.equal(pageKeyOf(url('/docs/')), pageKeyOf(url('/docs')));
	assert.equal(pageKeyOf(url('/docs#intro')), pageKeyOf(url('/docs')));
	assert.notEqual(pageKeyOf(url('/docs?v=2')), pageKeyOf(url('/docs')));
	assert.equal(pageKeyOf('about:blank'), '');
});

test('setPageRole keeps at most one target and demotes the old one', () => {
	const first = setPageRole([], { url: url('/a'), role: 'target' });
	assert.equal(first.ok, true);
	const second = setPageRole(first.pages, { url: url('/b'), role: 'target' });
	assert.equal(second.ok, true);
	assert.equal(second.demoted, pageKeyOf(url('/a')));
	assert.equal(pageRoleOf(second.pages, pageKeyOf(url('/a'))), 'neutral');
	assert.equal(pageRoleOf(second.pages, pageKeyOf(url('/b'))), 'target');
	assert.equal(targetPageOf(second.pages).key, pageKeyOf(url('/b')));
});

test('reference pages are numbered R1..Rn and capped', () => {
	let pages = [];
	for (let i = 0; i < MAX_REFERENCE_PAGES; i++) {
		const result = setPageRole(pages, { url: url('/ref' + i), role: 'reference' });
		assert.equal(result.ok, true);
		pages = result.pages;
	}
	assert.deepEqual(
		pages.map((page) => refLabelOf(pages, page.key)),
		['R1', 'R2', 'R3', 'R4', 'R5'],
	);
	const overflow = setPageRole(pages, { url: url('/ref-overflow'), role: 'reference' });
	assert.equal(overflow.ok, false);
	assert.equal(overflow.error, 'max-reference');
	assert.match(overflow.message, /最多/);
});

test('removing a reference renumbers the rest so labels never skip', () => {
	let pages = setPageRole([], { url: url('/a'), role: 'reference' }).pages;
	pages = setPageRole(pages, { url: url('/b'), role: 'reference' }).pages;
	pages = setPageRole(pages, { url: url('/c'), role: 'reference' }).pages;
	pages = setPageRole(pages, { url: url('/b'), role: 'neutral' }).pages;
	assert.equal(refLabelOf(pages, pageKeyOf(url('/a'))), 'R1');
	assert.equal(refLabelOf(pages, pageKeyOf(url('/c'))), 'R2');
	assert.equal(refLabelOf(pages, pageKeyOf(url('/b'))), '');
});

test('a pick inherits its page role, and an explicit pick role wins', () => {
	const pages = setPageRole([], { url: url('/ref'), role: 'reference' }).pages;
	const inherited = { id: 'p1', url: url('/ref'), pageKey: pageKeyOf(url('/ref')) };
	assert.equal(pickRoleOf(inherited, pages), 'reference');
	assert.equal(pickRoleOf({ ...inherited, role: 'target' }, pages), 'target');
	// 未分类的页面按目标算：在一页上标了东西，默认就是要改它。
	assert.equal(pickRoleOf({ id: 'p2', url: url('/plain') }, pages), 'target');
});

test('rewritePickRoles ignores picks the user pinned by hand', () => {
	const key = pageKeyOf(url('/ref'));
	const picks = [
		{ id: 'p1', pageKey: key, role: 'target', roleSource: 'page' },
		{ id: 'p2', pageKey: key, role: 'target', roleSource: 'user' },
		{ id: 'p3', pageKey: pageKeyOf(url('/other')), role: 'target', roleSource: 'page' },
	];
	const result = rewritePickRoles(picks, key, 'reference');
	assert.equal(result.changed, 1);
	assert.equal(result.picks[0].role, 'reference');
	assert.equal(result.picks[1].role, 'target');
	assert.equal(result.picks[2].role, 'target');
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
		includedPicks(picks, [], 'reference').map((pick) => pick.id),
		['r2'],
	);
	assert.deepEqual(
		includedPicks(picks, [], 'target').map((pick) => pick.id),
		['t1'],
	);
});

test('delegationSummary is deterministic and names the reference pages and dimensions', () => {
	const pages = [...setPageRole([], { url: url('/ref'), title: '设计稿', role: 'reference' }).pages, ...[]];
	const withTarget = setPageRole(pages, { url: url('/page'), title: '列表页', role: 'target' }).pages;
	// 「有没有目标」看的是本次包含的目标标注，不只是页面上挂着 target 角色。
	const refsOnly = [{ id: 'p1', role: 'reference', pageKey: pageKeyOf(url('/ref')), spec: ['布局', '配色'] }];
	const withTargetPick = refsOnly.concat([{ id: 't1', role: 'target', pageKey: pageKeyOf(url('/page')) }]);
	assert.equal(
		delegationSummary({ pages: withTarget, picks: withTargetPick }),
		'参考 R1 的布局、配色，在目标页「列表页」上调整。',
	);
	assert.equal(delegationSummary({ pages, picks: refsOnly }), '按 R1 的布局、配色新建页面。');
	assert.equal(delegationSummary({ pages: withTarget, picks: [] }), '');
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
	const page = url('/page');
	const pages = setPageRole([], { url: page, title: '列表页', role: 'target' }).pages;
	const picks = [
		{ id: 't1', role: 'target', pageKey: pageKeyOf(page), pairId: 'r2' },
		{ id: 't2', role: 'target', pageKey: pageKeyOf(page) },
		{ id: 't3', role: 'target', pageKey: pageKeyOf(page) },
		{ id: 'r1', role: 'reference', pageKey: pageKeyOf(url('/ref')) },
	];
	const touched = pairAllUnpaired(picks, pages, 'r1');
	assert.deepEqual(touched, ['t2', 't3']);
	assert.equal(picks[0].pairId, 'r2', '已经配对的不覆盖，那可能是用户特意挑的另一条参考');
	assert.deepEqual(pairAllUnpaired(picks, pages, ''), [], '没给参考就不动');
});
