/**
 * Where the plugin keeps its scratch files: the browser profile and the element
 * screenshots.
 *
 * These are temp data, not project data. Writing them under the workspace left a
 * `.dsh-visual-annotator/` tree (a full Chrome profile plus shots/) inside the
 * user's repo, which polluted git status, IDE search, file watchers and backups.
 * The default root is the OS temp directory; a per-project subdirectory keeps
 * projects apart so two of them never share a browser profile (cookies/logins)
 * nor overwrite each other's `p1.png`.
 *
 * Pure module: no fs, no env — the caller supplies the root.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

/** Upper bound for the readable part of a scratch directory name. */
const SLUG_MAX = 32;

/** Characters a directory name may not contain on at least one supported OS. */
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]+/g;

/** Filesystem-safe, human-recognisable label for a project ("my-app", "我的-项目"). */
export function projectSlug(cwd) {
	const base = path.basename(path.resolve(String(cwd ?? '')));
	const safe = String(base)
		.replace(UNSAFE, '-')
		.replace(/\s+/g, '-')
		// Windows rejects trailing dots; a leading dot would hide the directory.
		.replace(/^[-.]+|[-.]+$/g, '');
	// Slice by code point: a byte/UTF-16 cut could split an emoji or astral char.
	return [...safe].slice(0, SLUG_MAX).join('') || 'project';
}

/**
 * Short stable hash of the absolute cwd, so "same project -> same dir" survives
 * launches while two projects with the same basename stay separate. Windows and
 * macOS default to case-insensitive filesystems, hence the optional fold.
 */
export function projectHash(cwd, platform = process.platform) {
	const abs = path.resolve(String(cwd ?? ''));
	const key = platform === 'win32' ? abs.toLowerCase() : abs;
	return createHash('sha1').update(key).digest('hex').slice(0, 8);
}

/** Subdirectory name for a project's scratch files; '' when cwd cannot address one. */
export function scratchSubdir(cwd, platform = process.platform) {
	if (!cwd || !path.isAbsolute(String(cwd))) return '';
	return `${projectSlug(cwd)}-${projectHash(cwd, platform)}`;
}

/** Absolute scratch directory for `cwd` under `root`; `root` itself when cwd is unusable. */
export function scratchDir(root, cwd, platform = process.platform) {
	const sub = scratchSubdir(cwd, platform);
	return sub ? path.join(path.resolve(String(root)), sub) : path.resolve(String(root));
}
