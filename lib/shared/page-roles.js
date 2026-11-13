/**
 * Roles of pages and picks inside one annotation task.
 *
 * A task has at most one **target** page (the thing being changed) and up to five
 * **reference** pages (read-only specs: "make B look like A"). Picks inherit the
 * role of their page and a single pick can override it.
 *
 * Everything here is pure: session.js owns the mutable copy, the panel and the
 * agent tool read the same shapes, and all of it is unit-testable without a browser.
 */

/** Hard cap on reference pages; the 6th one is refused with a message. */
export const MAX_REFERENCE_PAGES = 5;

/** Reference dimensions a pick can carry (chips in the panel and the overlay). */
export const SPEC_DIMENSIONS = ['布局', '间距', '配色', '字号', '圆角', '交互', '文案'];

export const PAGE_ROLES = ['target', 'reference', 'neutral'];
export const PICK_ROLES = ['target', 'reference'];

/**
 * Stable key for "the same page". The hash is dropped (it is in-page navigation,
 * not a different page) and a trailing slash is ignored so /docs and /docs/ are
 * one reference page. Anything unparseable falls back to the trimmed URL.
 */
export function pageKeyOf(url) {
	const raw = String(url ?? '').trim();
	if (!raw || raw === 'about:blank') return '';
	try {
		const parsed = new URL(raw);
		parsed.hash = '';
		return (parsed.origin + parsed.pathname + parsed.search).replace(/\/$/, '') || raw;
	} catch {
		return raw.replace(/#.*$/, '').replace(/\/$/, '');
	}
}

/** Keep only known dimensions, de-duplicated, in the canonical order. */
export function normalizeSpec(spec) {
	const wanted = new Set((Array.isArray(spec) ? spec : []).map((item) => String(item)));
	return SPEC_DIMENSIONS.filter((dimension) => wanted.has(dimension));
}

/** One page record, no matter what the caller stored. */
function normalizePage(page) {
	const key = String(page?.key || pageKeyOf(page?.url) || '');
	const role = PAGE_ROLES.includes(page?.role) ? page.role : 'neutral';
	return {
		key,
		url: String(page?.url ?? ''),
		title: String(page?.title ?? ''),
		role,
		refIndex: role === 'reference' ? Math.max(0, Number(page?.refIndex) || 0) : 0,
		targetId: role === 'target' ? (page?.targetId ?? null) : null,
		fullShotPath: page?.fullShotPath ?? null,
	};
}

export function normalizePages(pages) {
	const list = (Array.isArray(pages) ? pages : []).map(normalizePage).filter((page) => page.key);
	// One key, one record: duplicates would render twice in the page strip.
	const seen = new Set();
	return list.filter((page) => (seen.has(page.key) ? false : (seen.add(page.key), true)));
}

export function findPage(pages, key) {
	const wanted = String(key ?? '');
	if (!wanted) return null;
	return (Array.isArray(pages) ? pages : []).find((page) => String(page?.key ?? '') === wanted) ?? null;
}

/** Page role for a key: 'target' | 'reference' | 'neutral' (unknown pages are neutral). */
export function pageRoleOf(pages, key) {
	const page = findPage(pages, key);
	return PAGE_ROLES.includes(page?.role) ? page.role : 'neutral';
}

/** R1..Rn for a reference page; '' when it is not one. */
export function refLabelOf(pages, key) {
	const page = findPage(pages, key);
	if (!page || page.role !== 'reference') return '';
	return 'R' + (Math.max(1, Number(page.refIndex) || 1) || 1);
}

/** Display name of a page: title first, host second, never empty. */
export function pageLabel(page) {
	const title = String(page?.title ?? '').trim();
	if (title) return title;
	try {
		return new URL(page?.url ?? '').host || String(page?.url ?? '');
	} catch {
		return String(page?.url ?? '');
	}
}

/** Roles stay contiguous (R1..Rn) after a removal, and non-references carry 0. */
function renumber(pages) {
	const refs = pages
		.filter((page) => page.role === 'reference')
		.sort((a, b) => (a.refIndex || 0) - (b.refIndex || 0) || a.key.localeCompare(b.key));
	refs.forEach((page, index) => (page.refIndex = index + 1));
	for (const page of pages) if (page.role !== 'reference') page.refIndex = 0;
	return pages;
}

/**
 * Set one page's role. Returns a new array; the caller decides what to do with
 * picks already recorded on that page.
 *
 * - target: the previous target drops to neutral (its picks survive, only the
 *   page role changes) — one task, one target.
 * - reference: refused past MAX_REFERENCE_PAGES.
 * - neutral: leaves the task without touching its picks.
 */
export function setPageRole(pages, input = {}) {
	const role = String(input?.role ?? '');
	if (!PAGE_ROLES.includes(role)) return { ok: false, error: 'bad-role', message: '页面角色只能是目标、参考或普通' };
	const key = String(input?.key || pageKeyOf(input?.url) || '');
	if (!key) return { ok: false, error: 'no-page', message: '这个页面还没有地址，无法设置角色' };

	const next = normalizePages(pages).map((page) => ({ ...page }));
	let page = next.find((item) => item.key === key);
	if (!page) {
		page = {
			key,
			url: String(input?.url ?? ''),
			title: String(input?.title ?? ''),
			role: 'neutral',
			refIndex: 0,
			targetId: null,
		};
		next.push(page);
	}
	if (input?.url) page.url = String(input.url);
	if (input?.title) page.title = String(input.title);

	let demoted = null;
	if (role === 'target') {
		const previous = next.find((item) => item.role === 'target' && item.key !== key);
		if (previous) {
			previous.role = 'neutral';
			previous.targetId = null;
			demoted = previous.key;
		}
		page.role = 'target';
		page.refIndex = 0;
		page.targetId = input?.targetId ?? page.targetId ?? null;
	} else if (role === 'reference') {
		const others = next.filter((item) => item.role === 'reference' && item.key !== key);
		if (others.length >= MAX_REFERENCE_PAGES)
			return { ok: false, error: 'max-reference', message: '最多 ' + MAX_REFERENCE_PAGES + ' 个参考页，先移除一个' };
		const highest = others.reduce((max, item) => Math.max(max, Number(item.refIndex) || 0), 0);
		page.role = 'reference';
		page.targetId = null;
		page.refIndex = Number(page.refIndex) || highest + 1;
	} else {
		page.role = 'neutral';
		page.refIndex = 0;
		page.targetId = null;
	}
	renumber(next);
	return { ok: true, error: null, pages: next, key, demoted };
}

/** The page a task is actually changing: the target page, else the active one. */
export function targetPageOf(pages) {
	return (Array.isArray(pages) ? pages : []).find((page) => page?.role === 'target') ?? null;
}

/**
 * Role of one pick. An explicit pick role wins (the user overrode the page);
 * otherwise the pick inherits its page, and a page with no role at all counts as
 * a target — annotating a page you never classified still means "change this".
 */
export function pickRoleOf(pick, pages) {
	if (PICK_ROLES.includes(pick?.role)) return pick.role;
	const role = pageRoleOf(pages, pick?.pageKey || pageKeyOf(pick?.url));
	return role === 'reference' ? 'reference' : 'target';
}

/** A reference pick that was inserted before and is checked again: this is a resend. */
export function isResend(pick) {
	return pickRoleOf(pick, []) === 'reference' && pick?.included === true && Boolean(pick?.referencedAt);
}

/** Split picks the way the panel renders them. Order inside each group is preserved. */
export function groupPicks(picks, pages) {
	const targets = [];
	const references = [];
	for (const pick of Array.isArray(picks) ? picks : []) {
		if (pickRoleOf(pick, pages) === 'reference') references.push(pick);
		else targets.push(pick);
	}
	return { targets, references };
}

/**
 * Rewrite the role of every page-inherited pick on a page whose role just
 * changed. Picks the user role-pinned one by one (roleSource='user') are left
 * alone — that is what the override is for.
 */
export function rewritePickRoles(picks, key, role) {
	let changed = 0;
	const next = (Array.isArray(picks) ? picks : []).map((pick) => {
		if (pick?.roleSource === 'user') return pick;
		if (String(pick?.pageKey ?? '') !== String(key ?? '')) return pick;
		if (!PICK_ROLES.includes(role) || pick.role === role) return pick;
		changed += 1;
		return {
			...pick,
			role,
			roleSource: 'page',
			referencedAt: role === 'reference' ? (pick.referencedAt ?? null) : null,
		};
	});
	return { picks: next, changed };
}

/** Included picks of one role, in list order — what an insert actually sends. */
export function includedPicks(picks, pages, role) {
	return (Array.isArray(picks) ? picks : []).filter(
		(pick) => pick?.included !== false && pickRoleOf(pick, pages) === role,
	);
}

/**
 * 参考对照的一行：左边要改的标注 + 右边配给它的参考标注。
 * 顺序按目标标注的创建顺序；没有任何目标认领的参考标注单独成行（左边为空），
 * 用来表达「照这个新建」。
 */
export function pairRows(picks, pages) {
	const list = Array.isArray(picks) ? picks : [];
	const { targets, references } = groupPicks(list, pages);
	const refById = new Map(references.map((pick) => [String(pick.id), pick]));
	const paired = new Set();
	const rows = targets.map((target) => {
		const pair = refById.get(String(target?.pairId ?? '')) ?? null;
		if (pair) paired.add(String(pair.id));
		return { target, ref: pair };
	});
	for (const ref of references) if (!paired.has(String(ref.id))) rows.push({ target: null, ref });
	return rows;
}

/** 新参考标注默认配给第一条还没配的目标标注：边标边配，不用再点一次。 */
export function firstUnpairedTarget(picks, pages) {
	const { targets } = groupPicks(picks, pages);
	return targets.find((pick) => !pick?.pairId) ?? null;
}

/**
 * 参考对照插入时真正发出去的行：有目标的行总是发；孤立参考行只在本次勾着时发
 * （插入过一次的参考会标成已引用，下一轮默认不再塞进对话）。
 */
export function insertableRows(rows) {
	return (Array.isArray(rows) ? rows : []).filter(
		(row) => row && (row.target || (row.ref && row.ref.included !== false)),
	);
}

/**
 * Deterministic delegation summary: no model call, no surprise. The panel shows
 * it before insert and the user may edit it; regenerating always reproduces this.
 */
export function delegationSummary({ pages, picks, activeTitle } = {}) {
	const list = Array.isArray(picks) ? picks : [];
	const refs = includedPicks(list, pages, 'reference');
	const targets = includedPicks(list, pages, 'target');
	if (!refs.length) return '';
	const labels = [];
	for (const pick of refs) {
		const label = refLabelOf(pages, pick.pageKey || pageKeyOf(pick.url)) || 'R';
		if (!labels.includes(label)) labels.push(label);
	}
	const dims = [];
	for (const pick of refs) for (const dim of normalizeSpec(pick.spec)) if (!dims.includes(dim)) dims.push(dim);
	const list_ = labels.join('、');
	const dimText = dims.length ? dims.join('、') : '写法';
	const target = targetPageOf(pages);
	const title = String(target?.title || activeTitle || '').trim();
	if (!targets.length) return '按 ' + list_ + ' 的' + dimText + '新建页面。';
	return '参考 ' + list_ + ' 的' + dimText + (title ? '，在目标页「' + title + '」上调整。' : '，在目标页上调整。');
}
