/**
 * 页面内 HUD「撤销/完成」的纯函数语义。session 与面板共用同一套判定，
 * 保证两侧行为一致，也便于不启动浏览器就单测（AGENTS.md：纯函数下沉 shared）。
 */

/**
 * 从列表尾部弹一条：返回 { remaining, removed }；空列表/非法输入返回 null（no-op）。
 * 不原地修改入参：调用方自行决定何时把 remaining 写回状态。
 */
export function popLastPick(picks) {
	if (!Array.isArray(picks) || picks.length === 0) return null;
	return { remaining: picks.slice(0, -1), removed: picks[picks.length - 1] };
}

/**
 * 「完成·插入」token：只在列表非空时单调递增，空列表是 no-op——
 * 否则面板会对一个没有内容的请求空转一轮。
 */
export function advancePendingConsume(current, picksLength) {
	return picksLength > 0 ? current + 1 : current;
}
