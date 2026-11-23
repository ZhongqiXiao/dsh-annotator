/**
 * ego lite 专属的几件小事，都做成纯函数方便单测：
 *
 * 1. 新手引导窗口：全新 profile 启动后它会开一个 `browser_ui:chrome://onboarding/`
 *    目标（标题「欢迎使用 ego(𝘭𝘪𝘵𝘦)」），整窗铺满、点不动也读不到，用户就「卡在
 *    欢迎界面」。ego 自己的开关是 `<profile>/ego_config.json` 里的 `not_first_run`：
 *    启动前写进去，它压根不弹这一扇。**不要用 `Target.closeTarget` 去关**——实测
 *    ego lite 0.6.3.14 上这一关会连带退出整个浏览器（哪怕已经有一个 page 窗口并
 *    激活），下一次 launch 又弹一次，于是每次开都停在欢迎页。
 * 2. 复用用户已经开着的 ego lite：它的 CDP 端口是随机分配的（`--remote-debugging-port=0`
 *    的语义），没有端口文件可读，只能从进程的监听端口里找，于是把
 *    `lsof -nP -iTCP -sTCP:LISTEN` 的整表解析成 pid → 端口（沙箱里按 pid 查会被拒）。
 */

/** ego lite 引导窗口的 URL；只按前缀匹配，避免版本间加 query。 */
export const EGO_ONBOARDING_URL = 'chrome://onboarding/';

/** ego lite 放在 user-data-dir 根部的首启开关文件名。 */
export const EGO_CONFIG_FILE = 'ego_config.json';

/** 这个 CDP target 是不是 ego 的新手引导窗口。 */
export function isEgoOnboardingTarget(target = {}) {
	const url = String(target?.url ?? '');
	if (!url.startsWith(EGO_ONBOARDING_URL)) return false;
	const type = String(target?.type ?? '');
	return type === '' || type === 'browser_ui' || type === 'page';
}

/**
 * 这份 `ego_config.json` 是否已经标记过「非首次运行」。
 * ego 只认 true（缺字段、false、写坏都算首次），所以这里必须严格等于 true。
 */
export function isEgoFirstRunDone(config) {
	return config?.not_first_run === true;
}

/**
 * 得到一份「已标记非首次运行」的配置：保留 ego 自己写的其它键
 * （如 `uninstalled_agent_skill_links_removed`），只补上 not_first_run。
 */
export function withEgoFirstRunDone(config) {
	const base = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
	return { ...base, not_first_run: true };
}

/**
 * 这条命令行是不是 ego lite 的浏览器主进程（不是 renderer/helper 子进程）。
 * macOS 是 `.../Contents/MacOS/ego lite`，Linux 可能是 `/opt/ego lite/ego lite`，
 * Windows 是 `ego lite.exe`；`--type=` 开头的那种一律是子进程，跳过。
 */
export function isEgoBrowserCommand(command) {
	const text = String(command ?? '');
	if (!text || text.includes('--type=')) return false;
	if (text.includes('/Contents/MacOS/ego lite')) return true;
	return /(^|[\\/\s])ego lite(\.exe)?(\s|$)/i.test(text);
}

/**
 * 解析 `lsof -nP -F -iTCP -sTCP:LISTEN` 的字段输出，得到 pid → 监听端口。
 *
 * 为什么用整表而不是 `lsof -p <pid>`：宿主沙箱里按 pid 查进程详情会被拒
 * （EPERM），整表查询却是允许的；`ps` 同样被拒，所以进程列表改用 `pgrep`。
 * 为什么用 `-F` 而不是默认表格：ego 的进程名是「ego lite」，带空格，按列切
 * 会把命令名拆成两段、pid 错位；字段输出用 p/n 前缀，pid 与地址不会错位。
 * 地址取 `:端口`（IPv4 是 127.0.0.1:49265，IPv6 是 [::1]:62122，监听全部是 *:3999）。
 */
export function listeningPortsByPid(fieldOutput) {
	const out = new Map();
	let pid = 0;
	for (const raw of String(fieldOutput ?? '').split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith('p')) {
			const value = Number(line.slice(1));
			pid = Number.isInteger(value) && value > 0 ? value : 0;
			if (pid && !out.has(pid)) out.set(pid, []);
			continue;
		}
		if (!pid || !line.startsWith('n')) continue; // 只关心地址字段，别的字段跳过
		const match = /:(\d{2,5})\b/.exec(line.slice(1));
		if (!match) continue;
		const port = Number(match[1]);
		if (!(port > 0 && port < 65536)) continue;
		const ports = out.get(pid);
		if (!ports.includes(port)) ports.push(port);
	}
	return out;
}
