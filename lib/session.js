/**
 * Owns one visible Chrome/Edge window driven over the CDP pipe, keeps the picks
 * the page overlay reports, and writes element screenshots to disk.
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CdpWs } from './cdp.js';
import { BINDING_NAME, OVERLAY_SCRIPT } from './overlay.js';
import { classifyBindingAction } from './shared/binding-action.js';
import {
	ADOPT_RUNNING_ENV,
	BROWSER_ARGS_ENV,
	BROWSER_ENV,
	BROWSER_IDS,
	BROWSER_LABELS,
	browserLabel,
	defaultBrowserId,
	normalizeBrowserId,
	parseExtraArgs,
	SANDBOX_FALLBACK_ENV,
	shouldTrySandboxFallback,
} from './shared/browsers.js';
import { externalCandidates, parseVersionReply } from './shared/cdp-endpoint.js';
import { EGO_AGENT_SPACE_NAME, isEgoBrowserCommand, isEgoOnboardingTarget, listeningPortsByPid } from './shared/ego.js';
import { advancePendingConsume, popLastPick } from './shared/pick-actions.js';
import { isGuiPage } from './shared/gui-page.js';
import { scratchDir } from './shared/scratch-dir.js';
import { mergeTab } from './shared/tabs.js';
import { normalizeAddress } from './shared/url.js';
import {
	DEFAULT_SPACE_NAME,
	filterTabsBySpace,
	nextSpaceName,
	normalizeSpaceId,
	sanitizeSpaceName,
} from './shared/spaces.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How many consumed/cleared picks keep answering /pick before they fall off. */
const MAX_RETIRED = 200;

/**
 * Executable candidates per platform, most likely first. The per-browser env
 * override (BROWSER_ENV) is prepended in candidatesFor(), so all three browsers
 * accept a custom path on every platform instead of only on Windows.
 */
const CANDIDATES = {
	win32: {
		chrome: [
			'C:/Program Files/Google/Chrome/Application/chrome.exe',
			'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
			path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
		],
		edge: [
			'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
			'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
		],
		// ego lite 的 Windows 安装位（Program Files 与 per-user 安装都覆盖）。
		ego: [
			'C:/Program Files/ego lite/ego lite.exe',
			'C:/Program Files (x86)/ego lite/ego lite.exe',
			path.join(process.env.LOCALAPPDATA ?? '', 'Programs/ego lite/ego lite.exe'),
		],
	},
	darwin: {
		chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
		edge: [
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
			path.join(os.homedir(), 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
		],
		// ego lite 的外层二进制只是个 launcher，真正的 Chromium 在 Framework 里；
		// 直接启动外层就行——它照常处理 --user-data-dir / --remote-debugging-port=0。
		ego: [
			'/Applications/ego lite.app/Contents/MacOS/ego lite',
			path.join(os.homedir(), 'Applications/ego lite.app/Contents/MacOS/ego lite'),
		],
	},
	linux: {
		chrome: [
			'/usr/bin/google-chrome',
			'/usr/bin/google-chrome-stable',
			'/usr/bin/chromium',
			'/usr/bin/chromium-browser',
		],
		edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
		ego: ['/usr/bin/ego-lite', '/usr/share/ego-lite/ego-lite', '/opt/ego lite/ego lite'],
	},
};

function candidatesFor(browser) {
	const table = CANDIDATES[process.platform] ?? CANDIDATES.linux;
	const defaults = table[browser] ?? [];
	const override = (process.env[BROWSER_ENV[browser]] ?? '').trim();
	return override ? [override, ...defaults] : defaults;
}

export function resolveBrowserExecutable(browser = 'chrome') {
	for (const candidate of candidatesFor(normalizeBrowserId(browser))) {
		if (!candidate) continue;
		try {
			if (fs.existsSync(candidate)) return candidate;
		} catch {
			/* keep looking */
		}
	}
	return null;
}

export function availableBrowsers() {
	const out = {};
	for (const browser of BROWSER_IDS) out[browser] = resolveBrowserExecutable(browser);
	return out;
}

/** 请求没点名浏览器时的缺省：第一个装了的（面板与裸 /launch 走同一条规则）。 */
export function defaultBrowser(available = availableBrowsers()) {
	return defaultBrowserId(available) ?? 'chrome';
}

/**
 * 新 profile 的第一扇窗口由 Chrome 自己定尺寸：在 4K / 高缩放的桌面上它会开成一块
 * 又窄又矮的小窗，用户看到的「整个浏览器都被缩小」往往就是这扇窗自身尺寸偏小。
 * 标注窗口是专用目标，所以默认最大化；要精确尺寸用 DSH_VISUAL_ANNOTATOR_WINDOW=1440x900
 * 覆盖（--window-size 的单位是 DIP，分隔符是逗号不是 x）。
 */
function windowArgs() {
	const size = (process.env.DSH_VISUAL_ANNOTATOR_WINDOW ?? '').trim();
	if (/^\d+[x,]\d+$/i.test(size)) return [`--window-size=${size.replace(/[x,]/i, ',')}`];
	return ['--start-maximized'];
}

/**
 * Ask one candidate base for its browser-level ws endpoint. Anything slower than
 * a beat counts as "no browser there": a firewall-dropped port must not make
 * `launch` look hung.
 */
async function fetchCdpEndpoint(base) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 600);
	try {
		const response = await fetch(base + '/json/version', { signal: controller.signal });
		if (!response.ok) return null;
		return parseVersionReply(await response.text(), base);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export class VisualPicker {
	constructor(options = {}) {
		// Scratch files (browser profile + element shots) are temp data: they belong
		// in the OS temp directory, never in the user's workspace. DSH_VISUAL_ANNOTATOR_DIR
		// moves the root (e.g. onto a bigger disk); options.baseDir does the same for tests.
		const envRoot = (process.env.DSH_VISUAL_ANNOTATOR_DIR ?? '').trim();
		this.tmpDir = envRoot || path.join(os.tmpdir(), 'dsh-visual-annotator');
		this.baseDir = options.baseDir ?? this.tmpDir;
		this.activeBaseDir = null;
		this.profileDir = null;
		this.profilePerLaunch = false;
		this.cleanProfile = null;
		this.state = {
			status: 'idle',
			error: null,
			browser: null,
			executable: null,
			activeUrl: '',
			activeTitle: '',
			mode: 'off',
			picks: [],
			// Monotonic token bumped when the in-page HUD asks the panel to insert
			// everything; the panel compares tokens so one request inserts exactly once.
			pendingConsume: 0,
			tabs: [],
			// 宿主自带沙箱时 Chrome 的浏览器进程会立刻 SIGTRAP；这时我们会带
			// --no-sandbox 重试一次，面板据此提示「本机浏览器在无沙箱模式下运行」。
			sandboxFallback: false,
		};
		this.cdp = null;
		this.proc = null;
		this.adopted = false;
		// 见 shouldTrySandboxFallback：只在「我们 spawn 的进程崩了」时置位，
		// 置位后不再重复尝试，避免崩溃时来回重启。
		this.useNoSandbox = false;
		this.log = options.log ?? null;
		// external = 显式 DSH_VISUAL_ANNOTATOR_CDP_URL 连上的外部浏览器（不是我们启动的实例）：
		// close() 只能断开，绝不能 Browser.close。默认永远不探测，免得接管用户日常 Chrome。
		this.external = false;
		this.attachBase = null;
		// 复用用户已经开着的 ego lite（见 _tryAttachRunningEgo）。默认开；测试与
		// 「别碰我日常浏览器」场景可用 DSH_VISUAL_ANNOTATOR_ADOPT_RUNNING=0 关掉。
		this.adoptRunning = options.adoptRunning ?? process.env[ADOPT_RUNNING_ENV] !== '0';
		// 窗口与 profile 都留在磁盘上反复用：断开只丢 socket，下次 launch 按这个目录重连。
		this.windowKept = false;
		this.windowProfileDir = null;
		this.attached = new Map();
		this.activeTargetId = null;
		// 调试空间 = Chromium BrowserContext（与 ego lite 的 task space 同一原语）：
		// 同一进程、同一 profile，但 cookie / storage / 标签页各自独立。'' = 默认空间，
		// 也就是浏览器启动时那个 context，它的 id 只有连上之后才知道。
		this.spaces = [];
		this.defaultContextId = '';
		this.activeSpace = '';
		// /state 轮询顺带核对标签页标题/URL 的节流时间戳。
		this.tabsRefreshedAt = 0;
		this.seq = 0;
		this.lastRemoved = null;
		// Picks already inserted or cleared: gone from the list, but still read by
		// /pick — an inserted chip expands minutes later. Their screenshots only die
		// when the archive overflows or the window closes.
		this.retired = [];
		this.listeners = new Set();
	}

	onChange(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	_emit() {
		for (const listener of this.listeners) {
			try {
				listener(this.snapshot());
			} catch {
				/* a listener must not break the picker */
			}
		}
	}

	snapshot() {
		// 每次快照都探测一遍：装/卸载浏览器后不用重启 host，面板下一次轮询就能看到。
		const browsers = availableBrowsers();
		return {
			status: this.state.status,
			error: this.state.error,
			browser: this.state.browser,
			executable: this.state.executable,
			activeUrl: this.state.activeUrl,
			activeTitle: this.state.activeTitle,
			mode: this.state.mode,
			// 面板据此把「关闭浏览器」改成「断开连接」，并说明当前窗口是复用的。
			reused: this.external,
			cdpBase: this.attachBase,
			// 断开后窗口还在（同一 profile 的同一个实例），面板据此提示「浏览器保留」。
			windowKept: this.windowKept,
			// 这次 launch 是接回已有 profile 的实例（而不是新起进程），面板据此说明。
			resumed: this.adopted,
			// 宿主沙箱导致浏览器只能以 --no-sandbox 运行（见 shouldTrySandboxFallback）：
			// 面板与 agent 都能看出「为什么这个窗口没沙箱」，而不是默默降级。
			sandboxFallback: this.useNoSandbox,
			baseDir: this.activeBaseDir ?? this.baseDir,
			browsers,
			// 注册表由 host 单向下发：面板据此渲染浏览器选择器，两半不会各写一份 id。
			browserOrder: BROWSER_IDS,
			browserLabels: BROWSER_LABELS,
			browserDefault: defaultBrowserId(browsers),
			// 调试空间：面板据此渲染空间选择器；默认空间恒在首位，'' 是它的 id。
			spaces: this.spaceList(),
			space: normalizeSpaceId(this.activeSpace),
			spaceName:
				this.spaceList().find((space) => space.id === normalizeSpaceId(this.activeSpace))?.name ?? DEFAULT_SPACE_NAME,
			// 只列当前空间的标签页：另一个空间开着的页面不该出现在这一格的标签条里。
			tabs: filterTabsBySpace(this.state.tabs, this.activeSpace, this.defaultContextId).map((tab) => ({
				...tab,
				active: tab.targetId === this.activeTargetId,
			})),
			picks: this.state.picks.map((pick) => this._publicPick(pick)),
			pendingConsume: this.state.pendingConsume,
			// Inserted picks leave the list but stay resolvable: their chips expand at
			// submit time, which can be minutes after the insert.
			archived: this.retired.length,
		};
	}

	/** 面板要的空间清单：默认空间永远在第一项。 */
	spaceList() {
		return [{ id: '', name: DEFAULT_SPACE_NAME }, ...this.spaces.map((space) => ({ ...space }))];
	}

	/** 当前空间的 context id；默认空间在连上浏览器后才知道（可能暂时是 ''）。 */
	_spaceKey() {
		const id = normalizeSpaceId(this.activeSpace);
		return id || normalizeSpaceId(this.defaultContextId);
	}

	/** 某个 context 里的页面目标（默认空间用 _spaceKey 的回落）。 */
	async _spacePages(contextId) {
		const key = normalizeSpaceId(contextId);
		const result = await this.cdp.send('Target.getTargets').catch(() => ({ targetInfos: [] }));
		return (result.targetInfos ?? []).filter(
			(info) =>
				info.type === 'page' &&
				!String(info.url).startsWith('devtools://') &&
				normalizeSpaceId(info.browserContextId) === key,
		);
	}

	/** The one public shape of a pick, shared by /state, /pick and the agent tool. */
	_publicPick(pick) {
		return {
			id: pick.id,
			seq: pick.seq,
			comment: pick.comment,
			selector: pick.selector,
			tag: pick.tag,
			text: pick.text,
			html: pick.html,
			rect: pick.rect,
			pageRect: pick.pageRect,
			url: pick.url,
			title: pick.title,
			ts: pick.ts,
			shotPath: pick.shotPath ?? null,
			shotUrl: pick.shotPath ? `/api/visual-annotator/shot?id=${encodeURIComponent(pick.id)}` : null,
		};
	}

	/**
	 * Resolve one pick by id, live or already inserted. A chip inserted in round 1 is
	 * still submitted later, so "not in the list" must not mean "gone".
	 */
	findPick(id) {
		const key = String(id ?? '');
		if (!key) return null;
		const match = (pick) => String(pick.id) === key;
		const hit = this.state.picks.find(match) ?? this.retired.find(match);
		return hit ? this._publicPick(hit) : null;
	}

	/** Everything still worth reading: live picks first, then the ones already inserted. */
	readablePicks() {
		const bySeq = (a, b) => (a.seq ?? 0) - (b.seq ?? 0) || String(a.id).localeCompare(String(b.id));
		return [...this.state.picks, ...this.retired].sort(bySeq).map((pick) => this._publicPick(pick));
	}

	/**
	 * Scratch base dir for one launch: the project's subdirectory under the temp
	 * root when a workspace cwd is known, else the root itself (null = keep the
	 * shared root, which also means the profile survives close()).
	 */
	_scratchBase(cwd) {
		return cwd && path.isAbsolute(cwd) ? scratchDir(this.baseDir, cwd) : null;
	}

	get running() {
		return this.state.status === 'ready' && this.cdp !== null && !this.cdp.closed;
	}

	async launch({ url, browser, cwd, cleanProfile } = {}) {
		// 面板里敲的是"地址"：只写 gitee.com 也得能打开，不能交给 Target.createTarget
		// 自己猜（它猜不出来就开一页 about:blank）。
		url = normalizeAddress(url);
		if (this.running) {
			// 点名换了浏览器就真的换：profile 与进程都不同，只导航是换不过去的。
			// 旧窗口在这里关掉（profile 保留），否则每换一次就多留一个窗口。
			const next = browser === undefined ? null : normalizeBrowserId(browser, this.state.browser ?? 'chrome');
			if (next && next !== this.state.browser) {
				await this.close({ terminate: true });
			} else {
				// Relaunching with no (or a blank) URL must not wipe the page the
				// user is annotating; an explicit URL still navigates.
				if (url && url !== 'about:blank') await this.navigate(url);
				return this.snapshot();
			}
		} else {
			await this.close();
		}
		// Per-launch base dir: never mutate the default, or one session's cwd
		// would leak its shots/profile into later launches. close() restores it.
		// The cwd only *names* the scratch subdirectory (profile + shots under the
		// OS temp root), so projects keep separate browser profiles without the
		// plugin ever writing into the workspace.
		this.activeBaseDir = this._scratchBase(cwd);
		// 空间属于这一轮浏览器进程：换浏览器/重启后旧 context 已经不存在，
		// 留着它们只会让面板列出一堆点不开的空间。
		this.spaces = [];
		this.defaultContextId = '';
		this.activeSpace = '';
		this.tabsRefreshedAt = 0;
		this.profilePerLaunch = false;
		this.profileDir = null;
		this.cleanProfile = cleanProfile === undefined ? null : cleanProfile === true;
		// 截图目录要先建好：无论走「接外部窗口」还是「自己起窗口」，_capture 都写这里。
		fs.mkdirSync(path.join(this.activeBaseDir ?? this.baseDir, 'shots'), { recursive: true });
		// 没点名（旧的 /launch 调用、或面板只发 url）时用第一个装了的浏览器，
		// 这样只装了 Edge / ego lite 的机器不会一上来就报「未找到 chrome」。
		const available = availableBrowsers();
		const browserId = normalizeBrowserId(browser, defaultBrowserId(available) ?? 'chrome');
		this.state.status = 'starting';
		this.state.error = null;
		this.state.browser = browserId;
		this.state.executable = null;
		this._emit();
		// 显式配置了 DSH_VISUAL_ANNOTATOR_CDP_URL 才去连「外部浏览器」；默认不探测任何
		// 端口——9222 上很可能就是用户的日常 Chrome，插件不该接管它。插件自己的窗口
		// 不靠端口发现，而是走下面的 profile 目录重连（同一实例反复用）。
		if (await this._tryAttachExternal(browserId)) {
			this.state.status = 'ready';
			this.state.error = null;
			this._emit();
			await this._syncSpaces();
			// ego：接管来的窗口是用户自己的，插件只在独立空间里开页，不动他当前那屏。
			if (browserId === 'ego') await this._ensureAgentSpace(browserId, url);
			else if (url && url !== 'about:blank') await this.navigate(url);
			return this.snapshot();
		}
		// ego lite 优先复用用户已经开着的实例：既不会被新手引导挡住，也不会在用户
		// 面前多起一个带空 profile 的窗口。找不到再走下面自己启动的路。
		if (browserId === 'ego' && (await this._tryAttachRunningEgo(browserId))) {
			this.state.status = 'ready';
			this.state.error = null;
			this._emit();
			// 用户自己的窗口不关引导：他要是正开着「欢迎使用 ego」，关掉就是抢他的窗口。
			await this._ensureAgentSpace(browserId, url);
			return this.snapshot();
		}
		const executable = available[browserId] ?? resolveBrowserExecutable(browserId);
		if (!executable) {
			this.state.status = 'error';
			this.state.error = `未找到 ${browserLabel(browserId)} 可执行文件（可设置 ${BROWSER_ENV[browserId]} 指定路径）`;
			this._emit();
			return this.snapshot();
		}
		// 一个（项目 × 浏览器）只对应一个 profile：它跨 close() 保留，下次 launch 按目录
		// 重连同一个实例，登录态与标签页都不丢——不再每次开一扇带空 profile 的新窗。
		this.profilePerLaunch = false;
		const baseDir = this.activeBaseDir ?? this.baseDir;
		const profileDir = path.join(baseDir, `profile-${browserId}`);
		fs.mkdirSync(profileDir, { recursive: true });
		this.profileDir = profileDir;
		this.state.executable = executable;
		this._emit();
		// A browser for this profile may already be alive (host restart, earlier
		// panel session). Adopt it instead of spawning a duplicate: Chrome holds
		// a per-profile singleton, so a second spawn would just hand its URL to
		// the old instance and die with "pipe closed" — the duplicate-window bug.
		if (await this._tryAdopt(profileDir, browserId)) {
			this.state.status = 'ready';
			await this._syncSpaces();
			if (browserId === 'ego') {
				await this._closeEgoOnboarding();
				await this._ensureAgentSpace(browserId, url);
			} else if (url && url !== 'about:blank') await this.navigate(url);
			this._emit();
			return this.snapshot();
		}
		this._retried = false;
		const headless = process.env.DSH_VISUAL_ANNOTATOR_HEADLESS === '1';
		const args = [
			'--remote-debugging-port=0',
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-background-timer-throttling',
			'--user-data-dir=' + profileDir,
		];
		// Escapes for a sandboxed host: see parseExtraArgs. Placed before the window
		// flags so an explicit `--headless=new` there still wins for one run.
		args.push(...parseExtraArgs(process.env[BROWSER_ARGS_ENV]));
		// Armed only after a real crash was observed (see shouldTrySandboxFallback),
		// never up front: a host that is not sandboxed keeps Chrome's own sandbox.
		if (this.useNoSandbox) args.push('--no-sandbox');
		// Headless is only for the plugin's own smoke test; the product is a visible window.
		if (headless) args.push('--headless=new', '--disable-gpu');
		// A headless run has no window to size, so only a visible launch earns the window flags.
		else args.push(...windowArgs());
		args.push('about:blank');
		let proc;
		try {
			proc = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false });
		} catch (error) {
			this.state.status = 'error';
			this.state.error = String(error?.message ?? error);
			this._emit();
			return this.snapshot();
		}
		proc.once('error', (error) => {
			this.state.status = 'error';
			this.state.error = String(error?.message ?? error);
			this._emit();
		});
		proc.stderr?.on('data', () => {
			/* keep stderr drained so Chrome never blocks on it */
		});
		this.exitPromise = new Promise((resolve) => {
			proc.once('exit', () => resolve('exited'));
			setTimeout(() => resolve('timeout'), 8000);
		});
		proc.once('exit', () => {
			if (this.cdp?.proc === proc) {
				this.cdp = null;
				this.proc = null;
				this.attached.clear();
				this.state.status = 'idle';
				this.state.activeUrl = '';
				this.state.activeTitle = '';
				this.windowKept = false;
				this._emit();
			}
		});
		this.proc = proc;
		try {
			try {
				await this._connectWithRetry(profileDir, browserId, 12000);
			} catch (error) {
				// 连不上且进程已死，多半就是沙箱问题：先试回退，不行再把原错误抛出去。
				const crashedRetry = await this._retryWithoutSandbox({ proc, browserId, url, cwd });
				if (crashedRetry) return crashedRetry;
				throw error;
			}
			// 宿主自带沙箱时，握手成功之后浏览器进程才会 SIGTRAP 消失，所以这里
			// 必须真的探一次活，而不是相信 connect 成功。
			const earlyRetry = await this._retryWithoutSandbox({ proc, browserId, url, cwd });
			if (earlyRetry) return earlyRetry;
			this.cdp.onEvent((message) => this._onCdpEvent(message));
			this.launchUrl = url || 'about:blank';
			const pages = await this._waitForPage();
			const first = pages[0];
			await this._attach(first.targetId);
			// Reuse the blank tab Chrome opened with; anything else opens a new
			// tab in the SAME window via navigate()'s multi-tab semantics.
			// ego 例外：它的调试页只进独立空间，默认空间保持用户原样。
			if (url && url !== 'about:blank' && browserId !== 'ego') {
				if (first.url === 'about:blank') {
					const sessionId = this.attached.get(first.targetId);
					await this.cdp.send('Page.navigate', { url }, sessionId).catch(() => {});
					this.state.activeUrl = url;
					await sleep(300);
					await this._syncActiveTarget(first.targetId, sessionId);
				} else {
					await this.navigate(url);
				}
			}
			this.state.status = 'ready';
			this.state.error = null;
			this.windowKept = true;
			this.windowProfileDir = profileDir;
			await this._seedTabs();
			await this._syncSpaces();
			// ego：新手引导窗口在这时候已经弹出来了，先关掉，再把调试页开进独立空间。
			if (browserId === 'ego') {
				await this._closeEgoOnboarding();
				await this._ensureAgentSpace(browserId, url);
			}
			// 第二道检查：Chrome 在宿主沙箱里往往撑一两秒才被 SIGTRAP 带走，刚才
			// 那次探活可能恰好赶在它死之前，所以「已经是能用的状态」之前再看一次。
			const lateRetry = await this._retryWithoutSandbox({ proc, browserId, url, cwd });
			if (lateRetry) return lateRetry;
			this._emit();
		} catch (error) {
			// 沙箱回退优先：无论失败发生在哪一步，只要浏览器进程/连接已经死了，
			// 带 --no-sandbox 重来一次就是最有希望的那条路，别让它等满重试超时。
			const crashRetry = await this._retryWithoutSandbox({ proc, browserId, url, cwd });
			if (crashRetry) return crashRetry;
			const message = String(error?.message ?? error);
			if (!this._retried && /pipe closed|exited|closed|timeout|websocket|DevToolsActivePort/i.test(message)) {
				// Two recoverable cases: (1) a singleton handoff — our spawn
				// forwarded the URL to a live instance and exited, and that
				// instance owns a debug port we can adopt; (2) a lingering
				// profile lock from an instance that just died — retry spawn.
				this._retried = true;
				await sleep(800);
				if (await this._tryAdopt(profileDir, browserId)) {
					this._retried = false;
					this.state.status = 'ready';
					if (url && url !== 'about:blank') await this.navigate(url);
					this._emit();
					return this.snapshot();
				}
				await this.close({ terminate: true });
				await sleep(1500);
				return this.launch({ url, browser: browserId, cwd });
			}
			this._retried = false;
			this.state.status = 'error';
			this.state.error = message;
			this._emit();
		}
		return this.snapshot();
	}

	/**
	 * Reuse a browser that is already running with a debugging port — the user's
	 * own window or one left over from an earlier run. This is the "do not open
	 * yet another browser" path: connect, attach its tabs, and leave the process
	 * alone (close() only drops the socket for external browsers).
	 */
	async _tryAttachExternal(browserId) {
		for (const base of externalCandidates(process.env)) {
			if (await this._adoptBase(base, browserId)) return true;
		}
		return false;
	}

	/**
	 * 用户自己开着的 ego lite 也会在 127.0.0.1 上监听一个标准 CDP 端口（随机分配，
	 * 没有端口文件），所以「复用已有实例」= 找出 ego 主进程的监听端口，再按外部
	 * 浏览器接管。只在本机 macOS / Linux 上做；Windows 缺 pgrep/lsof 这套组合，
	 * 退回自己启动一个。
	 *
	 * 注意取进程的方式：宿主沙箱里 `ps` 会被拒（spawnSync ps EPERM）、`lsof -p <pid>`
	 * 也拿不到别人的进程，但 `pgrep -fl` 与整表 `lsof -iTCP -sTCP:LISTEN` 可用，
	 * 所以走「pgrep 拿 pid + 整表查端口」，两步都失败就当作没有可复用的实例。
	 */
	egoEndpoints() {
		if (process.platform === 'win32') return [];
		let listing;
		try {
			listing = execFileSync('pgrep', ['-fl', 'ego lite'], { encoding: 'utf8', timeout: 4000 });
		} catch {
			return []; // pgrep 没匹配时退出码 1，属正常
		}
		const pids = new Set();
		for (const line of listing.split('\n')) {
			const match = /^\s*(\d+)\s+(.*)$/.exec(line);
			if (!match) continue;
			const pid = Number(match[1]);
			if (pid === this.proc?.pid || !isEgoBrowserCommand(match[2])) continue;
			pids.add(pid);
		}
		if (pids.size === 0) return [];
		let portsByPid;
		try {
			portsByPid = listeningPortsByPid(
				execFileSync('lsof', ['-nP', '-F', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 6000 }),
			);
		} catch {
			return [];
		}
		const bases = [];
		for (const pid of pids) {
			for (const port of portsByPid.get(pid) ?? []) bases.push(`http://127.0.0.1:${port}`);
		}
		return [...new Set(bases)];
	}

	/** 复用用户已经开着的 ego lite：有实例就接管，没有就返回 false 让调用方启动。 */
	async _tryAttachRunningEgo(browserId) {
		if (!this.adoptRunning) return false; // 测试与「别抢我日常浏览器」场景
		for (const base of this.egoEndpoints()) {
			if (await this._adoptBase(base, browserId)) return true;
		}
		return false;
	}

	/** 接管一个已经在监听 CDP 的窗口：连上、接上它的标签页、不碰它的进程。 */
	async _adoptBase(base, browserId) {
		const endpoint = await fetchCdpEndpoint(base);
		if (!endpoint) return false;
		let cdp = null;
		try {
			cdp = new CdpWs(endpoint, browserId || 'browser');
			await cdp.open;
			const version = await cdp.send('Browser.getVersion');
			this.cdp = cdp;
			this.external = true;
			this.adopted = true;
			this.proc = null;
			this.exitPromise = null;
			this.attachBase = base;
			// Edge 的 product 里带 Edg/，能认出来；ego lite 报的是 Chrome/…，与 Chrome 无从区分，
			// 这时保留调用方点的那个 id，而不是把它一律改写回 chrome。
			if (/Edg\//.test(String(version?.product ?? ''))) this.state.browser = 'edge';
			else if (!this.state.browser) this.state.browser = browserId || 'chrome';
			this.state.executable = null;
			this.cdp.onEvent((message) => this._onCdpEvent(message));
			const pages = await this._waitForPage(6000);
			for (const page of pages) await this._attach(page.targetId).catch(() => {});
			const preferred = this._pickInitialPage(pages);
			if (preferred) {
				this.activeTargetId = preferred.targetId;
				this.state.activeUrl = preferred.url ?? '';
				this.state.activeTitle = preferred.title ?? '';
			}
			await this._seedTabs();
			return true;
		} catch {
			if (this.cdp === cdp) this.cdp = null;
			this.external = false;
			this.attachBase = null;
			try {
				cdp?.close();
			} catch {
				/* already gone */
			}
			return false;
		}
	}

	/** ego lite 全新 profile 会弹出新手引导窗口挡住用户；连上后把那一扇关掉。 */
	async _closeEgoOnboarding() {
		if (!this.cdp) return;
		try {
			const { targetInfos = [] } = await this.cdp.send('Target.getTargets');
			for (const info of targetInfos) {
				if (!isEgoOnboardingTarget(info)) continue;
				await this.cdp.send('Target.closeTarget', { targetId: info.targetId }).catch(() => {});
			}
		} catch {
			/* 没有引导窗口（或老版本不认这个 URL）时静默 */
		}
	}

	/** 把浏览器里已经存在的 BrowserContext 认回来，重连后切空间仍然有效。 */
	async _syncSpaces() {
		if (!this.cdp) return;
		let contextIds = [];
		try {
			const reply = await this.cdp.send('Target.getBrowserContexts');
			contextIds = reply?.browserContextIds ?? [];
		} catch {
			return;
		}
		let targets = [];
		try {
			const reply = await this.cdp.send('Target.getTargets');
			targets = reply?.targetInfos ?? [];
		} catch {
			/* 认不出目标就只按 context 列表对齐 */
		}
		// 名字要跨重连保住：context id 每次重连都在，但「哪个是 agent 空间」只有
		// 落盘的注册表知道。否则上次的 agent 空间会被当成别人建的空间改名成
		// 「空间」，再新建一个空的「agent 空间」，页面就找不回来了。
		this._loadSpaces();
		const live = new Set(contextIds.filter(Boolean));
		this.spaces = this.spaces.filter((space) => live.has(space.id));
		for (const id of live) {
			if (this.spaces.some((space) => space.id === id)) continue;
			this.spaces.push({ id, name: nextSpaceName(this.spaces.map((space) => space.name)) });
		}
		// 默认空间的 context id 没有 API 直给，但它有两个特征：带着页面、不在
		// Target.getBrowserContexts 的列表里。按这个差别认，比「第一个挂上的目标」
		// 稳——ego 启动后会直奔 agent 空间，先挂上的往往是空间页而不是默认页。
		const known = new Set(this.spaces.map((space) => space.id));
		const fallback = targets.map((info) => normalizeSpaceId(info.browserContextId)).find((id) => id && !known.has(id));
		if (fallback) this.defaultContextId = fallback;
		this._saveSpaces();
	}

	/** 空间注册表落盘位置：跟 profile 一样按项目 + 浏览器分开，互不串。 */
	_spacesFile() {
		const base = this.activeBaseDir ?? this.baseDir;
		if (!base) return null;
		return path.join(base, `spaces-${this.state.browser ?? 'chrome'}.json`);
	}

	_loadSpaces() {
		const file = this._spacesFile();
		if (!file) return [];
		try {
			const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
			if (Array.isArray(parsed?.spaces)) {
				this.spaces = parsed.spaces
					.filter((space) => space && typeof space.id === 'string' && space.id)
					.map((space) => ({ id: space.id, name: typeof space.name === 'string' && space.name ? space.name : '空间' }));
			}
		} catch {
			/* 没有注册表（首次启动）或内容坏了：按空表处理 */
		}
		return this.spaces;
	}

	_saveSpaces() {
		const file = this._spacesFile();
		if (!file) return;
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, JSON.stringify({ spaces: this.spaces, defaultContextId: this.defaultContextId }, null, 2));
		} catch {
			/* 落盘失败只影响重连后的名字，不该打断启动 */
		}
	}

	/**
	 * ego lite 专属：插件只在自己的空间里干活，绝不混进用户当前那个空间。
	 * ego 的 TaskSpace 本身就是 Chromium BrowserContext，所以「单独一个 space」
	 * 用同一个原语实现：复用空着的 context 或新建一个，再在里面开页。
	 */
	async _ensureAgentSpace(browserId, url) {
		if (browserId !== 'ego' || !this.running) return;
		await this._syncSpaces();
		const target = url && url !== 'about:blank' ? url : undefined;
		const existing = this.spaces.find((space) => space.name === EGO_AGENT_SPACE_NAME);
		try {
			if (existing) await this.useSpace(existing.id, target);
			else await this.createSpace({ name: EGO_AGENT_SPACE_NAME, url: target });
		} catch (error) {
			// 空间只影响「调试页开在哪」，不该让整个 launch 变成失败：记一条日志即可。
			this.log?.('warn', `ego 独立空间创建失败，退回默认空间：${String(error?.message ?? error)}`);
			await this.useSpace('', target).catch(() => {});
		}
	}

	/** The tab a fresh connection should show: last real page, never the DSH GUI. */
	_pickInitialPage(pages) {
		const list = pages ?? [];
		const reversed = [...list].reverse();
		return (
			reversed.find((page) => page.url && page.url !== 'about:blank' && !this._isGuiPage(page.url, page.title)) ??
			reversed.find((page) => page.url && page.url !== 'about:blank') ??
			list[0] ??
			null
		);
	}

	/** Connect to an already-running browser that uses this exact profile dir. */
	async _tryAdopt(profileDir, browser) {
		const endpoint = await this._readDevToolsEndpoint(profileDir, 0);
		if (!endpoint) return false;
		try {
			const cdp = new CdpWs(endpoint, browser);
			await cdp.open;
			await cdp.send('Browser.getVersion');
			await this.close();
			this.profileDir = profileDir;
			// profileDir 是 <scratch>/profile-<browser>，dirname 就是这份临时目录本身：
			// 截图与 profile 始终落在同一层，close() 清掉 activeBaseDir 后靠它恢复。
			this.activeBaseDir = path.dirname(profileDir);
			this.cdp = cdp;
			this.adopted = true;
			this.proc = null;
			this.exitPromise = null;
			this.windowKept = true;
			this.windowProfileDir = profileDir;
			this.cdp.onEvent((message) => this._onCdpEvent(message));
			const pages = await this._waitForPage(6000);
			for (const page of pages) await this._attach(page.targetId).catch(() => {});
			const preferred = this._pickInitialPage(pages);
			if (preferred) {
				this.activeTargetId = preferred.targetId;
				this.state.activeUrl = preferred.url ?? '';
				this.state.activeTitle = preferred.title ?? '';
			}
			await this._seedTabs();
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Poll <profileDir>/DevToolsActivePort and open a verified browser WS
	 * connection. The file may hold a stale port from a previous run (the
	 * profile survives close() when it is not per-launch), so every candidate
	 * endpoint is verified with Browser.getVersion before being accepted.
	 */
	async _connectWithRetry(profileDir, browser, maxWaitMs) {
		const deadline = Date.now() + maxWaitMs;
		let lastPort = null;
		for (;;) {
			// 进程已经没了就没必要再等满 12s：宿主沙箱把浏览器带走时，调试端口
			// 可能刚好写完又被删掉，干等只会让用户看着「启动中」发呆。
			if (this.proc && (this.proc.exitCode !== null || this.proc.signalCode)) {
				throw new Error(`浏览器进程退出（${this.proc.signalCode ?? this.proc.exitCode}）`);
			}
			const endpoint = await this._readDevToolsEndpoint(profileDir, 250);
			if (endpoint) {
				const port = endpoint.match(/^ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1] ?? null;
				if (port && port !== lastPort) {
					lastPort = port;
					try {
						const cdp = new CdpWs(endpoint, browser);
						await cdp.open;
						await cdp.send('Browser.getVersion');
						this.cdp = cdp;
						return;
					} catch {
						/* stale or half-written endpoint; keep polling */
					}
				}
			}
			if (Date.now() > deadline) throw new Error('未能在 profile 中获得可用的浏览器调试端口（DevToolsActivePort）');
			await sleep(200);
		}
	}

	/**
	 * Read <profileDir>/DevToolsActivePort and return the browser-level ws
	 * endpoint. maxWaitMs=0 means "must already be there" (adoption path).
	 */
	async _readDevToolsEndpoint(profileDir, maxWaitMs) {
		const file = path.join(profileDir, 'DevToolsActivePort');
		const deadline = Date.now() + maxWaitMs;
		for (;;) {
			try {
				const text = fs.readFileSync(file, 'utf8');
				const [port, wsPath] = text
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean);
				if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
			} catch {
				/* not written yet */
			}
			if (Date.now() > deadline) return null;
			await sleep(150);
		}
	}

	/**
	 * 刚 spawn 的浏览器被宿主沙箱干掉了吗？干掉过就带 `--no-sandbox` 重来一次。
	 *
	 * 返回「重试后的 snapshot」表示已经重来过（调用方直接返回它），返回 null 表示
	 * 一切正常、继续原流程。只对**我们自己 spawn** 的进程生效：接回的外部窗口崩了
	 * 不该被我们改参数重启。
	 */
	async _retryWithoutSandbox({ proc, browserId, url, cwd }) {
		const crash = await this._detectSpawnCrash(proc);
		const retry = shouldTrySandboxFallback({
			alreadyNoSandbox: this.useNoSandbox,
			optOut: process.env[SANDBOX_FALLBACK_ENV] === '0',
			crashed: crash.crashed,
		});
		if (!retry) return null;
		this.useNoSandbox = true;
		this.state.sandboxFallback = true;
		this.log?.(
			'warn',
			`dsh-visual-annotator: ${browserLabel(browserId)} 在宿主沙箱下起不来（${crash.reason}），` +
				`改用 --no-sandbox 重试一次；不希望这样可设 ${SANDBOX_FALLBACK_ENV}=0`,
		);
		await this.close({ terminate: true }).catch(() => {});
		await sleep(500);
		return this.launch({ url, browser: browserId, cwd });
	}

	/**
	 * 刚 spawn 的浏览器还活着吗？
	 *
	 * 要抓的失败很不客气：CDP 握手成功、甚至第一次 Browser.getVersion 都能答，
	 * 之后进程才消失（Chrome 自己的 sandbox 在宿主沙箱里装不上，浏览器进程
	 * SIGTRAP）。所以判据是「进程仍是我们的 → 隔一会儿再探一次」，两次都答上来
	 * 才算活着。接外部窗口（adopted）不走这里：那个进程不是我们起的。
	 */
	async _detectSpawnCrash(proc) {
		if (!proc) return { crashed: false };
		const exited = () => proc.exitCode !== null || Boolean(proc.signalCode);
		if (exited()) return { crashed: true, reason: `浏览器进程退出（${proc.signalCode ?? proc.exitCode}）` };
		for (let attempt = 0; attempt < 2; attempt += 1) {
			if (!this.cdp || this.cdp.closed) return { crashed: true, reason: 'CDP 连接已断开' };
			try {
				await this.cdp.send('Browser.getVersion');
			} catch {
				return { crashed: true, reason: 'CDP 连接已断开' };
			}
			await sleep(250);
		}
		if (exited()) return { crashed: true, reason: `浏览器进程退出（${proc.signalCode ?? proc.exitCode}）` };
		return { crashed: false };
	}

	/** See lib/shared/gui-page.js — kept as a method for internal call sites. */
	_isGuiPage(url, title) {
		return isGuiPage(url, title);
	}

	async _waitForPage(timeoutMs = 20000) {
		const started = Date.now();
		const deadline = started + timeoutMs;
		let created = false;
		for (;;) {
			// 早点认出「浏览器已经死了」，让 launch 的 catch 走去 --no-sandbox 回退，
			// 而不是在这里耗到 20s 超时。
			if (this.cdp?.closed) throw new Error('CDP 连接已断开');
			if (this.proc && (this.proc.exitCode !== null || this.proc.signalCode)) {
				throw new Error(`浏览器进程退出（${this.proc.signalCode ?? this.proc.exitCode}）`);
			}
			const result = await this.cdp.send('Target.getTargets');
			const pages = (result.targetInfos ?? []).filter((info) => info.type === 'page');
			if (pages.length) return pages;
			// ego lite 启动后只开自家的 chrome:// 界面（browser_ui 类型），不会自己建可
			// 调试页面；等一小会儿还是没有就替它开一个空白页，否则这里只能等到超时。
			if (!created && Date.now() - started > 1500) {
				created = true;
				await this.cdp.send('Target.createTarget', { url: 'about:blank' }).catch(() => {});
			}
			if (Date.now() > deadline) throw new Error('浏览器已启动但未发现可调试页面');
			await sleep(150);
		}
	}

	async _attach(targetId) {
		if (this.attached.has(targetId)) return this.attached.get(targetId);
		const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
		this.attached.set(targetId, sessionId);
		// Browser-level WS clients cannot rely on Target.targetCreated being
		// broadcast; book the tab ourselves on every attach.
		await this.cdp
			.send('Target.getTargetInfo', { targetId })
			.then((info) => {
				if (!info?.targetInfo) return;
				this._upsertTab(info.targetInfo);
			})
			.catch(() => {});
		if (!this.activeTargetId) this.activeTargetId = targetId;
		await this.cdp.send('Page.enable', {}, sessionId).catch(() => {});
		await this.cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
		await this.cdp.send('Runtime.addBinding', { name: BINDING_NAME }, sessionId).catch(() => {});
		await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: OVERLAY_SCRIPT }, sessionId).catch(() => {});
		await this._evaluate(OVERLAY_SCRIPT, sessionId).catch(() => {});
		await this._applyMode(sessionId).catch(() => {});
		await this._syncActiveTarget(targetId, sessionId);
		return sessionId;
	}

	async _syncActiveTarget(targetId, sessionId) {
		try {
			const result = await this.cdp.send(
				'Runtime.evaluate',
				{
					expression: 'JSON.stringify({url: location.href, title: document.title})',
					returnByValue: true,
				},
				sessionId,
			);
			const parsed = JSON.parse(result?.result?.value ?? '{}');
			const url = parsed.url ?? '';
			const isBlank = (value) => !value || value === 'about:blank';
			const activeSession = this.attached.get(this.activeTargetId);
			const adopt =
				targetId === this.activeTargetId ||
				(!activeSession && !this._isGuiPage(url, parsed.title)) ||
				(isBlank(this.state.activeUrl) && !isBlank(url) && !this._isGuiPage(url, parsed.title));
			if (!adopt) return;
			this.activeTargetId = targetId;
			this.state.activeUrl = url;
			this.state.activeTitle = parsed.title ?? '';
			this._emit();
		} catch {
			/* target may be navigating */
		}
	}

	_onCdpEvent(message) {
		const method = message.method;
		if (!method) return;
		if (method === 'Runtime.bindingCalled' && message.params?.name === BINDING_NAME) {
			let payload;
			try {
				payload = JSON.parse(message.params.payload ?? '{}');
			} catch {
				return;
			}
			// 页面 -> host 的统一分发：pick 记录，mode 由 host 接管并广播，undo/consume
			// 操作列表；未知/畸形 payload 由分类器丢弃。
			const action = classifyBindingAction(payload);
			if (action === 'pick') void this._recordPick(payload, message.sessionId);
			else if (action === 'mode') void this.setMode(payload.mode);
			else if (action === 'undo') this.undoLastPick();
			else if (action === 'consume') this._requestConsume();
			return;
		}
		if (method === 'Page.loadEventFired') {
			void this._applyMode(message.sessionId);
			return;
		}
		if (method === 'Target.targetCreated' || method === 'Target.targetInfoChanged') {
			const info = message.params?.targetInfo;
			if (info?.type === 'page' && !info.url?.startsWith('devtools://')) {
				this._upsertTab(info);
				// 用户在浏览器里自己导航/切页时，面板顶部的地址与标题也要跟着走，
				// 否则「当前页」和真实前台对不上（这里只认已挂上的当前页）。
				if (info.targetId === this.activeTargetId && (info.url || info.title)) {
					this.state.activeUrl = info.url ?? this.state.activeUrl;
					this.state.activeTitle = info.title ?? this.state.activeTitle;
					this._emit();
				}
				void this._attach(info.targetId).catch(() => {});
			}
			return;
		}
		if (method === 'Target.targetDestroyed') {
			const targetId = message.params?.targetId;
			this.state.tabs = (this.state.tabs ?? []).filter((tab) => tab.targetId !== targetId);
			this.attached.delete(targetId);
			if (this.activeTargetId === targetId) {
				this.activeTargetId = null;
				const rest = this.state.tabs ?? [];
				const next = rest.find((tab) => !this._isGuiPage(tab.url, tab.title)) ?? rest[0];
				if (next) {
					void (async () => {
						const sessionId = await this._attach(next.targetId).catch(() => null);
						if (!sessionId) return;
						this.activeTargetId = next.targetId;
						await this._syncActiveTarget(next.targetId, sessionId);
					})();
				}
			}
			this._emit();
			return;
		}
	}

	/**
	 * 就地更新，不打乱顺序：面板里的标签条要和浏览器那一排同序，不能因为
	 * 每收到一次事件就把整排重排。地址变了就认新标题（可能暂时为空），
	 * 地址没变而这次没带标题时保留旧标题，别把已知标题擦成空。
	 */
	_upsertTab(info, { emit = true } = {}) {
		this.state.tabs = mergeTab(this.state.tabs, info);
		if (emit) this._emit();
		return this.state.tabs;
	}

	/**
	 * 把 Target.getTargets 的真实情况和面板对一遍。面板每秒轮询 /state，这里节流
	 * 到 800ms 一次；只在真的有变化时才 emit，避免无谓的重渲染。
	 */
	async refreshTabs({ force = false } = {}) {
		if (!this.cdp || this.cdp.closed) return;
		const now = Date.now();
		if (!force && now - (this.tabsRefreshedAt ?? 0) < 800) return;
		this.tabsRefreshedAt = now;
		let targetInfos = [];
		try {
			const result = await this.cdp.send('Target.getTargets');
			targetInfos = (result.targetInfos ?? []).filter(
				(info) => info.type === 'page' && !String(info.url).startsWith('devtools://'),
			);
		} catch {
			return;
		}
		if (!targetInfos.length) return;
		const fingerprint = (tabs) =>
			JSON.stringify((tabs ?? []).map((tab) => [tab.targetId, tab.url, tab.title, tab.contextId]));
		const before = fingerprint(this.state.tabs);
		for (const info of targetInfos) this._upsertTab(info, { emit: false });
		if (before !== fingerprint(this.state.tabs)) this._emit();
	}

	/** Pages that already exist when we connect never fire targetCreated. */
	async _seedTabs() {
		// 不开发现，浏览器只会把「我们自己 attach 的」页面告诉我们：用户在这个窗口里
		// 手动新开/关掉的标签页要等下次启动才对得上——面板里的标签条于是和浏览器
		// 里真实的一排对不上。开一次就够，之后 targetCreated/Destroyed 会自己来。
		await this.cdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
		try {
			const result = await this.cdp.send('Target.getTargets');
			for (const info of result.targetInfos ?? []) {
				if (info.type === 'page' && !String(info.url).startsWith('devtools://')) this._upsertTab(info);
			}
		} catch {
			/* best effort */
		}
	}

	_evaluate(expression, sessionId) {
		return this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false }, sessionId);
	}

	async _applyMode(sessionId) {
		if (!this.cdp) return;
		// sync() 是 host -> page 的唯一同步口：mode 加上当前已标注数一起推。
		const info = JSON.stringify({ mode: this.state.mode, count: this.state.picks.length });
		const expression = `window.__DSH_VP__ && window.__DSH_VP__.sync(${info})`;
		if (sessionId) await this._evaluate(expression, sessionId).catch(() => {});
		else for (const sid of this.attached.values()) await this._evaluate(expression, sid).catch(() => {});
	}

	async _recordPick(payload, sessionId) {
		const id = 'p' + ++this.seq;
		const pick = {
			id,
			seq: payload.seq ?? this.seq,
			comment: payload.comment ?? '',
			selector: payload.selector ?? '',
			tag: payload.tag ?? '',
			text: payload.text ?? '',
			html: payload.html ?? '',
			rect: payload.rect ?? null,
			pageRect: payload.pageRect ?? null,
			url: payload.url ?? this.state.activeUrl,
			title: payload.title ?? this.state.activeTitle,
			ts: Date.now(),
			shotPath: null,
			sessionId,
		};
		this.state.picks.push(pick);
		if (payload.title) this.state.activeTitle = payload.title;
		if (payload.url) this.state.activeUrl = payload.url;
		this._emit();
		// 页面 HUD 计数来自 host sync；先广播再截图：_capture 是一次 CDP 往返，
		// 可能耗时较长，放后面会让页面计数在这段窗口里落后于真实值。
		await this._applyMode(null);
		await this._capture(pick, sessionId);
	}

	async _capture(pick, sessionId) {
		if (!this.cdp || !pick.pageRect) return;
		const rect = pick.pageRect;
		const width = Math.max(1, Math.round(rect.width));
		const height = Math.max(1, Math.round(rect.height));
		const clip = {
			x: Math.max(0, Math.round(rect.x) - 4),
			y: Math.max(0, Math.round(rect.y) - 4),
			width: width + 8,
			height: height + 8,
			scale: 1,
		};
		// captureBeyondViewport:true 会为了截到视口外的内容把渲染视口临时撑成整页再还原：
		// 页面随后收到 resize、整页重排一次，用户看到的就是「点完标注（或 Ctrl Enter）浏览器抖一下」。
		// 改成只截当前视口里的那部分：先量布局视口，把 clip 夹进可见区，再要求
		// captureBeyondViewport:false。夹完为空说明元素整个在视口外（正常点击不会发生，
		// 只有脚本构造的 pick 才会），那种情况才退回整页截图，宁可抖一下也别丢缩略图。
		let beyond = false;
		const viewport = await this.cdp.send('Page.getLayoutMetrics', {}, sessionId).catch(() => null);
		const visible = viewport?.cssLayoutViewport;
		if (visible && visible.clientWidth > 0 && visible.clientHeight > 0) {
			const left = Math.max(clip.x, Math.floor(visible.pageX));
			const top = Math.max(clip.y, Math.floor(visible.pageY));
			const right = Math.min(clip.x + clip.width, Math.ceil(visible.pageX + visible.clientWidth));
			const bottom = Math.min(clip.y + clip.height, Math.ceil(visible.pageY + visible.clientHeight));
			const width2 = Math.floor(right - left);
			const height2 = Math.floor(bottom - top);
			if (width2 >= 4 && height2 >= 4) {
				clip.x = left;
				clip.y = top;
				clip.width = width2;
				clip.height = height2;
			} else {
				beyond = true;
			}
		}
		try {
			const result = await this.cdp.send(
				'Page.captureScreenshot',
				{
					format: 'png',
					clip,
					captureBeyondViewport: beyond,
				},
				sessionId,
			);
			if (!result?.data) return;
			const dir = path.join(this.activeBaseDir ?? this.baseDir, 'shots');
			fs.mkdirSync(dir, { recursive: true });
			const file = path.join(dir, `${pick.id}.png`);
			fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
			pick.shotPath = file;
			this._emit();
		} catch {
			/* element may be scrolled away or the target closed */
		}
	}

	/** Fixed-expression health probe used by /probe; never a general eval channel. */
	async probeOverlay() {
		if (!this.running) throw new Error('browser not running');
		const expression = `JSON.stringify({
			version: (window.__DSH_VP__ || {}).version ?? null,
			mode: (window.__DSH_VP__ || {}).getMode ? window.__DSH_VP__.getMode() : null,
			hosts: document.querySelectorAll('#__dsh-vp-root').length,
			ready: document.readyState,
			url: location.href,
			title: document.title,
		})`;
		const sessionId = this.attached.get(this.activeTargetId);
		if (!sessionId) throw new Error('no attached page');
		const result = await this._evaluate(expression, sessionId);
		const raw = result?.result?.value;
		try {
			return JSON.parse(raw);
		} catch {
			return { raw: raw ?? null, exception: result?.exceptionDetails?.text ?? null };
		}
	}

	async setMode(mode) {
		this.state.mode = mode === 'pick' ? 'pick' : 'off';
		if (this.running) await this._applyMode(null);
		this._emit();
		return this.snapshot();
	}

	/**
	 * 新建一个调试空间（= 新的 BrowserContext）。命名冲突由 nextSpaceName 兜底，
	 * 空名字回落到自动编号，保证面板永远拿得到一个能显示的名字。
	 */
	async createSpace({ name, url } = {}) {
		if (!this.running) throw new Error('浏览器未启动，无法新建空间');
		const label = sanitizeSpaceName(name) ?? nextSpaceName(this.spaces.map((space) => space.name));
		const { browserContextId } = await this.cdp.send('Target.createBrowserContext', {});
		if (!browserContextId) throw new Error('浏览器没有返回空间 id');
		this.spaces.push({ id: browserContextId, name: label });
		this._saveSpaces();
		await this.useSpace(browserContextId, url);
		return this.snapshot();
	}

	/** 切到某个空间：已有页面就复用，没有就替它在自己的 context 里开一个。 */
	async useSpace(spaceId, url) {
		if (!this.running) throw new Error('浏览器未启动，无法切换空间');
		url = normalizeAddress(url);
		const id = normalizeSpaceId(spaceId);
		if (id && !this.spaces.some((space) => space.id === id)) throw new Error('空间不存在');
		this.activeSpace = id;
		const contextId = this._spaceKey();
		const pages = await this._spacePages(contextId);
		const page = pages.find((info) => info.url && info.url !== 'about:blank') ?? pages[0];
		if (page) {
			await this._attach(page.targetId);
			this.activeTargetId = page.targetId;
			await this.cdp.send('Target.activateTarget', { targetId: page.targetId }).catch(() => {});
			const sessionId = this.attached.get(page.targetId);
			if (sessionId) await this._syncActiveTarget(page.targetId, sessionId);
			if (url && url !== 'about:blank' && page.url !== url) await this.navigate(url);
			this._emit();
			return this.snapshot();
		}
		// 这个空间还没有页面：在它自己的 context 里开一个，绝不去搬默认空间的标签。
		const created = await this.cdp.send('Target.createTarget', {
			url: url && url !== 'about:blank' ? url : 'about:blank',
			background: false,
			...(contextId ? { browserContextId: contextId } : {}),
		});
		await this._attach(created.targetId);
		this.activeTargetId = created.targetId;
		await this.cdp.send('Target.activateTarget', { targetId: created.targetId }).catch(() => {});
		if (!contextId) {
			// 默认空间原本一页都没有时（ego 启动直奔 agent 空间），它的 context id
			// 只能从刚开出来的这一页问回来；记下来，关掉空间后还能回到原处。
			const info = await this.cdp.send('Target.getTargetInfo', { targetId: created.targetId }).catch(() => null);
			const ctx = normalizeSpaceId(info?.targetInfo?.browserContextId);
			if (ctx && ctx !== this.defaultContextId) {
				this.defaultContextId = ctx;
				this._saveSpaces();
			}
		}
		if (url && url !== 'about:blank') this.state.activeUrl = url;
		this._emit();
		await sleep(300);
		const sessionId = this.attached.get(created.targetId);
		if (sessionId) await this._syncActiveTarget(created.targetId, sessionId);
		return this.snapshot();
	}

	/** 关掉空间：销毁它的 context（连带页面与 cookie），然后回默认空间。 */
	async closeSpace(spaceId) {
		const id = normalizeSpaceId(spaceId);
		const index = this.spaces.findIndex((space) => space.id === id);
		if (index < 0) return this.snapshot();
		if (this.running) {
			await this.cdp.send('Target.disposeBrowserContext', { browserContextId: id }).catch(() => {});
		}
		this.spaces.splice(index, 1);
		this._saveSpaces();
		this.state.tabs = (this.state.tabs ?? []).filter((tab) => normalizeSpaceId(tab.contextId) !== id);
		if (normalizeSpaceId(this.activeSpace) === id) {
			this.activeSpace = '';
			this.activeTargetId = null;
			await this.useSpace('', this.state.activeUrl).catch(() => {});
		}
		this._emit();
		return this.snapshot();
	}

	async navigate(url) {
		if (!this.running) return this.snapshot();
		url = normalizeAddress(url);
		if (!url) return this.snapshot();
		const norm = (value) => {
			try {
				const parsed = new URL(value);
				return parsed.origin + parsed.pathname + parsed.search;
			} catch {
				return value;
			}
		};
		const targets = await this.cdp.send('Target.getTargets').catch(() => ({ targetInfos: [] }));
		const pages = (targets.targetInfos ?? []).filter(
			(info) => info.type === 'page' && !String(info.url).startsWith('devtools://'),
		);
		// Same URL already open -> bring that tab to the front, never duplicate.
		// 只在当前空间里找同 URL 的标签：另一个空间的同名页面不该被切成当前页。
		const contextId = this._spaceKey();
		const inSpace = (info) => normalizeSpaceId(info.browserContextId) === contextId;
		const existing = pages.find((info) => inSpace(info) && norm(info.url) === norm(url));
		if (existing) {
			await this.cdp.send('Target.activateTarget', { targetId: existing.targetId }).catch(() => {});
			await this._attach(existing.targetId);
			this.activeTargetId = existing.targetId;
			this.state.activeUrl = existing.url ?? url;
			this.state.activeTitle = existing.title ?? '';
			this._emit();
			return this.snapshot();
		}
		// New URL -> a NEW TAB in the SAME window (multi-tab, never a new window).
		const { targetId } = await this.cdp.send('Target.createTarget', {
			url,
			background: false,
			...(contextId ? { browserContextId: contextId } : {}),
		});
		await this._attach(targetId);
		this.activeTargetId = targetId;
		this.state.activeUrl = url;
		this._emit();
		await sleep(300);
		const sessionId = this.attached.get(targetId);
		if (sessionId) await this._syncActiveTarget(targetId, sessionId);
		return this.snapshot();
	}

	/** Bring an existing tab (from snapshot().tabs) to the front. */
	async activateTab(targetId) {
		if (!this.running || !targetId) return this.snapshot();
		await this.cdp.send('Target.activateTarget', { targetId }).catch(() => {});
		let sessionId = this.attached.get(targetId);
		if (!sessionId) sessionId = await this._attach(targetId).catch(() => null);
		if (sessionId) {
			this.activeTargetId = targetId;
			await this._syncActiveTarget(targetId, sessionId);
		}
		this._emit();
		return this.snapshot();
	}

	/** Bring the page back to a pick: activate its tab, then flash the overlay highlight. */
	async focusPick(id) {
		const pick = this.state.picks.find((item) => item.id === String(id ?? ''));
		if (!pick || !this.running) return { ...this.snapshot(), focused: false };
		let targetId = null;
		for (const [tid, sid] of this.attached) {
			if (sid === pick.sessionId) {
				targetId = tid;
				break;
			}
		}
		if (!targetId) targetId = (this.state.tabs ?? []).find((tab) => tab.url === pick.url)?.targetId ?? null;
		if (!targetId) targetId = this.activeTargetId;
		if (!targetId) return { ...this.snapshot(), focused: false };
		if (targetId !== this.activeTargetId) await this.activateTab(targetId);
		const sessionId = this.attached.get(targetId);
		if (!sessionId) return { ...this.snapshot(), focused: false };
		const args = JSON.stringify({
			selector: pick.selector ?? '',
			pageRect: pick.pageRect ?? null,
			label: pick.comment || pick.selector || pick.tag || '',
		});
		const expression = `window.__DSH_VP__ && window.__DSH_VP__.highlight(${args})`;
		try {
			const result = await this._evaluate(expression, sessionId);
			return { ...this.snapshot(), focused: result?.result?.value !== false };
		} catch {
			return { ...this.snapshot(), focused: false };
		}
	}

	async scrollTo(selector) {
		if (!this.running || !selector) return;
		const expression = `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(el){el.scrollIntoView({block:'center',inline:'center'});return true}return false})()`;
		for (const sid of this.attached.values()) await this._evaluate(expression, sid).catch(() => {});
	}

	async removePick(id) {
		const index = this.state.picks.findIndex((pick) => pick.id === id);
		if (index < 0) return this.snapshot();
		const [removed] = this.state.picks.splice(index, 1);
		await this._afterRemoval([removed], false);
		return this.snapshot();
	}

	// 页面内 HUD 的「撤销」：只从尾部弹一条，复用面板同款单槽撤销语义。
	// 语义在 shared/pick-actions.js 的纯函数里（可单测），这里只做 host 侧副作用。
	async undoLastPick() {
		const popped = popLastPick(this.state.picks);
		if (!popped) return this.snapshot();
		this.state.picks = popped.remaining;
		await this._afterRemoval([popped.removed], false);
		return this.snapshot();
	}

	// 页面内 HUD 的「完成·插入」：这里只发单调递增 token，插哪个、插几次
	// 完全由面板凭 token 判重执行（面板忙时 token 保留，下一轮轮询补插）。
	_requestConsume() {
		const next = advancePendingConsume(this.state.pendingConsume, this.state.picks.length);
		if (next === this.state.pendingConsume) return;
		this.state.pendingConsume = next;
		this._emit();
	}

	/**
	 * Consume picks the panel has already inserted into the composer. They leave the
	 * list so the next annotation round starts clean, and stay restorable as one
	 * batch. Their screenshots move to `retired` instead of being deleted: an
	 * inserted chip still needs the file when the draft is submitted.
	 */
	async consumePicks(ids) {
		const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
		if (!wanted.size) return { ...this.snapshot(), consumed: 0 };
		const removed = [];
		this.state.picks = this.state.picks.filter((pick) => {
			if (!wanted.has(String(pick.id))) return true;
			removed.push(pick);
			return false;
		});
		if (!removed.length) return { ...this.snapshot(), consumed: 0 };
		await this._afterRemoval(removed, true);
		return { ...this.snapshot(), consumed: removed.length };
	}

	/**
	 * Move picks into the read-only archive. The archive backs /pick, so a chip
	 * pasted before the list was cleared still expands to its real content; the
	 * oldest entries fall off past the cap and only then lose their screenshots.
	 */
	_archive(picks) {
		if (!picks.length) return;
		this.retired.push(...picks);
		const overflow = this.retired.length - MAX_RETIRED;
		if (overflow <= 0) return;
		for (const pick of this.retired.splice(0, overflow)) this._deleteShot(pick);
	}

	/**
	 * 移除类操作的固定收尾：整批换撤销槽 → 广播面板 → 同步页面 HUD 计数。
	 * archive=true 先走 _archive（consume/clear 的截图要留给已插入的 chip 继续用），
	 * 截图本身不删；否则（单条移除/撤销）截图留在槽里供 restore 用。被顶掉的旧槽
	 * 截图无论如何都删——它已不可恢复。
	 */
	async _afterRemoval(removed, archive) {
		if (this.lastRemoved) for (const pick of this.lastRemoved.picks) this._deleteShot(pick);
		if (archive) {
			this._archive(removed);
			this.lastRemoved = { picks: removed };
		} else {
			this.lastRemoved = removed.length ? { picks: removed } : null;
		}
		this._emit();
		await this._applyMode(null);
	}

	/** Undo the last removePick(): splice the pick back in at its seq/id position. */
	restorePick() {
		const entry = this.lastRemoved;
		if (!entry) return { ...this.snapshot(), restored: 0 };
		this.lastRemoved = null;
		for (const pick of entry.picks) {
			let index = this.state.picks.length;
			for (let i = 0; i < this.state.picks.length; i++) {
				const item = this.state.picks[i];
				if (
					(item.seq ?? 0) > (pick.seq ?? 0) ||
					((item.seq ?? 0) === (pick.seq ?? 0) && String(item.id) > String(pick.id))
				) {
					index = i;
					break;
				}
			}
			this.state.picks.splice(index, 0, pick);
			const retiredAt = this.retired.indexOf(pick);
			if (retiredAt >= 0) this.retired.splice(retiredAt, 1);
		}
		this._emit();
		void this._applyMode(null);
		return { ...this.snapshot(), restored: entry.picks.length };
	}

	_deleteShot(pick) {
		if (!pick?.shotPath) return;
		try {
			fs.rmSync(pick.shotPath, { force: true });
		} catch {
			/* best effort */
		}
	}

	setComment(id, comment) {
		const pick = this.state.picks.find((item) => item.id === id);
		if (pick) pick.comment = String(comment ?? '');
		this._emit();
		return this.snapshot();
	}

	/**
	 * One-click clear. Picks move to the archive (chips still resolve) and stay
	 * restorable as one batch, screenshots included, until the undo slot is
	 * replaced or the window closes. Nothing to clear leaves the archive alone.
	 */
	async clear() {
		const cleared = this.state.picks.slice();
		if (!cleared.length) return { ...this.snapshot(), cleared: 0 };
		this.state.picks = [];
		await this._afterRemoval(cleared, true);
		return { ...this.snapshot(), cleared: cleared.length };
	}

	shotFile(id) {
		const pick = this.state.picks.find((item) => item.id === id);
		return pick?.shotPath && fs.existsSync(pick.shotPath) ? pick.shotPath : null;
	}

	/** Markdown the panel injects into the composer / the agent tool returns. */
	toMarkdown() {
		const picks = this.state.picks;
		if (!picks.length) return '（当前还没有页面元素标注）';
		const lines = [];
		lines.push(
			`页面元素标注（${picks.length} 处，来源 ${this.state.browser ?? 'browser'}：${this.state.activeUrl || '未知页面'}）`,
		);
		picks.forEach((pick, index) => {
			lines.push('');
			lines.push(
				`${index + 1}. \`${pick.selector || pick.tag}\` — ${pick.tag}${pick.text ? `：${pick.text.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`,
			);
			if (pick.url) lines.push(`   页面：${pick.url}`);
			if (pick.pageRect)
				lines.push(
					`   位置：x=${Math.round(pick.pageRect.x)} y=${Math.round(pick.pageRect.y)} ${Math.round(pick.pageRect.width)}×${Math.round(pick.pageRect.height)}`,
				);
			if (pick.comment) lines.push(`   评论：${pick.comment}`);
			if (pick.html) lines.push('   HTML:' + ' `' + pick.html.replace(/\s+/g, ' ').slice(0, 300) + '`');
			if (pick.shotPath) lines.push(`   截图：${pick.shotPath}`);
		});
		return lines.join('\n');
	}

	/** Delete the browser profile when policy allows; shared/reused profiles survive. */
	async _cleanupProfile() {
		const dir = this.profileDir;
		this.profileDir = null;
		if (!dir) return;
		if (this.cleanProfile === false) return;
		if (this.cleanProfile !== true && !this.profilePerLaunch) return;
		// Windows releases profile file locks a beat after process exit.
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
				return;
			} catch {
				await sleep(400);
			}
		}
	}

	/**
	 * 结束这一轮标注。默认只断开 socket：浏览器窗口与它的 profile 都留着，下次
	 * launch 按 profile 目录重连同一个实例，登录态与标签页都还在。只有
	 * `terminate: true`（面板上的「关闭浏览器」、host 卸载）才真的关窗；profile
	 * 仍然保留在临时目录里，重开时接着用。外部浏览器（显式 CDP_URL 连上的）永远
	 * 只断开，不代替用户关掉它自己的窗口。
	 */
	async close({ terminate = false } = {}) {
		if (this.lastRemoved) {
			for (const pick of this.lastRemoved.picks) this._deleteShot(pick);
			this.lastRemoved = null;
		}
		for (const pick of this.retired) this._deleteShot(pick);
		this.retired = [];
		// 与运行期一致走 sync() 唯一同步口：先置 off，再由 _applyMode 广播
		// {mode,count}；旧版 overlay 没有 sync，由 REV 接管机制兜底。
		this.state.mode = 'off';
		await this._applyMode(null);
		this.attached.clear();
		this.activeTargetId = null;
		const cdp = this.cdp;
		const proc = this.proc;
		const wasExternal = this.external;
		const profileDir = this.profileDir;
		this.cdp = null;
		this.adopted = false;
		this.external = false;
		this.attachBase = null;
		this.proc = null;
		if (terminate && !wasExternal) {
			if (cdp) {
				// 自己起的窗口、以及早先被接管的同一个 profile，都走同一条退出路径；
				// 竞一个短超时，别让卡住的连接把面板拖住。
				await Promise.race([cdp.send('Browser.close').catch(() => {}), sleep(2500)]);
			} else if (!proc && this.windowProfileDir) {
				// 上一轮已经断开：重连一次，才能把留在那儿的那个实例关掉。
				await this._closeDetachedWindow(this.windowProfileDir);
			}
			if (proc) {
				if (this.exitPromise) await this.exitPromise.catch(() => {});
				try {
					proc.kill();
				} catch {
					/* already gone */
				}
			}
			this.windowKept = false;
			this.windowProfileDir = null;
			this.profileDir = profileDir;
			await this._cleanupProfile();
			this.profileDir = null;
		} else if (cdp && !wasExternal) {
			// 窗口留着：记下它的 profile 目录，下次 launch 直接接管，也能响应显式关闭。
			this.windowKept = true;
			this.windowProfileDir = profileDir ?? this.windowProfileDir;
		}
		try {
			cdp?.close();
		} catch {
			/* already gone */
		}
		this.exitPromise = null;
		this.profileDir = null;
		this.activeBaseDir = null;
		if (this.state.status !== 'error') this.state.status = 'idle';
		this.state.mode = 'off';
		this._emit();
		return this.snapshot();
	}

	/** Close a window left running by an earlier close(): reconnect, ask it to quit. */
	async _closeDetachedWindow(profileDir) {
		const endpoint = await this._readDevToolsEndpoint(profileDir, 0);
		if (!endpoint) return;
		let cdp = null;
		try {
			cdp = new CdpWs(endpoint, 'browser');
			await cdp.open;
			await cdp.send('Browser.getVersion');
			await Promise.race([cdp.send('Browser.close').catch(() => {}), sleep(2500)]);
		} catch {
			/* the window is already gone */
		} finally {
			try {
				cdp?.close();
			} catch {
				/* already gone */
			}
		}
	}
}
