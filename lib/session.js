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
import { decideAutoPick, nextUserTurnedOff } from './shared/auto-pick.js';
import { annotationMarkdown } from './shared/annotation-markdown.js';
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
	windowArgs,
} from './shared/browsers.js';
import { externalCandidates, parseVersionReply } from './shared/cdp-endpoint.js';
import {
	EGO_CONFIG_FILE,
	isEgoBrowserCommand,
	isEgoFirstRunDone,
	isEgoOnboardingTarget,
	listeningPortsByPid,
	withEgoFirstRunDone,
} from './shared/ego.js';
import { advancePendingConsume, popLastPick } from './shared/pick-actions.js';
import { isDuplicatePick, pickSignature } from './shared/pick-dedupe.js';
import {
	clearPairTo,
	delegationSummary,
	firstUnpairedTarget,
	pairAllUnpaired,
	pairIdsOf,
	pairTo,
	setPairIds,
	unpair,
	unpairAll,
	normalizeSpec,
	pageHudInfo,
	pageKeyOf,
	pagePickCounts,
	pickRoleOf,
	refLabelOf,
	refLabelsOf,
	SPEC_DIMENSIONS,
} from './shared/page-roles.js';
import { cropPng, readPngSize } from './shared/png.js';
import { isGuiPage } from './shared/gui-page.js';
import { scratchDir } from './shared/scratch-dir.js';
import { mergeTab } from './shared/tabs.js';
import { normalizeAddress } from './shared/url.js';

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
			// 页面角色表（目标 0..1 / 参考 0..5 / 中性）。pick 通过 pageKey 继承它，
			// 因此改一次页面角色就能一次改写那一页所有标注，不必逐条点。
			pages: [],
			// Monotonic token bumped when the in-page HUD asks the panel to insert
			// everything; the panel compares tokens so one request inserts exactly once.
			pendingConsume: 0,
			// 武装落位（面板「＋ 新增改动 / ＋ 添加参照」经 /arm 下发）：记录下一处标注
			// 应落的栏与目标。host 收到拾取时据此判断「点到的是不是已标注的元素」，
			// 是就复用那一条（改角色、按需配对），而不是再造一张同元素的重复标注卡。
			arming: null,
			// 最近一次「复用已标注」通知：列表不会增长，面板靠它清武装色条并提示。
			reuseNotice: null,
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
		this.autoPickEnabled = process.env.DSH_VISUAL_ANNOTATOR_AUTO_PICK !== '0';
		this.userTurnedOff = false;
		// 窗口与 profile 都留在磁盘上反复用：断开只丢 socket，下次 launch 按这个目录重连。
		this.windowKept = false;
		this.windowProfileDir = null;
		this.attached = new Map();
		// 每个标签页的标注层是否真的在里面。新标签页只靠 Target.targetCreated 挂一次，
		// attach 或注入失败过一次就永久没有 HUD（用户看到的是「第二个标签页没有 HUD，
		// 快捷键也没反应」），所以这里记状态，由 refreshTabs 定期补挂与补注入。
		this.overlayOk = new Map();
		this.preloadDone = new Set();
		this.overlayTriedAt = new Map();
		this.attachTriedAt = new Map();
		this.activeTargetId = null;
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
			// 标签条 = 这个窗口里的全部页面。ego lite 不再分「空间」，所以这里也不再按
			// context 过滤：看得见的页面就该在标签条里，少一条都算丢页面。
			tabs: (this.state.tabs ?? []).map((tab) => ({
				...tab,
				active: tab.targetId === this.activeTargetId,
				// false = 这一页里没有标注层（host 会继续重试），面板据此标一个警示点，
				// 不然用户只能看到「HUD 没出来」而不明白为什么。
				hud: this.overlayOk.get(tab.targetId) !== false,
			})),
			// 页面条：只是标注出处（哪一页、几处、R 几）。角色不在页面上，面板
			// 也不用再自己推导一遍——picks[].role 是唯一权威。
			pages: this.pageList(),
			// 当前活动页的 key：面板用它高亮页面条里的那一枚 chip。
			activePageKey: pageKeyOf(this.state.activeUrl),
			// 参考集合的确定性委托摘要（不调模型）；用户可编辑后再插入。
			summary: delegationSummary({ picks: this.state.picks, activeTitle: this.state.activeTitle }),
			picks: this.state.picks.map((pick) => this._publicPick(pick)),
			pendingConsume: this.state.pendingConsume,
			// 武装落位与复用通知：面板据此同步色条状态、提示「点的是旧标注不是新标了一条」。
			arming: this.state.arming,
			reuseNotice: this.state.reuseNotice,
			// Inserted picks leave the list but stay resolvable: their chips expand at
			// submit time, which can be minutes after the insert.
			archived: this.retired.length,
		};
	}

	/** The one public shape of a pick, shared by /state, /pick and the agent tool. */
	_publicPick(pick) {
		const pageKey = pick.pageKey || pageKeyOf(pick.url);
		const role = pickRoleOf(pick);
		const spec = normalizeSpec(pick.spec);
		return {
			id: pick.id,
			seq: pick.seq,
			comment: pick.comment,
			selector: pick.selector,
			tag: pick.tag,
			text: pick.text,
			// 文案改写三件套：真实字数、是否被采集上限截断、「这条是不是只改文字」。
			// 少了 textLength，面板与提示词就分不清「全文就这么长」和「只采到前 4000 字」。
			textLength: Number(pick.textLength) > 0 ? Number(pick.textLength) : String(pick.text ?? '').length,
			textTruncated: pick.textTruncated === true,
			textEdit: pick.textEdit === true,
			wantedText: String(pick.wantedText ?? ''),
			html: pick.html,
			rect: pick.rect,
			pageRect: pick.pageRect,
			url: pick.url,
			title: pick.title,
			ts: pick.ts,
			shotPath: pick.shotPath ?? null,
			shotUrl: pick.shotPath ? `/api/visual-annotator/shot?id=${encodeURIComponent(pick.id)}` : null,
			// 参考模式：角色、参考维度、「本次包含」。角色是标注自己的字段
			// （高于页面），R 编号按参照标注首次出现的页序派生，见 shared/page-roles.js。
			role,
			roleSource: pick.roleSource === 'user' || pick.roleSource === 'landing' ? pick.roleSource : 'auto',
			pageKey,
			pageTitle: pick.pageTitle ?? pick.title ?? '',
			refLabel: role === 'reference' ? refLabelOf(this.state.picks, pageKey) || 'R' : '',
			spec,
			included: pick.included !== false,
			referencedAt: pick.referencedAt ?? null,
			resend: role === 'reference' && pick.included === true && Boolean(pick.referencedAt),
			pageClosed: this._pageClosed(pageKey),
			// 目标标注参照的全部参考：面板靠它画「这条改动下面挂着哪几条参考」。
			pairIds: pairIdsOf(pick),
			pairId: pick.pairId == null ? null : String(pick.pairId),
		};
	}

	/**
	 * Panel-facing page list: every recorded page plus the active one. Pages carry
	 * provenance only (which URL, how many picks, which R-number); the role lives on
	 * each pick, so one page can legitimately be both 改动 and 参照 at once.
	 */
	pageList() {
		const activeKey = pageKeyOf(this.state.activeUrl);
		const labels = refLabelsOf(this.state.picks);
		// 计数走 shared 里那个带单测的纯函数，别再手写一遍 bucket 累加：两份口径一旦
		// 分叉，症状就是标签条写 3 条、HUD 写 2 处，用户不知道该信哪个。
		const shape = (page) => ({
			key: page.key,
			url: page.url,
			title: page.title,
			label: labels.get(page.key) || '',
			active: page.key === activeKey,
			closed: this._pageClosed(page.key),
			fullShot: page.fullShotPath ? `/api/visual-annotator/pageshot?key=${encodeURIComponent(page.key)}` : null,
			picks: pagePickCounts(this.state.picks, page.key),
		});
		const pages = this.state.pages.map(shape);
		// 当前页还没标注过时也在清单里：面板据此显示「本页 0 处」，标签条与出处
		// 用的是同一份地址，不需要用户再单独指定一次页面。
		if (activeKey && !pages.some((page) => page.key === activeKey)) {
			pages.push(shape({ key: activeKey, url: this.state.activeUrl, title: this.state.activeTitle }));
		}
		return pages;
	}

	/**
	 * Remember a page we have seen, so the panel can offer 设为目标/设为参考 before
	 * anything is annotated there. Only the active page and pages with picks are
	 * recorded: an untouched background tab is not part of the task yet.
	 */
	_touchPage(url, title) {
		const key = pageKeyOf(url);
		if (!key) return null;
		let page = this.state.pages.find((item) => item.key === key);
		if (!page) {
			page = { key, url: String(url ?? ''), title: String(title ?? '') };
			this.state.pages.push(page);
			return page;
		}
		if (url) page.url = String(url);
		if (title) page.title = String(title);
		return page;
	}

	/** A page counts as closed when no open tab carries its key any more. */
	_pageClosed(key) {
		if (!key) return false;
		const open = (this.state.tabs ?? []).some((tab) => pageKeyOf(tab.url) === key);
		if (open) return false;
		// 浏览器没连上时 tabs 为空：那不是「页面关了」，是没在跑。
		return this.state.tabs.length > 0;
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
		this.tabsRefreshedAt = 0;
		this.profilePerLaunch = false;
		this.profileDir = null;
		this.cleanProfile = cleanProfile === undefined ? null : cleanProfile === true;
		this.userTurnedOff = false;
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
			await this.setMode(decideAutoPick('launch', this), { trigger: 'auto' });
			if (url && url !== 'about:blank') await this.navigate(url);
			return this.snapshot();
		}
		// ego lite 优先复用用户已经开着的实例：既不会被新手引导挡住，也不会在用户
		// 面前多起一个带空 profile 的窗口。找不到再走下面自己启动的路。
		if (browserId === 'ego' && (await this._tryAttachRunningEgo(browserId))) {
			this.state.status = 'ready';
			this.state.error = null;
			this._emit();
			await this.setMode(decideAutoPick('launch', this), { trigger: 'auto' });
			// 用户自己的窗口不关引导：他要是正开着「欢迎使用 ego」，关掉就是抢他的窗口。
			if (url && url !== 'about:blank') await this.navigate(url);
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
		// ego：先把 `not_first_run` 写进 profile 再启动，否则它会先弹整窗的
		// 「欢迎使用 ego(𝘭𝘪𝘵𝘦)」引导，用户看到的就是「卡在欢迎界面」。必须在
		// spawn/adopt 之前——ego 只在启动那一瞬读这个文件。
		if (browserId === 'ego') this.ensureEgoNotFirstRun(profileDir);
		this.state.executable = executable;
		this._emit();
		// A browser for this profile may already be alive (host restart, earlier
		// panel session). Adopt it instead of spawning a duplicate: Chrome holds
		// a per-profile singleton, so a second spawn would just hand its URL to
		// the old instance and die with "pipe closed" — the duplicate-window bug.
		if (await this._tryAdopt(profileDir, browserId)) {
			this.state.status = 'ready';
			await this.setMode(decideAutoPick('launch', this), { trigger: 'auto' });
			if (url && url !== 'about:blank') await this.navigate(url);
			if (browserId === 'ego') await this._reportEgoOnboarding();
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
		else args.push(...windowArgs(browserId, process.env));
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
			if (url && url !== 'about:blank') {
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
			await this.setMode(decideAutoPick('launch', this), { trigger: 'auto' });
			await this._seedTabs();
			// 启动那一瞬的目标会被浏览器换掉（还是 about:blank，targetId 却换了）。
			// 返回 ready 之前先按真实情况对一次，别让第一个 snapshot 报出 0 或 2 个
			// 标签——面板第一次渲染就建在错的数据上，用户会看到一条空的标签条。
			await this.refreshTabs({ force: true }).catch(() => {});
			// ego：万一欢迎引导还是弹出来了（首启标记写不进去），只告警不关窗——
			// 关窗会带走整个浏览器进程，见 ensureEgoNotFirstRun。
			if (browserId === 'ego') await this._reportEgoOnboarding();
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
					await this.setMode(decideAutoPick('launch', this), { trigger: 'auto' });
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
			// 接回来的窗口里可能留着上一轮已经关掉的标签（事件发生在断开期间），
			// 同样按真实情况对一遍再报 ready。
			await this.refreshTabs({ force: true }).catch(() => {});
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

	/**
	 * 把 ego lite 的 profile 标记成「非首次运行」：写 `<profile>/ego_config.json` 的
	 * `not_first_run: true`。
	 *
	 * 为什么不能用关窗口来对付欢迎页：那一扇是 `browser_ui: chrome://onboarding/`，
	 * 没有 execution context（Runtime 拿不到文档、读不到按钮文案），Input 域也没实现
	 * （`Input.dispatchMouseEvent` → -32601），CDP 既点不动它；而 `Target.closeTarget`
	 * 在 ego lite 0.6.3.14 上会连带退出整个浏览器进程——实测即便另开一个 page 窗口并
	 * `Target.activateTarget` 激活它，关引导之后 Browser.getVersion 也不再应答。于是
	 * 每次 launch 都重演「弹欢迎 → 关 → 进程没了 → 重开 → 又弹欢迎」。
	 * 真正的开关是 ego 自己的首启标记文件，启动前写进去就不弹。
	 *
	 * @returns {boolean} true = 已标记/写入成功；false = 目录不可写（会记一条 warn）
	 */
	ensureEgoNotFirstRun(profileDir) {
		const file = path.join(profileDir, EGO_CONFIG_FILE);
		let current = null;
		try {
			current = JSON.parse(fs.readFileSync(file, 'utf8'));
		} catch {
			current = null; // 不存在、或内容坏掉，都当首次运行处理，重写成合法 JSON
		}
		if (isEgoFirstRunDone(current)) return true;
		try {
			// 跟着 ego 自己的 3 空格缩进写，免得每次启动都把文件重排一遍。
			fs.writeFileSync(file, JSON.stringify(withEgoFirstRunDone(current), null, 3));
			return true;
		} catch (error) {
			this.log?.('warn', `ego 首启标记写入失败（${file}）：${String(error?.message ?? error)}`);
			return false;
		}
	}

	/**
	 * 检查 ego 是否还是弹出了欢迎引导。这里**只告警、不关窗**（关窗会带走整个浏览器，
	 * 见 ensureEgoNotFirstRun 的说明）：正常路径上 `ego_config.json` 已经让它压根不弹，
	 * 走到这里说明那个文件写不进去，只能让用户点一次「开始使用」。
	 */
	async _reportEgoOnboarding() {
		if (!this.cdp) return;
		try {
			const { targetInfos = [] } = await this.cdp.send('Target.getTargets');
			const guide = targetInfos.find((info) => isEgoOnboardingTarget(info));
			if (!guide) return;
			this.log?.(
				'warn',
				'ego lite 仍弹出了首次运行引导窗口（ego_config.json 未能写入）：请在窗口里点一次「开始使用」，' +
					'插件已为调试开好页面。',
			);
		} catch {
			/* 取不到目标列表就没什么可说的 */
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
			// 接回来的窗口里可能留着上一轮已经关掉的标签（事件发生在断开期间），
			// 同样按真实情况对一遍再报 ready。
			await this.refreshTabs({ force: true }).catch(() => {});
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
		await this._ensureOverlay(targetId, sessionId, { preload: true });
		await this._applyMode(sessionId).catch(() => {});
		await this._syncActiveTarget(targetId, sessionId);
		// 挂上时页面可能仍在导航（标题还是空的）。等它落定后各对一次真实信息；
		// 有 load 事件的会先被 _onCdpEvent 那条路径刷新，这里兜住无事件的接管场景。
		this._refreshTabLater();
		return sessionId;
	}

	_refreshTabLater() {
		for (const delay of [300, 1200]) {
			const timer = setTimeout(() => void this.refreshTabs({ force: true }).catch(() => {}), delay);
			timer.unref?.();
		}
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
			this._touchPage(url, parsed.title ?? '');
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
			// HUD 上的落点开关：与面板按钮同一条语义，只是入口在页面里。
			else if (action === 'landing') void this._setLandingFromPage(payload.slot);
			return;
		}
		if (method === 'Page.loadEventFired') {
			// 导航会换掉整个文档：preload 正常时无需做什么，preload 没挂上（新标签页
			// 第一次 attach 恰好失败）时这里是唯一能把它救回来的时机。
			const targetId = this._targetOfSession(message.sessionId);
			if (targetId) void this._ensureOverlay(targetId, message.sessionId, { preload: true }).catch(() => {});
			void this._applyMode(message.sessionId);
			// 标题是页面加载后才有的：浏览器级 Target.targetInfoChanged 对新开/后台页
			// 并不保证送达（面板侧每秒 /state 轮询时靠 refreshTabs 兜住，但 host 自己没
			// 在轮询）。加载完主动对一次，标签条上的标题就不必等下一次轮询才回填。
			void this.refreshTabs({ force: true }).catch(() => {});
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
			this.overlayOk.delete(targetId);
			this.preloadDone.delete(targetId);
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
		const fingerprint = (tabs) => JSON.stringify((tabs ?? []).map((tab) => [tab.targetId, tab.url, tab.title]));
		const before = fingerprint(this.state.tabs);
		// 以 getTargets 为准对一遍，除了补新的，还要删掉已经不存在的：启动那一瞬
		// 的目标常常在开「发现」之前就被销毁，事件永远不会来，只增不删就会留一个
		// 「点不开的幽灵标签」——面板显示它还在，浏览器里其实早没了。
		const alive = new Set(targetInfos.map((info) => info.targetId));
		const gone = (this.state.tabs ?? []).filter((tab) => !alive.has(tab.targetId)).map((tab) => tab.targetId);
		if (gone.length) {
			this.state.tabs = (this.state.tabs ?? []).filter((tab) => alive.has(tab.targetId));
			for (const targetId of gone) {
				this.attached.delete(targetId);
				this.overlayOk.delete(targetId);
				this.preloadDone.delete(targetId);
				this.attachTriedAt.delete(targetId);
				if (this.activeTargetId === targetId) this.activeTargetId = null;
			}
		}
		for (const info of targetInfos) this._upsertTab(info, { emit: false });
		if (before !== fingerprint(this.state.tabs)) this._emit();
		// 新标签页原本只有 Target.targetCreated 一条命：事件漏了、或那一次 attach /
		// 注入失败，这个页就永远没有 HUD。轮询（面板每秒 /state）时补挂与补注入。
		for (const info of targetInfos) {
			if (!this.attached.has(info.targetId)) {
				if (now - (this.attachTriedAt.get(info.targetId) ?? 0) < 1500) continue;
				this.attachTriedAt.set(info.targetId, now);
				void this._attach(info.targetId).catch(() => {});
				continue;
			}
			if (this.overlayOk.get(info.targetId) !== false) continue;
			if (now - (this.overlayTriedAt.get(info.targetId) ?? 0) < 1500) continue;
			this.overlayTriedAt.set(info.targetId, now);
			const sid = this.attached.get(info.targetId);
			void this._ensureOverlay(info.targetId, sid, { preload: true }).catch(() => {});
		}
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

	/**
	 * 页面自己知道自己是不是参考页：这里按「这个标签页的 URL」算角色。
	 * 用 activeUrl 算的话，后台那个参考页会被推成目标页（文案「怎么改」、也没有蓝色
	 * 参考徽标），用户在同一套 HUD 上就会去改参考页。
	 */
	async _applyMode(sessionId = null, url = null) {
		if (!this.cdp) return;
		// 提示词只算一次：整份标注是同一份，逐个标签页重复生成只是白烧 CPU。
		const prompt = this.toMarkdown();
		const entries = sessionId ? [[this._targetOfSession(sessionId), sessionId]] : [...this.attached.entries()];
		for (const [targetId, sid] of entries) {
			if (!sid) continue;
			const info = JSON.stringify(
				pageHudInfo({
					url: url ?? this._urlOfTarget(targetId),
					picks: this.state.picks,
					// 落点决定「下一处会进哪一栏」，不是页面的多数票：HUD 说的是
					// 用户现在点下去会发生什么。
					landing: this.state.arming?.slot ?? null,
					mode: this.state.mode,
					specs: SPEC_DIMENSIONS,
					prompt,
				}),
			);
			await this._evaluate(`window.__DSH_VP__ && window.__DSH_VP__.sync(${info})`, sid).catch(() => {});
		}
	}

	/** Which tab a session belongs to (reverse of this.attached). */
	_targetOfSession(sessionId) {
		for (const [targetId, sid] of this.attached) if (sid === sessionId) return targetId;
		return null;
	}

	/** A tab's own address; falls back to the active page so unknown tabs keep old behaviour. */
	_urlOfTarget(targetId) {
		const tab = (this.state.tabs ?? []).find((item) => item.targetId === targetId);
		return tab?.url || this.state.activeUrl;
	}

	/**
	 * Make sure this tab really has the overlay: probe, and if it is missing inject and
	 * probe again. A swallowed failure here used to leave the tab permanently dead —
	 * no HUD, no ⌥A — with nothing in the panel saying why.
	 */
	async _ensureOverlay(targetId, sessionId, { preload = false } = {}) {
		if (!sessionId) return false;
		const probe = () =>
			this._evaluate(
				"JSON.stringify({vp: typeof window.__DSH_VP__, hud: !!document.getElementById('__dsh-vp-root')})",
				sessionId,
			);
		try {
			if (preload && !this.preloadDone.has(targetId)) {
				await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: OVERLAY_SCRIPT }, sessionId);
				this.preloadDone.add(targetId);
			}
			const first = await probe();
			const seen = JSON.parse(first?.result?.value ?? '{}');
			if (seen.vp === 'object') {
				// 脚本在、挂载点没了（页面自己清了 body）时补一次挂载即可，别整段重注入。
				if (!seen.hud)
					await this._evaluate(
						'window.__DSH_VP__ && window.__DSH_VP__.reattach && window.__DSH_VP__.reattach()',
						sessionId,
					);
				this._markOverlay(targetId, true);
				return true;
			}
			await this._evaluate(OVERLAY_SCRIPT, sessionId);
			const again = await probe();
			const ok = JSON.parse(again?.result?.value ?? '{}').vp === 'object';
			this._markOverlay(targetId, ok);
			return ok;
		} catch {
			this._markOverlay(targetId, false);
			return false;
		}
	}

	_markOverlay(targetId, ok) {
		if (!targetId) return;
		const before = this.overlayOk.get(targetId);
		this.overlayOk.set(targetId, ok);
		if (ok && before === false) this.log?.('info', `标签页 ${targetId} 的标注层已补上`);
		if (!ok && before !== false) this.log?.('warn', `标签页 ${targetId} 注入标注层失败，面板会继续重试`);
	}

	/**
	 * 当前落点：面板点过「＋ 新增改动 / ＋ 添加参照」后一直有效，直到再点一次取消
	 * （或 10 分钟没动静自己过期）。落点就是「下一处标注进哪一栏」，与页面无关。
	 */
	_landing() {
		const arming = this.state.arming;
		if (!arming) return null;
		if (Date.now() - (Number(arming.ts) || 0) > 10 * 60 * 1000) {
			// 过期也要广播：直接清 state 的话，面板的落点色条与 HUD 的颜色会一直亮到
			// 下一次快照，用户点下去才发现落点其实已经回落到「改动」。
			this.setArming(null);
			return null;
		}
		return arming;
	}

	/**
	 * 刚落的一处参照归到哪条改动：面板上点「＋ 添加参照」的那张改动卡优先
	 * （pairId 只生效一次），否则配给第一条还没配对的改动。边标边配，不用再点第二下。
	 */
	_pairFreshReference(role, pickId, landing) {
		if (role !== 'reference') return;
		const wanted = String(landing?.pairId ?? '');
		if (wanted) {
			this.setPair(wanted, pickId, { move: true });
			return;
		}
		const partner = firstUnpairedTarget(this.state.picks);
		if (partner && String(partner.id) !== String(pickId)) pairTo(this.state.picks, partner.id, pickId);
	}

	/** 落点粘住（连续标多处都进同一栏）；只有「配给某条改动」是一次性的。 */
	_settleLanding() {
		if (!this.state.arming) return;
		this.state.arming = { ...this.state.arming, pairId: '', ts: Date.now() };
	}

	async _recordPick(payload, sessionId) {
		const id = 'p' + ++this.seq;
		const url = payload.url ?? this.state.activeUrl;
		const title = payload.title ?? this.state.activeTitle;
		const page = this._touchPage(url, title);
		const pageKey = pageKeyOf(url);
		// 角色在这里当场定：面板上的落点（「＋ 新增改动 / ＋ 添加参照」）说了算，
		// 没有落点就是改动。页面只是出处，不再决定标注去哪一栏——按页面推、再由
		// 面板事后纠正，页签一多必然对不上，用户看到的就是「选的页签和标注不符」。
		const landing = this._landing();
		const role = landing ? landing.slot : 'target';
		const pick = {
			id,
			seq: payload.seq ?? this.seq,
			comment: payload.comment ?? '',
			selector: payload.selector ?? '',
			tag: payload.tag ?? '',
			text: payload.text ?? '',
			// 采集上限在页面脚本里把住（overlay 的 TEXT_CAP）：这里记下真实字数与截断标记，
			// 下游才不会把「前 4000 字」当成整段原文去替换。
			textLength: Number(payload.textLength) > 0 ? Number(payload.textLength) : String(payload.text ?? '').length,
			textTruncated: payload.textTruncated === true,
			textEdit: payload.textEdit === true,
			wantedText: String(payload.wantedText ?? ''),
			html: payload.html ?? '',
			rect: payload.rect ?? null,
			pageRect: payload.pageRect ?? null,
			url,
			title,
			ts: Date.now(),
			shotPath: null,
			sessionId,
			role,
			roleSource: landing ? 'landing' : 'auto',
			pageKey,
			pageTitle: page?.title || title || '',
			spec: normalizeSpec(payload.spec),
			included: true,
			referencedAt: null,
			// 目标标注参照哪几条参考标注（参考对照视图里挂在同一条目标下面）。
			// pairId 是 pairIds 的第一条，agent 工具契约只认它。
			pairIds: [],
			pairId: null,
		};
		// 页面脚本一次提交只应发一份，但旧版/多份注入脚本会让同一次提交投递多次，
		// 列表里就成了「三条一模一样的标注」。判重规则见 lib/shared/pick-dedupe.js。
		const signature = pickSignature(payload, this.state.activeUrl);
		const now = Date.now();
		if (isDuplicatePick({ signature: this.lastPickSignature, at: this.lastPickAt }, signature, now)) return;
		this.lastPickSignature = signature;
		this.lastPickAt = now;
		// 落点落在已经标过的元素上：复用那一条（改角色、按需配对），不再造一张
		// 同元素的重复标注卡。「改动也可以参照已标注的元素」——重复标一遍只会多出
		// 一张一模一样的卡，不是用户要的。同元素判定=同一页 + 同一选择器。
		if (landing) {
			const existing = this.state.picks.find(
				(candidate) =>
					(candidate.pageKey || pageKeyOf(candidate.url)) === pageKey &&
					String(candidate.selector ?? '') === String(payload.selector ?? ''),
			);
			if (existing) {
				if (existing.role !== role) this.setPickRole(existing.id, role);
				this._pairFreshReference(role, existing.id, landing);
				if (String(payload.comment ?? '').trim()) this.setComment(existing.id, payload.comment);
				this._settleLanding();
				this.state.reuseNotice = { pickId: existing.id, role, ts: Date.now() };
				this._emit();
				return this.snapshot();
			}
		}
		this.state.picks.push(pick);
		this._pairFreshReference(role, pick.id, landing);
		this._settleLanding();
		if (payload.title) this.state.activeTitle = payload.title;
		if (payload.url) this.state.activeUrl = payload.url;
		this._emit();
		// 页面 HUD 计数来自 host sync；先广播再截图，页面计数不会落后。
		await this._applyMode(null);
		// 截图要强制一帧并回读合成结果（CDP 往返）。和「卡片消失 + HUD 计数变化」落在同一帧时，
		// 用户看到的就是点完标注那一下轻微一抖：画面内容已经变了，合成面却还在读。往后挪一两百毫秒，
		// 让这一次卡顿落在已经静止的画面上，肉眼就看不到了。
		const captureTimer = setTimeout(() => void this._capture(pick, sessionId), 180);
		captureTimer.unref?.();
	}

	async _capture(pick, sessionId) {
		if (!this.cdp || !pick.pageRect) return;
		// 截图有两条踩过的坑，都是「用户看得见的画面被打断」：
		// 1) captureBeyondViewport:true 为了截到视口外内容，把渲染视口临时撑成整页再还原，
		//    页面收到 resize + 整页重排，就是「点完标注浏览器抖一下」。
		// 2) 带 clip 截图则相反，Chrome 会把合成面换成 clip 尺寸重渲染一帧再还原（实测约 60ms，
		//    screencast 抓到的中间帧尺寸正好等于 clip），肉眼就是一记闪屏。
		// 所以这里既不撑视口也不带 clip：只截当前视口，元素区域在 Node 侧用 lib/shared/png.js 裁。
		// 整视口截图对合成面的影响是「多推一帧内容相同的画面」，screencast 实测与静止帧逐像素相同。
		const viewport = await this.cdp.send('Page.getLayoutMetrics', {}, sessionId).catch(() => null);
		const visible = viewport?.cssLayoutViewport;
		if (!visible || !(visible.clientWidth > 0) || !(visible.clientHeight > 0)) return;
		const rect = pick.pageRect;
		// 元素 + 4px 边距，夹进当前视口；pageRect 与 cssLayoutViewport 都是页面坐标，相减即视口内偏移。
		const box = {
			x: Math.max(Math.round(rect.x) - 4, Math.floor(visible.pageX)),
			y: Math.max(Math.round(rect.y) - 4, Math.floor(visible.pageY)),
			right: Math.min(Math.round(rect.x + rect.width) + 4, Math.ceil(visible.pageX + visible.clientWidth)),
			bottom: Math.min(Math.round(rect.y + rect.height) + 4, Math.ceil(visible.pageY + visible.clientHeight)),
		};
		const width = box.right - box.x;
		const height = box.bottom - box.y;
		// 元素整个滚出视口时直接不给缩略图：退回整页截图就要重新撑视口，抖动会回来。
		if (width < 4 || height < 4) return;
		try {
			const result = await this.cdp.send(
				'Page.captureScreenshot',
				{
					format: 'png',
					captureBeyondViewport: false,
					// 缩略图只要看得清元素，速度优先：编码更快，占住渲染的时间更短。
					optimizeForSpeed: true,
				},
				sessionId,
			);
			if (!result?.data) return;
			const full = Buffer.from(result.data, 'base64');
			// 截图是设备像素（HiDPI 上是 2x），页面坐标是 CSS 像素，按「图宽 / 视口宽」换算。
			const size = readPngSize(full);
			const scale = size ? size.width / visible.clientWidth : 1;
			const cropped =
				scale > 0
					? cropPng(full, {
							x: Math.round((box.x - visible.pageX) * scale),
							y: Math.round((box.y - visible.pageY) * scale),
							width: Math.round(width * scale),
							height: Math.round(height * scale),
						})
					: null;
			const dir = path.join(this.activeBaseDir ?? this.baseDir, 'shots');
			fs.mkdirSync(dir, { recursive: true });
			const file = path.join(dir, `${pick.id}.png`);
			// 裁不出来（Chrome 换了 PNG 形态）就存整视口原图：宁可图大一点，也别丢缩略图。
			fs.writeFileSync(file, cropped ?? full);
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

	async setMode(mode, options = {}) {
		const nextMode = mode === 'pick' ? 'pick' : 'off';
		if (options.trigger !== 'auto') {
			this.userTurnedOff = nextUserTurnedOff(nextMode === 'pick' ? 'user-on' : 'user-off', this.userTurnedOff);
		}
		this.state.mode = nextMode;
		if (this.running) await this._applyMode(null);
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
		const existing = pages.find((info) => norm(info.url) === norm(url));
		if (existing) {
			await this.cdp.send('Target.activateTarget', { targetId: existing.targetId }).catch(() => {});
			await this._attach(existing.targetId);
			this.activeTargetId = existing.targetId;
			this.state.activeUrl = existing.url ?? url;
			this.state.activeTitle = existing.title ?? '';
			await this.setMode(decideAutoPick('open-page', this), { trigger: 'auto' });
			this._emit();
			return this.snapshot();
		}
		// New URL -> a NEW TAB in the SAME window (multi-tab, never a new window).
		const { targetId } = await this.cdp.send('Target.createTarget', { url, background: false });
		await this._attach(targetId);
		this.activeTargetId = targetId;
		this.state.activeUrl = url;
		await this.setMode(decideAutoPick('open-page', this), { trigger: 'auto' });
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
		await this.setMode(decideAutoPick('open-page', this), { trigger: 'auto' });
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
		// 删掉的可能是一条参考：指向它的目标会留下悬空 pairId，一并解开。
		clearPairTo(this.state.picks, removed.id);
		await this._afterRemoval([removed], false);
		return this.snapshot();
	}

	// 页面内 HUD 的「撤销」：只从尾部弹一条，复用面板同款单槽撤销语义。
	// 语义在 shared/pick-actions.js 的纯函数里（可单测），这里只做 host 侧副作用。
	async undoLastPick() {
		const popped = popLastPick(this.state.picks);
		if (!popped) return this.snapshot();
		this.state.picks = popped.remaining;
		clearPairTo(this.state.picks, popped.removed.id);
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
		if (!wanted.size) return { ...this.snapshot(), consumed: 0, referenced: 0 };
		const removed = [];
		// 参考标注插入后不离开列表：它们是可复用的只读规范，下次还可能再发。
		// 记录插入前的 included/referencedAt 快照，撤销一次插入要连这两个字段一起还原。
		const referenced = [];
		const keep = [];
		for (const pick of this.state.picks) {
			if (!wanted.has(String(pick.id))) {
				keep.push(pick);
				continue;
			}
			if (pickRoleOf(pick) === 'reference') {
				referenced.push({ pick, included: pick.included !== false, referencedAt: pick.referencedAt ?? null });
				pick.included = false;
				pick.referencedAt = Date.now();
				keep.push(pick);
				continue;
			}
			removed.push(pick);
		}
		this.state.picks = keep;
		if (!removed.length && !referenced.length) return { ...this.snapshot(), consumed: 0, referenced: 0 };
		await this._afterRemoval(removed, true, { referenced });
		return { ...this.snapshot(), consumed: removed.length, referenced: referenced.length };
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
	async _afterRemoval(removed, archive, extra = {}) {
		if (this.lastRemoved) for (const pick of this.lastRemoved.picks) this._deleteShot(pick);
		const referenced = extra.referenced ?? [];
		if (archive) {
			this._archive(removed);
			this.lastRemoved = { picks: removed, referenced };
		} else {
			this.lastRemoved = removed.length ? { picks: removed, referenced } : null;
		}
		this._emit();
		await this._applyMode(null);
	}

	/** Undo the last removePick(): splice the pick back in at its seq/id position. */
	restorePick() {
		const entry = this.lastRemoved;
		if (!entry) return { ...this.snapshot(), restored: 0 };
		this.lastRemoved = null;
		// 参考插入只是改了 included/referencedAt，标注本身还在列表里：先还原这两个
		// 字段，撤销一次「3 参考 + 2 目标」的插入才是完整复原。
		for (const item of entry.referenced ?? []) {
			const pick = this.state.picks.find((candidate) => candidate.id === item.pick.id);
			if (!pick) continue;
			pick.included = item.included;
			pick.referencedAt = item.referencedAt;
		}
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
		return { ...this.snapshot(), restored: entry.picks.length + (entry.referenced?.length ?? 0) };
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
	 * 期望文案：用户填了就等于说「这段文字要用它逐字替换」，所以顺手把 textEdit 打开；
	 * 清空只清文字，标记留给 setTextEdit——用户可能只是想撤掉自己写的新文案。
	 */
	setWantedText(id, wantedText) {
		const pick = this.state.picks.find((item) => item.id === String(id ?? ''));
		if (pick) {
			pick.wantedText = String(wantedText ?? '');
			if (pick.wantedText.trim()) pick.textEdit = true;
		}
		this._emit();
		return this.snapshot();
	}

	/** 把一条标注标成「改文案」（或取消）：面板快捷动作与页面卡片按钮共用同一条契约。 */
	setTextEdit(id, on) {
		const pick = this.state.picks.find((item) => item.id === String(id ?? ''));
		if (pick) pick.textEdit = on !== false;
		this._emit();
		return this.snapshot();
	}

	/**
	 * 换一条标注的角色：拖到另一栏、或落点落在一条已标过的元素上时走这里。
	 * roleSource='user' 记录「这是用户亲手定的」，之后换落点不会动它。
	 */
	setPickRole(id, role) {
		const pick = this.state.picks.find((item) => item.id === String(id ?? ''));
		if (!pick || (role !== 'target' && role !== 'reference'))
			return { ok: false, error: 'bad-pick-role', ...this.snapshot() };
		// 换角色等于换一侧：它自己挂在谁下面的关系先断，别人挂在它下面的关系也要断，
		// 否则会留下一条「目标参照一条目标」或指向不存在参考的悬空配对。
		if (pick.role !== role) setPairIds(pick, []);
		pick.role = role;
		pick.roleSource = 'user';
		if (role === 'target') pick.referencedAt = null;
		if (role === 'target') clearPairTo(this.state.picks, pick.id);
		this._emit();
		return { ok: true, ...this.snapshot() };
	}

	/**
	 * 配对：把一条参考标注挂到一条目标标注上（refId 传空=这条目标的参考全解开）。
	 * 改一处可以参照多处（版式照 A、配色照 B），所以这里是追加而不是覆盖；
	 * 已经挂着的重复挂不报错，拖拽来回放不会产生重复行。
	 */
	setPair(targetId, refId, options = {}) {
		const target = this.state.picks.find((item) => item.id === String(targetId ?? ''));
		if (!target) return { ok: false, error: 'pick-not-found', ...this.snapshot() };
		if (refId === null || refId === undefined || refId === '') {
			unpairAll(this.state.picks, target.id);
			this._emit();
			return { ok: true, ...this.snapshot() };
		}
		const ref = this.state.picks.find((item) => item.id === String(refId));
		if (!ref || pickRoleOf(ref) !== 'reference')
			return { ok: false, error: 'bad-pair', message: '只有归到参照栏的标注才能挂到改动上', ...this.snapshot() };
		if (String(ref.id) === String(target.id))
			return { ok: false, error: 'bad-pair', message: '一条标注不能参照它自己', ...this.snapshot() };
		// move：这条参考只归这一条目标。落点标注时用——host 已经把它自动配给了
		// 「第一条没配的目标」，用户点的那一行才是真正的落点。
		if (options?.move) {
			for (const other of this.state.picks)
				if (String(other.id) !== String(target.id)) unpair(this.state.picks, other.id, ref.id);
		}
		pairTo(this.state.picks, target.id, ref.id);
		this._emit();
		return { ok: true, ...this.snapshot() };
	}

	/** 只解开一条：右栏参考卡上的小 ×（其余参考还挂在这条目标上）。 */
	unpair(targetId, refId) {
		const target = this.state.picks.find((item) => item.id === String(targetId ?? ''));
		if (!target) return { ok: false, error: 'pick-not-found', ...this.snapshot() };
		unpair(this.state.picks, target.id, refId);
		this._emit();
		return { ok: true, ...this.snapshot() };
	}

	/** 一条目标现在参照了哪几条参考（面板拖拽后刷新用）。 */
	pairStats() {
		const counts = new Map();
		for (const pick of this.state.picks) for (const id of pairIdsOf(pick)) counts.set(id, (counts.get(id) ?? 0) + 1);
		return counts;
	}

	/**
	 * 一条参考套用到所有还没配对的目标：同一条规范（配色、圆角）常常要落到好几处，
	 * 逐条点下拉太慢。已经配过的目标不覆盖——那可能是用户特意挑的另一条参考。
	 */
	pairAll(refId) {
		const ref = this.state.picks.find((item) => item.id === String(refId ?? ''));
		if (!ref || pickRoleOf(ref) !== 'reference')
			return { ok: false, error: 'bad-pair', message: '只有归到参照栏的标注才能挂到改动上', ...this.snapshot() };
		const touched = pairAllUnpaired(this.state.picks, ref.id);
		this._emit();
		return { ok: true, paired: touched.length, ...this.snapshot() };
	}

	/**
	 * 落点由面板经 /arm 下发（slot=target/reference，传 null 取消）。host 有两处用它：
	 * 新标注当场归哪一栏，以及拾取落在已标过的元素上时该复用哪一栏。落点是粘性的，
	 * 所以「连续标五处参照」只需要点一次按钮；pairId 只对下一处生效。
	 */
	setArming(arming) {
		if (!arming || (arming.slot !== 'target' && arming.slot !== 'reference')) {
			this.state.arming = null;
			void this._applyMode(null);
			this._emit();
			return;
		}
		this.state.arming = { slot: arming.slot, pairId: arming.pairId ? String(arming.pairId) : '', ts: Date.now() };
		// 落点一变就得推给页面：HUD 的颜色与措辞说的就是「下一处进哪一栏」，不推的话
		// 用户在参照落点上仍看到橙色的「改动」，标下去就以为落错了栏。
		void this._applyMode(null);
		this._emit();
	}

	/**
	 * 页面 HUD 上的一键切换（⌥R / 点「改动·参照」开关）。换的只是下一处落点，
	 * 顺手进标注模式：按这个键的人下一步就是点元素，不该再让他回面板开一次。
	 */
	async _setLandingFromPage(slot) {
		this.setArming({ slot });
		if (this.state.mode !== 'pick') await this.setMode('pick');
	}

	/** 「本次包含」：只有勾着的标注会被插入；参考插入后自动取消，重勾=重发。 */
	setPickInclude(id, included) {
		const pick = this.state.picks.find((item) => item.id === String(id ?? ''));
		if (!pick) return { ok: false, error: 'pick-not-found', ...this.snapshot() };
		pick.included = Boolean(included);
		this._emit();
		return { ok: true, ...this.snapshot() };
	}

	/** 参考维度：布局/间距/配色/字体/字号/圆角/交互/文案，可多选。 */
	setPickSpec(id, spec) {
		const pick = this.state.picks.find((item) => item.id === String(id ?? ''));
		if (!pick) return { ok: false, error: 'pick-not-found', ...this.snapshot() };
		pick.spec = normalizeSpec(spec);
		this._emit();
		return { ok: true, ...this.snapshot() };
	}

	/**
	 * One-click clear. Picks move to the archive (chips still resolve) and stay
	 * restorable as one batch, screenshots included, until the undo slot is
	 * replaced or the window closes. Nothing to clear leaves the archive alone.
	 */
	async clear(scope = 'all', ids = null) {
		// 「清空」分三个口：目标（插入即消费，清空是补救）/ 参考（复用集清理）/ 全部。
		// ids 是面板勾选的多选清空：给了就只清这些 id，与 scope 取交集——勾选的永远是
		// 用户眼前那一栏里的条目，两个条件同时成立才下手，别让过期勾选误删别处。
		const wanted = scope === 'target' || scope === 'reference' ? scope : 'all';
		const wantedIds = Array.isArray(ids) ? new Set(ids.map(String)) : null;
		const match = (pick) =>
			(wanted === 'all' || pickRoleOf(pick) === wanted) && (!wantedIds || wantedIds.has(String(pick.id)));
		const cleared = this.state.picks.filter(match);
		if (!cleared.length) return { ...this.snapshot(), cleared: 0 };
		this.state.picks = this.state.picks.filter((pick) => !match(pick));
		for (const gone of cleared) clearPairTo(this.state.picks, gone.id);
		await this._afterRemoval(cleared, true);
		return { ...this.snapshot(), cleared: cleared.length };
	}

	shotFile(id) {
		const pick = this.state.picks.find((item) => item.id === id) ?? this.retired.find((item) => item.id === id);
		return pick?.shotPath && fs.existsSync(pick.shotPath) ? pick.shotPath : null;
	}

	/**
	 * 整页截图，按需触发（对比层的「整页」视图）。元素裁剪图只截视口，元素滚动出
	 * 视口就没有图；整页图要撑视口，用户会看到一次重排，所以绝不自动做，只由面板
	 * 按下「整页」时调一次，失败也让面板显示「重试」而不是默默空着。
	 */
	async capturePageShot(key) {
		if (!this.running) throw new Error('浏览器未运行');
		const wanted = String(key ?? '') || pageKeyOf(this.state.activeUrl);
		const page = this.state.pages.find((item) => item.key === wanted);
		if (!page) throw new Error('页面不在任务里');
		let targetId = null;
		for (const tid of this.attached.keys()) {
			const tab = (this.state.tabs ?? []).find((item) => item.targetId === tid);
			if (tab && pageKeyOf(tab.url) === wanted) {
				targetId = tid;
				break;
			}
		}
		if (!targetId) throw new Error('页面已关闭');
		let sessionId = this.attached.get(targetId);
		if (!sessionId) sessionId = await this._attach(targetId).catch(() => null);
		if (!sessionId) throw new Error('无法连接该页面');
		const metrics = await this.cdp.send('Page.getLayoutMetrics', {}, sessionId).catch(() => null);
		const size = metrics?.cssContentSize ?? metrics?.contentSize;
		if (!size || !(size.width > 0) || !(size.height > 0)) throw new Error('拿不到页面尺寸');
		const result = await this.cdp.send(
			'Page.captureScreenshot',
			{
				format: 'png',
				captureBeyondViewport: true,
				fromSurface: true,
				clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
			},
			sessionId,
		);
		if (!result?.data) throw new Error('整页截图失败');
		const dir = path.join(this.activeBaseDir ?? this.baseDir, 'page-shots');
		fs.mkdirSync(dir, { recursive: true });
		// 文件名由 pageKey 派生：同一页重复截只覆盖这一张，不在临时目录里堆垃圾。
		const name = Buffer.from(wanted).toString('base64url').slice(0, 48);
		const file = path.join(dir, name + '.png');
		fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
		page.fullShotPath = file;
		this._emit();
		return {
			ok: true,
			key: wanted,
			fullShot: `/api/visual-annotator/pageshot?key=${encodeURIComponent(wanted)}`,
		};
	}

	pageShotFile(key) {
		const page = this.state.pages.find((item) => item.key === String(key ?? ''));
		return page?.fullShotPath && fs.existsSync(page.fullShotPath) ? page.fullShotPath : null;
	}

	/**
	 * Markdown the panel injects into the composer / the agent tool returns.
	 * 与工具输出共用 lib/shared/annotation-markdown.js：两处各写一份时，面板那份曾经
	 * 漏掉「参照：」行，粘到别的 agent 里的提示词就丢了改动↔参照的对照关系。
	 */
	toMarkdown() {
		return annotationMarkdown(this.state.picks, {
			empty: '（当前还没有页面元素标注）',
			source: `${this.state.browser ?? 'browser'}：${this.state.activeUrl || '未知页面'}`,
		});
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
		// 页面角色表跟着 picks 走：关窗不清空标注（重开同一个窗口还看得见），
		// 所以角色与 pageKey 也一起留着，下次连上照旧解析。
		// 与运行期一致走 sync() 唯一同步口：先置 off，再由 _applyMode 广播
		// {mode,count}；旧版 overlay 没有 sync，由 REV 接管机制兜底。
		this.state.mode = 'off';
		this.userTurnedOff = false;
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
		this.userTurnedOff = false;
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
