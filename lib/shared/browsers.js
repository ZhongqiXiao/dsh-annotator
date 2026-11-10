/**
 * Which browsers this plugin can drive, how to name them, and which one to
 * offer first.
 *
 * Pure data + helpers only: executable discovery is fs/env work and stays in
 * `lib/session.js`, so the host can import this module without side effects and
 * a unit test can pin the registry. The panel does not import it — it receives
 * `browserOrder` / `browserLabels` from the host snapshot, so both halves can
 * never disagree about ids or display names.
 *
 * Why `ego`: ego lite (Citro Labs) is a Chromium fork that honours the same
 * `--user-data-dir` + `--remote-debugging-port=0` contract as Chrome, so the
 * existing CDP pipeline drives it unchanged.
 */

/** Stable ids, in default preference order. */
export const BROWSER_IDS = ['chrome', 'edge', 'ego'];

export const BROWSER_LABELS = {
	chrome: 'Chrome',
	edge: 'Edge',
	ego: 'ego lite',
};

/** Env var that overrides the executable path for one browser. */
export const BROWSER_ENV = {
	chrome: 'DSH_VISUAL_ANNOTATOR_CHROME',
	edge: 'DSH_VISUAL_ANNOTATOR_EDGE',
	ego: 'DSH_VISUAL_ANNOTATOR_EGO',
};

export function isBrowserId(value) {
	return typeof value === 'string' && BROWSER_IDS.includes(value);
}

/** Unknown / missing ids fall back (chrome by default) so old payloads keep working. */
export function normalizeBrowserId(value, fallback = 'chrome') {
	return isBrowserId(value) ? value : fallback;
}

export function browserLabel(value) {
	return BROWSER_LABELS[normalizeBrowserId(value)];
}

/**
 * First registered browser that is actually installed, honouring an explicit
 * preference when that browser is available too. `available` maps id -> path or
 * null (the shape of `/state.browsers`). Returns null when nothing is installed.
 */
export function defaultBrowserId(available = {}, preferred = null) {
	if (isBrowserId(preferred) && available?.[preferred]) return preferred;
	for (const id of BROWSER_IDS) if (available?.[id]) return id;
	return null;
}

export const SANDBOX_FALLBACK_ENV = 'DSH_VISUAL_ANNOTATOR_SANDBOX_FALLBACK';

/**
 * Decide whether a launch that just crashed should be retried once with
 * `--no-sandbox`.
 *
 * Why this exists: when the host already runs inside a seatbelt/sandbox of its
 * own (DSH Desktop's agent sandbox, CI sandboxes, some IDE terminals), Chrome's
 * own sandbox cannot be installed and the *browser* process dies immediately
 * with SIGTRAP. The CDP socket still completes its handshake and then closes,
 * which surfaces far away as "chrome connection is closed". Chrome does start
 * fine with `--no-sandbox` there, so the honest fix is: detect that exact
 * signature, retry once, and say so — instead of making every caller remember
 * an environment variable.
 *
 * The retry is deliberately narrow: only when we spawned the process ourselves,
 * only once, only on a crash signature, and never for browsers that ship the
 * flag already (ego lite passes its own `--no-sandbox`).
 */
export function shouldTrySandboxFallback({ alreadyNoSandbox, optOut, crashed } = {}) {
	if (crashed !== true) return false;
	if (alreadyNoSandbox === true) return false;
	return optOut !== true;
}

/** Installed ids, in preference order — handy for the panel's browser picker. */
export function availableBrowserIds(available = {}) {
	return BROWSER_IDS.filter((id) => Boolean(available?.[id]));
}

/**
 * 选择器要显示的全部浏览器（含没装的那些）。
 *
 * 面板早先只列「装了」的浏览器，结果这台机器没装 Edge 时，用户看到的选择器里
 * 根本不存在 Edge，很自然会以为插件漏做了 Edge 支持。把未安装项也列出来（禁用 +
 * 标注），「支持但没装」和「不支持」就分得清了。
 */
export function browserChoices(available = {}, order = BROWSER_IDS) {
	return order.map((id) => ({
		id,
		label: BROWSER_LABELS[id] ?? id,
		available: Boolean(available?.[id]),
	}));
}

/** Env var holding extra Chromium switches for the spawned browser. */
export const BROWSER_ARGS_ENV = 'DSH_VISUAL_ANNOTATOR_BROWSER_ARGS';

/**
 * 是否允许接管用户已经开着的 ego lite（设 '0' 关掉）。
 *
 * 默认开：用户的 ego lite 里已经有登录态和书签，另起一个空 profile 的实例只会让
 * 人再登一次。关掉的用处是测试要可预测、以及「我不想让插件碰我日常的浏览器」。
 */
export const ADOPT_RUNNING_ENV = 'DSH_VISUAL_ANNOTATOR_ADOPT_RUNNING';

/**
 * Extra command-line switches for every spawn, e.g. `--no-sandbox` when the host
 * itself runs inside a sandbox that blocks Chrome's own sandbox (the renderer
 * otherwise dies with SIGTRAP and the CDP socket closes right after handshake).
 *
 * Only `--flag` / `--flag=value` tokens survive: a stray word here would be read
 * by Chromium as a URL to open, which is never what the caller meant.
 */
export function parseExtraArgs(raw) {
	if (typeof raw !== 'string') return [];
	return raw
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter((item) => item.startsWith('--') && item.length > 2);
}
