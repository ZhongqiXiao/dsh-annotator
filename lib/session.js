/**
 * Owns one visible Chrome/Edge window driven over the CDP pipe, keeps the picks
 * the page overlay reports, and writes element screenshots to disk.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CdpWs } from './cdp.js';
import { BINDING_NAME, OVERLAY_SCRIPT } from './overlay.js';
import { classifyBindingAction } from './shared/binding-action.js';
import { advancePendingConsume, popLastPick } from './shared/pick-actions.js';
import { isGuiPage } from './shared/gui-page.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How many consumed/cleared picks keep answering /pick before they fall off. */
const MAX_RETIRED = 200;

const WIN_CANDIDATES = {
	chrome: [
		process.env.DSH_VISUAL_ANNOTATOR_CHROME,
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
		path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
	],
	edge: [
		process.env.DSH_VISUAL_ANNOTATOR_EDGE,
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
	],
};

const MAC_CANDIDATES = {
	chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
	edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
};

const LINUX_CANDIDATES = {
	chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
	edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
};

function candidatesFor(browser) {
	if (process.platform === 'win32') return WIN_CANDIDATES[browser] ?? [];
	if (process.platform === 'darwin') return MAC_CANDIDATES[browser] ?? [];
	return LINUX_CANDIDATES[browser] ?? [];
}

export function resolveBrowserExecutable(browser = 'chrome') {
	for (const candidate of candidatesFor(browser === 'edge' ? 'edge' : 'chrome')) {
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
	for (const browser of ['chrome', 'edge']) out[browser] = resolveBrowserExecutable(browser);
	return out;
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

export class VisualPicker {
	constructor(options = {}) {
		this.tmpDir = path.join(os.tmpdir(), 'dsh-visual-annotator');
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
		};
		this.cdp = null;
		this.proc = null;
		this.adopted = false;
		this.attached = new Map();
		this.activeTargetId = null;
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
		return {
			status: this.state.status,
			error: this.state.error,
			browser: this.state.browser,
			executable: this.state.executable,
			activeUrl: this.state.activeUrl,
			activeTitle: this.state.activeTitle,
			mode: this.state.mode,
			baseDir: this.activeBaseDir ?? this.baseDir,
			browsers: availableBrowsers(),
			tabs: (this.state.tabs ?? []).map((tab) => ({ ...tab, active: tab.targetId === this.activeTargetId })),
			picks: this.state.picks.map((pick) => this._publicPick(pick)),
			pendingConsume: this.state.pendingConsume,
			// Inserted picks leave the list but stay resolvable: their chips expand at
			// submit time, which can be minutes after the insert.
			archived: this.retired.length,
		};
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

	get running() {
		return this.state.status === 'ready' && this.cdp !== null && !this.cdp.closed;
	}

	async launch({ url, browser = 'chrome', cwd, cleanProfile } = {}) {
		if (this.running) {
			// Relaunching with no (or a blank) URL must not wipe the page the
			// user is annotating; an explicit URL still navigates.
			if (url && url !== 'about:blank') await this.navigate(url);
			return this.snapshot();
		}
		await this.close();
		// Per-launch base dir: never mutate the default, or one session's cwd
		// would leak its shots/profile into later launches. close() restores it.
		this.activeBaseDir = cwd && path.isAbsolute(cwd) ? path.join(cwd, '.dsh-visual-annotator') : null;
		this.profilePerLaunch = this.activeBaseDir !== null;
		this.profileDir = null;
		this.cleanProfile = cleanProfile === undefined ? null : cleanProfile === true;
		const baseDir = this.activeBaseDir ?? this.baseDir;
		const executable = resolveBrowserExecutable(browser);
		if (!executable) {
			this.state.status = 'error';
			this.state.error = `未找到 ${browser} 可执行文件`;
			this._emit();
			return this.snapshot();
		}
		const profileDir = path.join(baseDir, `profile-${browser}`);
		fs.mkdirSync(profileDir, { recursive: true });
		fs.mkdirSync(path.join(baseDir, 'shots'), { recursive: true });
		this.profileDir = profileDir;
		this.state.status = 'starting';
		this.state.error = null;
		this.state.browser = browser;
		this.state.executable = executable;
		this._emit();
		// A browser for this profile may already be alive (host restart, earlier
		// panel session). Adopt it instead of spawning a duplicate: Chrome holds
		// a per-profile singleton, so a second spawn would just hand its URL to
		// the old instance and die with "pipe closed" — the duplicate-window bug.
		if (await this._tryAdopt(profileDir, browser)) {
			this.state.status = 'ready';
			if (url && url !== 'about:blank') await this.navigate(url);
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
				this._emit();
			}
		});
		this.proc = proc;
		try {
			await this._connectWithRetry(profileDir, browser, 12000);
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
			await this._seedTabs();
			this._emit();
		} catch (error) {
			const message = String(error?.message ?? error);
			if (!this._retried && /pipe closed|exited|closed|timeout|websocket|DevToolsActivePort/i.test(message)) {
				// Two recoverable cases: (1) a singleton handoff — our spawn
				// forwarded the URL to a live instance and exited, and that
				// instance owns a debug port we can adopt; (2) a lingering
				// profile lock from an instance that just died — retry spawn.
				this._retried = true;
				await sleep(800);
				if (await this._tryAdopt(profileDir, browser)) {
					this._retried = false;
					this.state.status = 'ready';
					if (url && url !== 'about:blank') await this.navigate(url);
					this._emit();
					return this.snapshot();
				}
				await this.close();
				await sleep(1500);
				return this.launch({ url, browser, cwd });
			}
			this._retried = false;
			this.state.status = 'error';
			this.state.error = message;
			this._emit();
		}
		return this.snapshot();
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
			this.activeBaseDir = this.profilePerLaunch ? path.dirname(profileDir) : this.activeBaseDir;
			this.cdp = cdp;
			this.adopted = true;
			this.proc = null;
			this.exitPromise = null;
			this.cdp.onEvent((message) => this._onCdpEvent(message));
			const pages = await this._waitForPage(6000);
			for (const page of pages) await this._attach(page.targetId).catch(() => {});
			const candidates = [...pages].reverse();
			const preferred =
				candidates.find((page) => page.url && page.url !== 'about:blank' && !this._isGuiPage(page.url, page.title)) ??
				candidates.find((page) => page.url && page.url !== 'about:blank') ??
				pages[0];
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

	/** See lib/shared/gui-page.js — kept as a method for internal call sites. */
	_isGuiPage(url, title) {
		return isGuiPage(url, title);
	}

	async _waitForPage(timeoutMs = 20000) {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const result = await this.cdp.send('Target.getTargets');
			const pages = (result.targetInfos ?? []).filter((info) => info.type === 'page');
			if (pages.length) return pages;
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
				if (info?.targetInfo) this._upsertTab(info.targetInfo);
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

	_upsertTab(info) {
		const tabs = (this.state.tabs ?? []).filter((tab) => tab.targetId !== info.targetId);
		tabs.push({ targetId: info.targetId, url: info.url ?? '', title: info.title ?? '' });
		this.state.tabs = tabs;
		this._emit();
	}

	/** Pages that already exist when we connect never fire targetCreated. */
	async _seedTabs() {
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
		try {
			const result = await this.cdp.send(
				'Page.captureScreenshot',
				{
					format: 'png',
					clip,
					captureBeyondViewport: true,
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

	async navigate(url) {
		if (!this.running) return this.snapshot();
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
			this._emit();
			return this.snapshot();
		}
		// New URL -> a NEW TAB in the SAME window (multi-tab, never a new window).
		const { targetId } = await this.cdp.send('Target.createTarget', { url, background: false });
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

	async close() {
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
		if (this.cdp) {
			// This profile is ours alone, so closing the browser is correct for
			// both transports (spawned or adopted). Race a short timeout so a
			// wedged connection cannot hang the panel.
			await Promise.race([this.cdp.send('Browser.close').catch(() => {}), sleep(2500)]);
			try {
				this.cdp.close();
			} catch {
				/* already gone */
			}
		}
		this.cdp = null;
		this.adopted = false;
		if (this.proc) {
			try {
				this.proc.kill();
			} catch {
				/* already gone */
			}
		}
		this.proc = null;
		if (this.exitPromise) {
			await this.exitPromise.catch(() => {});
			this.exitPromise = null;
			await sleep(400);
		} else {
			// WS mode: give the browser a beat to exit and release the profile.
			await sleep(400);
		}
		if (this.profileDir) {
			// A leftover DevToolsActivePort points at a dead port and would make
			// the next launch adopt (or trust) a stale endpoint.
			try {
				fs.rmSync(path.join(this.profileDir, 'DevToolsActivePort'), { force: true });
			} catch {
				/* best effort */
			}
		}
		await this._cleanupProfile();
		this.activeBaseDir = null;
		if (this.state.status !== 'error') this.state.status = 'idle';
		this.state.mode = 'off';
		this._emit();
		return this.snapshot();
	}
}
