/**
 * 自动进入标注模式的纯函数判定：host 侧只喂 trigger + 状态，不在 session 里写分支。
 */

const AUTO_PICK_TRIGGERS = new Set(['launch', 'open-page']);

/**
 * trigger:
 * - launch: 浏览器启动成功
 * - open-page: 打开网页 / 切页 / 切空间
 * - user-on / user-off: 用户显式开关（用于统一判定与单测）
 */
export function decideAutoPick(trigger, state = {}) {
	const autoPickEnabled = state?.autoPickEnabled !== false;
	const userTurnedOff = state?.userTurnedOff === true;
	if (!autoPickEnabled) return 'off';
	if (trigger === 'user-off') return 'off';
	if (trigger === 'user-on') return 'pick';
	if (AUTO_PICK_TRIGGERS.has(trigger)) return userTurnedOff ? 'off' : 'pick';
	return 'off';
}

/** 用户手动关掉要粘住；手动再打开则恢复自动。 */
export function nextUserTurnedOff(trigger, current = false) {
	if (trigger === 'user-off') return true;
	if (trigger === 'user-on') return false;
	return current === true;
}
