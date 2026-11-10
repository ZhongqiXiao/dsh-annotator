/**
 * 「连别人已经开着调试端口的浏览器」所需的纯函数：从环境变量取出显式地址，
 * 再从 /json/version 的回复里校验 browser 级 WebSocket 端点。
 *
 * 只做字符串与 JSON 处理，不联网、不读环境变量的副作用（调用方传入 env），
 * 这样 host 侧可以薄委托，单测也能直接跑。
 *
 * 注意：这里**不自动探测**常见端口。插件自己的 profile 会留在临时目录里反复
 * 复用（见 lib/session.js 的 _tryAdopt），接管用户日常 Chrome 既没必要也危险：
 * 9222 上可能正是用户那扇带登录态的窗口。
 */

/**
 * 归一化成一个可拼 /json/version 的 base：补 http://、去掉尾部斜杠和路径。
 * 用户可能贴 `127.0.0.1:9222`、`http://127.0.0.1:9222/` 或整条
 * `http://127.0.0.1:9222/json/version`，都要能认。
 */
export function normalizeCdpBase(raw) {
	const text = String(raw ?? '').trim();
	if (!text) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : 'http://' + text;
	let parsed;
	try {
		parsed = new URL(withScheme);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	if (!parsed.hostname) return null;
	return parsed.protocol + '//' + parsed.host;
}

/**
 * 这次 launch 可以连接的「外部浏览器」候选：只有显式设置
 * `DSH_VISUAL_ANNOTATOR_CDP_URL` 才返回它，否则返回空数组（默认绝不接管
 * 用户日常窗口）。插件自己的实例不走这条路，而是按 profile 目录重连。
 */
export function externalCandidates(env = {}) {
	const explicit = normalizeCdpBase(env.DSH_VISUAL_ANNOTATOR_CDP_URL);
	return explicit ? [explicit] : [];
}

/**
 * 解析 `GET /json/version` 的正文，返回 browser 级 ws 地址。
 * 只接受指向 /devtools/browser/ 的 ws(s) 端点：别的服务也可能在这几个端口上
 * 回一段 JSON，不能因为「有 webSocketDebuggerUrl」就接管它。
 */
export function parseVersionReply(text, base = '') {
	let value;
	try {
		value = JSON.parse(String(text ?? ''));
	} catch {
		return null;
	}
	const ws = value?.webSocketDebuggerUrl;
	if (typeof ws !== 'string' || !/^wss?:\/\//i.test(ws)) return null;
	if (!/\/devtools\/browser\//.test(ws)) return null;
	// 端点主机必须是本机或与候选 base 同源，避免被一份伪造的版本回复带去别处。
	if (base) {
		try {
			const expected = new URL(base);
			const actual = new URL(ws);
			const loopback = (host) => host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
			if (!loopback(actual.hostname) && actual.hostname !== expected.hostname) return null;
		} catch {
			return null;
		}
	}
	return ws;
}
