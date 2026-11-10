/**
 * 面板标签条与浏览器真实标签的合并规则。纯函数：host 侧的事件循环、/state 轮询与
 * 单测共用同一套判断，避免「事件里一套、轮询里一套」对不上。
 */
import { normalizeSpaceId } from './spaces.js';

/**
 * 把一条 CDP targetInfo 合并进 tabs（就地更新，不打乱顺序）。
 *
 * - 新 target：追加到末尾。
 * - 已存在：原地更新。地址变了就认新标题（此刻可能还是空串，随后目标页加载完会补），
 *   地址没变而这次没带标题时保留旧标题——Chrome 的 targetInfoChanged 经常只带
 *   url，直接覆盖会把已知标题擦成空，面板就退回显示 URL 了。
 * - contextId 缺失时沿用旧值，别把一个已知空间的页误判回默认空间。
 */
export function mergeTab(tabs, info) {
	const list = tabs ?? [];
	const targetId = info?.targetId;
	if (!targetId) return list;
	const url = info.url ?? '';
	const contextId = normalizeSpaceId(info.browserContextId);
	const index = list.findIndex((tab) => tab.targetId === targetId);
	if (index < 0) {
		list.push({ targetId, url, title: info.title ?? '', contextId });
		return list;
	}
	const prev = list[index];
	const sameUrl = prev.url === url;
	list[index] = {
		targetId,
		url,
		title: sameUrl ? info.title || prev.title : (info.title ?? ''),
		contextId: contextId || prev.contextId,
	};
	return list;
}

/** 标签条直接给几枚，剩下的收进「更多」。 */
export const TAB_LIMIT = 10;

/** 面板按这个窗口切分：前 10 枚平铺，其余进弹层。 */
export function splitTabs(tabs, limit = TAB_LIMIT) {
	const list = tabs ?? [];
	return { visible: list.slice(0, limit), extra: list.slice(limit) };
}
