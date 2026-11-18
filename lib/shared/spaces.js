/**
 * 调试空间（space）的纯逻辑：命名、选择与标签归属。
 *
 * 语义对齐 ego lite 的 task space —— 那边同样是 Chromium 的 BrowserContext
 * （`Target.createBrowserContext`），不是另开一个浏览器进程。所以这里只做
 * 「哪个 context 算哪个空间」的判定，进程与 CDP 连接仍由 session.js 管。
 */

export const DEFAULT_SPACE_NAME = '默认空间';

/**
 * 用户输入的名字 -> 可用的空间名。控制字符与连续空白先压平，超长截断；
 * 空串返回 null，让调用方回落到自动编号，而不是造出一个无名空间。
 */
export function sanitizeSpaceName(input, { max = 40 } = {}) {
	if (typeof input !== 'string') return null;
	const flat = input
		.replace(/[\u0000-\u001f\u007f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!flat) return null;
	return flat.length > max ? flat.slice(0, max).trim() : flat;
}

/** 「空间 2」「空间 3」……避开已占用的名字；没有冲突就不加后缀。 */
export function nextSpaceName(existing, prefix = '空间') {
	const used = new Set((existing ?? []).map((name) => String(name)));
	if (!used.has(prefix)) return prefix;
	for (let index = 2; index < 1000; index += 1) {
		const candidate = prefix + ' ' + index;
		if (!used.has(candidate)) return candidate;
	}
	return prefix + ' ' + Date.now();
}

/** 空串/undefined/null 都表示默认空间；其余按 context id 原样比较。 */
export function normalizeSpaceId(value) {
	if (value === undefined || value === null) return '';
	return String(value);
}

/**
 * 标签属于哪个空间。
 *
 * 判断口径：**凡是认不出来的 context，都算默认空间**。默认空间的 context id 是
 * 猜出来的——CDP 只保证 `createBrowserContext` 建的那些出现在
 * `Target.getBrowserContexts` 里，默认空间的那个 id 得从某个 target 上读，而
 * 一个真实 profile 里同时躺着好几个 context（扩展、内部页、不同窗口的页各不
 * 相同）。按 context 严格相等去过滤，猜错一次就会把用户眼前这一页从标签条里
 * 摘掉：页面还活着、HUD 还能点，面板却说「没有标签」。所以反向认定更稳：
 * 只有**明确属于某个已知空间**的标签才被排除在默认空间之外。
 */
export function filterTabsBySpace(tabs, spaceId, defaultContextId, knownSpaceIds = []) {
	const key = normalizeSpaceId(spaceId);
	const fallback = normalizeSpaceId(defaultContextId);
	const known = new Set((knownSpaceIds ?? []).map((value) => normalizeSpaceId(value)).filter(Boolean));
	return (tabs ?? []).filter((tab) => {
		const context = normalizeSpaceId(tab?.contextId);
		const isDefault = !context || context === fallback || !known.has(context);
		return key === '' ? isDefault : context === key;
	});
}

/**
 * 默认空间的 context id 该取哪一个。
 *
 * 优先级从「谁说算数」到「只能猜」：
 * 1. `authoritative`——新版 CDP 在 `Target.getBrowserContexts` 里直接给
 *    `defaultBrowserContextId`，这是浏览器自己说的，最可信；
 * 2. `activeContext`——用户眼前正在看的那一页所在的 context；
 * 3. `pageContexts`——任意一个页面 target 的 context；
 * 4. `targetContexts` 里第一个不属于已知空间的 context（老版本 CDP 的兜底）。
 *
 * 顺序反了就会出现「插件把扩展的 context 当成默认空间」，面板标签条随后一条
 * 都显示不出来（见 `filterTabsBySpace` 的说明）。
 */
export function pickDefaultContextId({
	authoritative,
	activeContext,
	pageContexts,
	targetContexts,
	knownContexts,
} = {}) {
	const known = new Set((knownContexts ?? []).map((value) => normalizeSpaceId(value)).filter(Boolean));
	const authoritativeId = normalizeSpaceId(authoritative);
	if (authoritativeId) return authoritativeId;
	const active = normalizeSpaceId(activeContext);
	if (active && !known.has(active)) return active;
	const page = (pageContexts ?? []).map((value) => normalizeSpaceId(value)).find((id) => id && !known.has(id));
	if (page) return page;
	const anyTarget = (targetContexts ?? []).map((value) => normalizeSpaceId(value)).find((id) => id && !known.has(id));
	return anyTarget ?? '';
}
