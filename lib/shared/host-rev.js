/**
 * Build-revision sync contracts as pure functions.
 *
 * Three revision markers guard code that leaves this repo:
 *
 * - `HOST_REV = 'vN-...'` (lib/index.js) must bump whenever lib/client.js
 *   changes: the GUI uses the prefix to force-refresh the panel script.
 * - `PANEL_BUILD = 'vN'` (lib/client.js) must equal the HOST_REV prefix, or
 *   the panel warns about a build skew that does not exist.
 * - `var REV = N` inside OVERLAY_SCRIPT (lib/overlay.js) must bump whenever
 *   the injected payload changes: the script is injected twice per document
 *   (preload + evaluate), so a newer build must dispose the older instance
 *   instead of leaving stale listeners in charge for the page's life.
 *
 * Everything here is pure string/patch logic; the git plumbing lives in
 * scripts/check-build-sync.mjs so tests can feed fixtures instead of a repo.
 */

const HOST_REV_RE = /HOST_REV\s*=\s*'v(\d+)-'/;
const PANEL_BUILD_RE = /PANEL_BUILD\s*=\s*'([^']+)'/;
const OVERLAY_REV_RE = /\bvar\s+REV\s*=\s*(\d+)/;

/** @returns {{value: string, prefix: string, number: number} | null} */
export function parseHostRev(source) {
	const match = HOST_REV_RE.exec(source ?? '');
	if (!match) return null;
	return { value: `v${match[1]}-`, prefix: `v${match[1]}`, number: Number(match[1]) };
}

/** @returns {string | null} the PANEL_BUILD literal, e.g. 'v28'. */
export function parsePanelBuild(source) {
	const match = PANEL_BUILD_RE.exec(source ?? '');
	return match ? match[1] : null;
}

/** @returns {number | null} the overlay takeover revision. */
export function parseOverlayRev(source) {
	const match = OVERLAY_REV_RE.exec(source ?? '');
	return match ? Number(match[1]) : null;
}

/**
 * Static half of the contract: all three markers present and in agreement.
 * @returns {{ok: boolean, problems: {code: string, message: string}[]}}
 */
export function checkStaticBuildSync({ hostSource, clientSource, overlaySource }) {
	const problems = [];
	const hostRev = parseHostRev(hostSource);
	if (!hostRev) {
		problems.push({ code: 'host-rev-missing', message: "lib/index.js 缺少形如 HOST_REV = 'vN-' 的版本标记" });
	}
	const panelBuild = parsePanelBuild(clientSource);
	if (!panelBuild) {
		problems.push({ code: 'panel-build-missing', message: "lib/client.js 缺少形如 PANEL_BUILD = 'vN' 的版本标记" });
	}
	if (hostRev && panelBuild && hostRev.prefix !== panelBuild) {
		problems.push({
			code: 'prefix-mismatch',
			message: `HOST_REV 前缀 ${hostRev.prefix} 与 PANEL_BUILD ${panelBuild} 不一致：面板会误报版本错位`,
		});
	}
	if (parseOverlayRev(overlaySource) === null) {
		problems.push({
			code: 'overlay-rev-missing',
			message: 'lib/overlay.js 的 OVERLAY_SCRIPT 里缺少形如 var REV = N 的接管版本',
		});
	}
	return { ok: problems.length === 0, problems };
}

/**
 * 1-based line ranges of the injected payload zone in overlay.js: the
 * BINDING_NAME export (interpolated into the template) and the String.raw
 * literal itself. Comment-only changes outside these ranges do not need a REV
 * bump. Returns [] when the markers cannot be located.
 * @returns {{start: number, end: number}[]}
 */
export function overlayPayloadRanges(source) {
	const lines = String(source ?? '').split('\n');
	const ranges = [];
	const bindingLine = lines.findIndex((line) => /export\s+const\s+BINDING_NAME\b/.test(line));
	if (bindingLine >= 0) ranges.push({ start: bindingLine + 1, end: bindingLine + 1 });
	let templateEnd = -1;
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		if (/`;\s*$/.test(lines[i])) {
			templateEnd = i + 1;
			break;
		}
	}
	const templateStart = lines.findIndex((line) => /String\.raw`/.test(line));
	if (templateStart >= 0 && templateEnd > templateStart) {
		ranges.push({ start: templateStart + 1, end: templateEnd });
	}
	return ranges;
}

/**
 * New-file line ranges covered by each @@ hunk of a unified diff (git show).
 * @returns {{start: number, end: number}[]}
 */
export function diffHunkNewRanges(patch) {
	const ranges = [];
	for (const match of String(patch ?? '').matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
		const start = Number(match[1]);
		const count = match[2] === undefined ? 1 : Number(match[2]);
		if (count === 0) {
			// "inserted before this line": pin it to the neighbouring line so
			// pure insertions still register as a touch.
			ranges.push({ start: Math.max(1, start), end: Math.max(1, start) });
		} else {
			ranges.push({ start, end: start + count - 1 });
		}
	}
	return ranges;
}

/** True when any hunk range intersects any target range. */
export function hunksTouchRanges(hunks, ranges) {
	return ranges.some((range) => hunks.some((hunk) => hunk.start <= range.end && hunk.end >= range.start));
}
