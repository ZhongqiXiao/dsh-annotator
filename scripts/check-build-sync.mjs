#!/usr/bin/env node
/**
 * Physical gate for the build-sync contracts (AGENTS.md 硬性约束).
 *
 * Static: HOST_REV / PANEL_BUILD / overlay REV all present and in agreement.
 * History: the last commit that touched lib/client.js must not be newer than
 * the last commit that introduced the current HOST_REV prefix (a client
 * change without a bump); the last commit that changed the overlay payload
 * zone must not be newer than the last commit that introduced the current
 * `var REV`.
 *
 * Shallow clones (CI default) cannot verify history: this gate passes with a
 * warning, or fails with --strict. Run the CI checkout with fetch-depth: 0
 * to really enforce it.
 *
 * Flags: --repo <dir> (default this repo; canary drills point it at a temp
 * git repo), --lib <dir> (default <repo>/lib), --strict, --skip-history.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
	checkStaticBuildSync,
	diffHunkNewRanges,
	hunksTouchRanges,
	overlayPayloadRanges,
	parseHostRev,
	parseOverlayRev,
} from '../lib/shared/host-rev.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
	const args = { repo: repoRoot, lib: null, strict: false, skipHistory: false };
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === '--repo') args.repo = path.resolve(repoRoot, argv[(i += 1)] ?? '');
		else if (argv[i] === '--lib') args.lib = path.resolve(repoRoot, argv[(i += 1)] ?? '');
		else if (argv[i] === '--strict') args.strict = true;
		else if (argv[i] === '--skip-history') args.skipHistory = true;
		else {
			console.error(`未知参数：${argv[i]}`);
			process.exit(2);
		}
	}
	return args;
}

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Last commit hash touching relPath, or (with needle) introducing that literal. */
function lastCommit(cwd, relPath, needle) {
	const args = ['log', '-1', '--format=%H'];
	if (needle) args.push('-S' + needle);
	args.push('--', relPath);
	const out = git(cwd, args);
	return out || null;
}

function isAncestor(cwd, maybeOlder, maybeNewer) {
	try {
		git(cwd, ['merge-base', '--is-ancestor', maybeOlder, maybeNewer]);
		return true;
	} catch {
		return false;
	}
}

const FIX_GUIDES = {
	'client-without-bump':
		'💡 修复指南：改了 lib/client.js 就必须递增 lib/index.js 的 HOST_REV 前缀数字（v28- → v29-），并把 lib/client.js 的 PANEL_BUILD 改成同值；GUI 靠这个前缀强拉新面板脚本。',
	'overlay-without-bump':
		'💡 修复指南：注入载荷变了就要递增 lib/overlay.js 里 OVERLAY_SCRIPT 的 var REV（如 12 → 13）；REV 相同的旧实例会走 reattach 分支，新逻辑不会生效。',
};

const args = parseArgs(process.argv.slice(2));
if (!args.lib) args.lib = path.join(args.repo, 'lib');
const problems = [];
const notes = [];

let hostSource;
let clientSource;
let overlaySource;
try {
	hostSource = readFileSync(path.join(args.lib, 'index.js'), 'utf8');
	clientSource = readFileSync(path.join(args.lib, 'client.js'), 'utf8');
	overlaySource = readFileSync(path.join(args.lib, 'overlay.js'), 'utf8');
} catch (error) {
	console.error(`无法读取 ${args.lib} 下的 index.js / client.js / overlay.js：${error.message}`);
	process.exit(2);
}

// --- static half ------------------------------------------------------------
const staticCheck = checkStaticBuildSync({ hostSource, clientSource, overlaySource });
problems.push(...staticCheck.problems.map((p) => ({ ...p, guide: '' })));

// --- history half -----------------------------------------------------------
if (!args.skipHistory) {
	let shallow = false;
	try {
		shallow = git(args.repo, ['rev-parse', '--is-shallow-repository']) === 'true';
	} catch {
		notes.push('不在 git 仓库里，跳过历史校验（保留静态校验）。');
	}
	if (shallow) {
		if (args.strict) {
			problems.push({
				code: 'shallow-clone',
				message: '浅克隆无法校验递增历史（--strict）；CI 请把 checkout 的 fetch-depth 设为 0。',
				guide: '',
			});
		} else {
			notes.push('浅克隆：跳过历史校验（--strict 可改为报错；CI 用 fetch-depth: 0 才能真校验）。');
		}
	} else {
		const hostRev = parseHostRev(hostSource);
		const overlayRev = parseOverlayRev(overlaySource);
		const clientLast = lastCommit(args.repo, 'lib/client.js');
		const revIntroduced = hostRev && lastCommit(args.repo, 'lib/index.js', `HOST_REV = 'v${hostRev.number}-`);
		if (clientLast && revIntroduced && !isAncestor(args.repo, clientLast, revIntroduced)) {
			problems.push({
				code: 'client-without-bump',
				message: `lib/client.js 在 ${clientLast.slice(0, 8)} 被改动，晚于当前 HOST_REV（${hostRev.prefix}）的引入提交 ${revIntroduced.slice(0, 8)}——改面板必须递增 HOST_REV`,
				guide: FIX_GUIDES['client-without-bump'],
			});
		} else if (!revIntroduced && hostRev) {
			notes.push(`找不到引入 ${hostRev.prefix} 的提交（可能是提交信息或写法变化），跳过 client 侧历史校验。`);
		}

		const overlayLast = lastCommit(args.repo, 'lib/overlay.js');
		const overlayIntroduced = overlayRev !== null && lastCommit(args.repo, 'lib/overlay.js', `var REV = ${overlayRev}`);
		if (overlayLast && overlayIntroduced && !isAncestor(args.repo, overlayLast, overlayIntroduced)) {
			const patch = git(args.repo, ['show', overlayLast, '--format=', '-U0', '--', 'lib/overlay.js']);
			const touched = hunksTouchRanges(diffHunkNewRanges(patch), overlayPayloadRanges(overlaySource));
			if (touched) {
				problems.push({
					code: 'overlay-without-bump',
					message: `lib/overlay.js 的注入载荷在 ${overlayLast.slice(0, 8)} 被改动，晚于当前 var REV = ${overlayRev} 的引入提交 ${overlayIntroduced.slice(0, 8)}——改载荷必须递增 REV`,
					guide: FIX_GUIDES['overlay-without-bump'],
				});
			} else {
				notes.push('lib/overlay.js 最近一次改动未触及注入载荷（注释/宿主侧），豁免 REV 递增。');
			}
		}
	}
}

for (const note of notes) console.log(`提示：${note}`);
if (problems.length > 0) {
	for (const problem of problems) {
		console.error(`✗ ${problem.code}：${problem.message}`);
		if (problem.guide) console.error(problem.guide);
	}
	process.exit(1);
}
console.log('✓ build-sync：版本标记齐备且历史递增规则通过。');
