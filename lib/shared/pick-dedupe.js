/**
 * 同一次提交的重复投递去重。
 *
 * 页面脚本一次提交只应发一份，但同一页面里可能同时活着两份注入脚本（旧版残留、
 * 换浏览器后重新注入没清理），同一次点击就会投递多次，列表里成了「三条一模一样
 * 的标注」。这里只按「同一元素 + 同一序号 + 同一位置 + 同一备注 + 同一地址」判重，
 * 且只在一个短窗口内生效——用户真的又点了一次同一个元素、写了同样的备注，过了
 * 窗口就应当照常记录。
 */

/** 去重窗口：同一份投递通常在同一个 tick 内到达，1.5s 足够覆盖重传抖动。 */
export const PICK_DEDUPE_WINDOW_MS = 1500;

/** 把一次投递压成可比对的签名；缺字段一律归一成空串，避免 undefined 参与比较。 */
export function pickSignature(payload, fallbackUrl = '') {
	const url = payload?.url ?? fallbackUrl ?? '';
	const rect = payload?.rect ?? {};
	return [url, payload?.selector ?? '', payload?.seq ?? '', rect.x, rect.y, payload?.comment ?? ''].join('|');
}

/** 上一次签名的记录（session 里保存 lastPickSignature / lastPickAt）。 */
export function isDuplicatePick(previous, signature, now, windowMs = PICK_DEDUPE_WINDOW_MS) {
	if (!previous || typeof previous.signature !== 'string') return false;
	if (previous.signature !== signature) return false;
	return now - (previous.at ?? 0) < windowMs;
}
