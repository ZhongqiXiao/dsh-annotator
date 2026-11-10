/**
 * 地址栏的归一化：面板里的输入框是「地址」，但用户习惯像浏览器地址栏那样只敲域名。
 * Chromium 的 Target.createTarget 拿到没有协议的 "gitee.com" 会开一页 about:blank，
 * 所以在交给 CDP 之前统一补协议。纯函数，便于单测。
 */

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s;
/** 本机开发服务器基本都是 http，别把 localhost:5173 硬升成 https。 */
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

/**
 * 把用户敲的地址补成可打开的 URL。
 *
 * - 空串返回 ''（调用方保持当前页不动）。
 * - 已带协议（http:、https:、file:、chrome:、about:…）原样返回。
 * - 以 // 开头补 https:。
 * - localhost / 127.0.0.1 / [::1] 补 http:。
 * - 含空格的当搜索词，交给默认搜索引擎（和地址栏一致），而不是开一页空白。
 * - 其余当域名补 https:。
 */
export function normalizeAddress(input) {
	const raw = String(input ?? '').trim();
	if (!raw) return '';
	if (raw === 'about:blank') return raw;
	const matched = SCHEME.exec(raw);
	// "localhost:5173" 长得也像 "协议:值"，只有冒号后面不是纯端口才算协议；
	// 否则把本地调试地址当成 localhost 协议，浏览器同样开不出页面。
	if (matched && !/^\d+(?:[/?#].*)?$/.test(matched[2])) return raw;
	if (raw.startsWith('//')) return 'https:' + raw;
	if (LOOPBACK.test(raw)) return 'http://' + raw;
	if (/\s/.test(raw)) return 'https://www.bing.com/search?q=' + encodeURIComponent(raw);
	return 'https://' + raw;
}
