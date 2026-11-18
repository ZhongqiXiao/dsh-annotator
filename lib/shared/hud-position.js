/**
 * HUD 位置：用户把 HUD 拖到哪儿，就记在哪儿。
 *
 * 这里只有两个纯函数，因为同一份逻辑要跑在三个地方：页面注入脚本（拖拽计算）、
 * 面板单元测试、以及「窗口缩小后把 HUD 拉回可见区」。逻辑写两份必然漂移——
 * 页面里那份算对的边界，测试里那份算错，测试就成了自我安慰。
 *
 * 注入脚本不能 import，所以 lib/overlay.js 把这两个函数的源码字符串嵌进载荷
 * （`${clampHudPosition.toString()}`）；改这里就同时改了页面里的实现。
 */

/**
 * 把 HUD 的左上角钳进视口：留 `margin` 的呼吸位，永远不把整块拖出屏幕外
 * ——丢出去的 HUD 用户再也点不到，只能刷新页面。
 *
 * 视口尺寸未知（0/NaN）时原样返回：宁可位置不动，也不要把用户存下来的坐标清零。
 */
export function clampHudPosition(pos, bounds) {
	const p = pos || {};
	const b = bounds || {};
	const rawMargin = Number(b.margin);
	const margin = Number.isFinite(rawMargin) && rawMargin >= 0 ? rawMargin : 8;
	const viewportWidth = Number(b.viewportWidth) || 0;
	const viewportHeight = Number(b.viewportHeight) || 0;
	const width = Number(p.width) || 0;
	const height = Number(p.height) || 0;
	const axis = (value, size, viewport) => {
		const v = Number(value) || 0;
		if (!(viewport > 0)) return v;
		const max = viewport - size - margin;
		// 视口比 HUD 还窄：贴住左上留白，至少左上角与拖拽把手还能点到。
		if (max < margin) return margin;
		return Math.min(Math.max(v, margin), max);
	};
	return { x: axis(p.x, width, viewportWidth), y: axis(p.y, height, viewportHeight) };
}

/** 读回 localStorage 里的位置：坏数据一律当没存过，绝不让 NaN 把 HUD 送进左上角。 */
export function parseHudPosition(raw) {
	if (typeof raw !== 'string' || !raw) return null;
	let data = null;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!data || typeof data !== 'object') return null;
	const x = Number(data.x);
	const y = Number(data.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return { x, y };
}
