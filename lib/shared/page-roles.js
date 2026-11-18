/**
 * Roles of picks inside one annotation task.
 *
 * A pick is either a **target** ("change this") or a **reference** ("make it look
 * like this"). The role belongs to the pick, not to the page: the same page can
 * hold both kinds, and a reference does not have to come from another tab. Pages
 * are only provenance — where a pick came from, so the agent knows which page it
 * may edit and which one it must leave alone.
 *
 * Everything here is pure: session.js owns the mutable copy, the panel and the
 * agent tool read the same shapes, and all of it is unit-testable without a browser.
 */

/** Reference dimensions a pick can carry (chips in the panel and the overlay). */
export const SPEC_DIMENSIONS = ['布局', '间距', '配色', '字体', '字号', '圆角', '交互', '文案'];

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

/** One page record, no matter what the caller stored. Role is deliberately absent. */
function normalizePage(page) {
	return {
		key: String(page?.key || pageKeyOf(page?.url) || ''),
		url: String(page?.url ?? ''),
		title: String(page?.title ?? ''),
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

/** Role of one pick: the only authority. Unknown values mean "change this". */
export function pickRoleOf(pick) {
	return PICK_ROLES.includes(pick?.role) ? pick.role : 'target';
}

/**
 * R1..Rn, one label per page that carries at least one reference pick.
 *
 * Numbering follows the order those pages first appear in the pick list (i.e. the
 * order the user annotated them), so it is stable while they work and never
 * depends on a page-role table that could disagree with the picks themselves.
 */
export function refLabelsOf(picks) {
	const labels = new Map();
	for (const pick of Array.isArray(picks) ? picks : []) {
		if (pickRoleOf(pick) !== 'reference') continue;
		const key = pick?.pageKey || pageKeyOf(pick?.url);
		if (!key || labels.has(key)) continue;
		labels.set(key, 'R' + (labels.size + 1));
	}
	return labels;
}

/** R-number of one page; '' when that page holds no reference pick. */
export function refLabelOf(picks, key) {
	const wanted = String(key ?? '');
	if (!wanted) return '';
	return refLabelsOf(picks).get(wanted) ?? '';
}

/**
 * How many picks one page holds, split by role.
 *
 * `included` counts the picks that would go into the next insert (`included !== false`),
 * so this is the one place both the HUD ("本页标注 N 处") and the panel's tab strip get
 * their numbers: two hand-rolled tallies used to drift apart.
 */
export function pagePickCounts(picks, key) {
	const wanted = String(key ?? '');
	const counts = { target: 0, reference: 0, total: 0, included: 0 };
	for (const pick of Array.isArray(picks) ? picks : []) {
		if (!wanted || (pick?.pageKey || pageKeyOf(pick?.url)) !== wanted) continue;
		counts[pickRoleOf(pick)] += 1;
		counts.total += 1;
		if (pick.included !== false) counts.included += 1;
	}
	return counts;
}

/**
 * HUD payload for one tab: mode, this page's counts, and what the next pick will be.
 *
 * The role is the **landing** (the column the user last armed), not the page's
 * majority: the HUD must describe what happens if they click now. Without a
 * landing the next pick is a target, so that is what it says.
 *
 * The URL must be the tab's own, never the active page's: a background tab is
 * exactly the case this feature lives on, and pushing the active page's numbers
 * would show one tab's count in another tab's HUD.
 *
 * `prompt` is the same markdown the panel copies and the agent tool returns, so the
 * HUD's 「复制提示词」 hands out an identical prompt instead of a third paraphrase.
 */
export function pageHudInfo({
	url = '',
	picks = [],
	landing = null,
	mode = 'off',
	specs = SPEC_DIMENSIONS,
	prompt = '',
} = {}) {
	const key = pageKeyOf(url);
	const list = Array.isArray(picks) ? picks : [];
	const counts = pagePickCounts(list, key);
	const role = PICK_ROLES.includes(landing) ? landing : 'target';
	const labels = refLabelsOf(list);
	let refLabel = '';
	if (role === 'reference') refLabel = (key && labels.get(key)) || 'R' + (labels.size + 1);
	return {
		mode: mode ?? 'off',
		count: counts.total,
		targetCount: counts.target,
		referenceCount: counts.reference,
		role,
		landing: PICK_ROLES.includes(landing) ? landing : '',
		refLabel,
		specs: Array.isArray(specs) ? specs : SPEC_DIMENSIONS,
		prompt: String(prompt ?? ''),
	};
}

/** A reference pick that was inserted before and is checked again: this is a resend. */
export function isResend(pick) {
	return pickRoleOf(pick) === 'reference' && pick?.included === true && Boolean(pick?.referencedAt);
}

/** Split picks the way the panel renders them. Order inside each group is preserved. */
export function groupPicks(picks) {
	const targets = [];
	const references = [];
	for (const pick of Array.isArray(picks) ? picks : []) {
		if (pickRoleOf(pick) === 'reference') references.push(pick);
		else targets.push(pick);
	}
	return { targets, references };
}

/** Included picks of one role, in list order — what an insert actually sends. */
export function includedPicks(picks, role) {
	return (Array.isArray(picks) ? picks : []).filter((pick) => pick?.included !== false && pickRoleOf(pick) === role);
}

/** Title of the page the targets came from: first target pick wins, else the active page. */
export function targetTitleOf(picks, activeTitle = '') {
	const { targets } = groupPicks(picks);
	const first = targets[0];
	const own = String(first?.pageTitle ?? '').trim();
	return own || String(activeTitle ?? '').trim();
}

/**
 * 一条目标标注配了哪些参考标注。
 *
 * pairIds 是权威列表（改一处可以同时参照多处：左栏模式取自 A、圆角取自 B），
 * pairId 始终是它的第一条——agent 工具契约和旧数据只认这一个字段，两个字段
 * 不能各说各话，所以读写都走这里。
 */
export function pairIdsOf(pick) {
	const listed = Array.isArray(pick?.pairIds) ? pick.pairIds : [];
	const ids = [];
	for (const raw of listed) {
		const id = String(raw ?? '');
		if (id && !ids.includes(id)) ids.push(id);
	}
	const first = String(pick?.pairId ?? '');
	if (first && !ids.includes(first)) ids.unshift(first);
	return ids;
}

/** 原地写回：pairIds 与 pairId 一起更新，空列表时 pairId 归 null。 */
export function setPairIds(pick, ids) {
	const next = [];
	for (const raw of Array.isArray(ids) ? ids : []) {
		const id = String(raw ?? '');
		if (id && !next.includes(id)) next.push(id);
	}
	pick.pairIds = next;
	pick.pairId = next[0] ?? null;
	return pick;
}

/**
 * 参考对照的一行：左边要改的标注 + 右边配给它的参考标注（可以有多条）。
 * 顺序按目标标注的创建顺序；没有任何目标认领的参考标注单独成行（左边为空），
 * 用来表达「这些参考还没说清照着改哪儿」。
 */
export function pairRows(picks) {
	const list = Array.isArray(picks) ? picks : [];
	const { targets, references } = groupPicks(list);
	const refById = new Map(references.map((pick) => [String(pick.id), pick]));
	const paired = new Set();
	const rows = targets.map((target) => {
		const refs = pairIdsOf(target)
			.map((id) => refById.get(id))
			.filter(Boolean);
		for (const ref of refs) paired.add(String(ref.id));
		return { target, refs, ref: refs[0] ?? null };
	});
	for (const ref of references) if (!paired.has(String(ref.id))) rows.push({ target: null, refs: [], ref });
	return rows;
}

/** 新参考标注默认配给第一条还没配的目标标注：边标边配，不用再点一次。 */
export function firstUnpairedTarget(picks) {
	const { targets } = groupPicks(picks);
	return targets.find((pick) => pairIdsOf(pick).length === 0) ?? null;
}

/** 把一条参考挂到一条目标上；已经挂着就不重复加。返回是否真的变了。 */
export function pairTo(picks, targetId, refId) {
	const wanted = String(refId ?? '');
	const target = (Array.isArray(picks) ? picks : []).find((pick) => String(pick?.id ?? '') === String(targetId ?? ''));
	if (!target || !wanted) return false;
	const ids = pairIdsOf(target);
	if (ids.includes(wanted)) return false;
	setPairIds(target, [...ids, wanted]);
	return true;
}

/** 解开一条目标上的某一条参考（右侧小 ×）；返回是否真的变了。 */
export function unpair(picks, targetId, refId) {
	const wanted = String(refId ?? '');
	const target = (Array.isArray(picks) ? picks : []).find((pick) => String(pick?.id ?? '') === String(targetId ?? ''));
	if (!target) return false;
	const ids = pairIdsOf(target);
	if (!ids.includes(wanted)) return false;
	setPairIds(
		target,
		ids.filter((id) => id !== wanted),
	);
	return true;
}

/** 一条目标上的参考全部解开。 */
export function unpairAll(picks, targetId) {
	const target = (Array.isArray(picks) ? picks : []).find((pick) => String(pick?.id ?? '') === String(targetId ?? ''));
	if (!target || !pairIdsOf(target).length) return false;
	setPairIds(target, []);
	return true;
}

/** 哪些目标标注在参照这一条参考（工具输出与 markdown 都要按这个反查）。 */
export function pairedTargetsOf(picks, refId) {
	const wanted = String(refId ?? '');
	if (!wanted) return [];
	return (Array.isArray(picks) ? picks : [])
		.filter((pick) => pairIdsOf(pick).includes(wanted))
		.map((pick) => String(pick.id));
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
 * 删除一条标注时，把指向它的配对一并解开。留一个指向已不存在标注的 pairId，
 * 面板渲染时查不到就当没配对，看不出问题；但 agent 会读到「配给 #7」而 #7 早已不在列表里。
 */
export function clearPairTo(picks, id) {
	const wanted = String(id ?? '');
	const list = Array.isArray(picks) ? picks : [];
	if (!wanted) return list;
	for (const pick of list) {
		if (!pick) continue;
		const ids = pairIdsOf(pick);
		if (ids.includes(wanted))
			setPairIds(
				pick,
				ids.filter((each) => each !== wanted),
			);
	}
	return list;
}

/** 把一条参考套用到所有还没配对的目标：返回真正改动到的目标 id。 */
export function pairAllUnpaired(picks, refId) {
	const wanted = String(refId ?? '');
	const touched = [];
	if (!wanted) return touched;
	const { targets } = groupPicks(picks);
	for (const target of targets) {
		if (!target) continue;
		if (pairIdsOf(target).length) continue;
		setPairIds(target, [wanted]);
		touched.push(String(target.id));
	}
	return touched;
}

/**
 * Deterministic delegation summary: no model call, no surprise. The panel shows
 * it before insert and the user may edit it; regenerating always reproduces this.
 */
export function delegationSummary({ picks, activeTitle } = {}) {
	const list = Array.isArray(picks) ? picks : [];
	const refs = includedPicks(list, 'reference');
	const targets = includedPicks(list, 'target');
	if (!refs.length) return '';
	const labels = [];
	for (const pick of refs) {
		const label = refLabelsOf(list).get(pick.pageKey || pageKeyOf(pick.url)) || 'R';
		if (!labels.includes(label)) labels.push(label);
	}
	const dims = [];
	for (const pick of refs) for (const dim of normalizeSpec(pick.spec)) if (!dims.includes(dim)) dims.push(dim);
	const listText = labels.join('、');
	const dimText = dims.length ? dims.join('、') : '写法';
	const title = targetTitleOf(list, activeTitle);
	if (!targets.length) return '按 ' + listText + ' 的' + dimText + '新建。';
	// 页面只是出处：有改动就点名那几处要改，不再假装有一个「目标页」这个角色。
	return (
		'参照 ' + listText + ' 的' + dimText + (title ? '，改「' + title + '」上的改动标注。' : '，改下面列出的改动标注。')
	);
}
