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
 * 标签属于哪个空间。默认空间的 context id 只有连上浏览器后才知道，所以
 * 未识别到（''）的标签一律算默认空间，避免早期 attach 的页面凭空消失。
 */
export function filterTabsBySpace(tabs, spaceId, defaultContextId) {
	const key = normalizeSpaceId(spaceId);
	const fallback = normalizeSpaceId(defaultContextId);
	return (tabs ?? []).filter((tab) => {
		const context = normalizeSpaceId(tab?.contextId);
		const owner = context || fallback;
		return key === '' ? owner === fallback : context === key;
	});
}
