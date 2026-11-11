#!/usr/bin/env node
/**
 * Finish-line gate (Stop hook, clb-new pattern): before an agent session
 * may stop, "npm run verify" must pass. Reads the harness JSON payload on
 * stdin; when stop_hook_active is set the harness is already re-prompting
 * us, so exit 0 to avoid an infinite loop. On failure prints a fix guide
 * and exits 1, which blocks the stop and sends the guidance back.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let payload = {};
try {
	const raw = readFileSync(0, 'utf8');
	if (raw && raw.trim()) payload = JSON.parse(raw);
} catch {
	// Non-JSON or empty stdin: treat as a plain invocation, keep going.
}
if (payload && payload.stop_hook_active) process.exit(0);

// 环境缺失要报成环境缺失：npm 不在 PATH、或 Windows 上 npm.cmd 未被解析时，
// 旧实现会一路走到「verify 未通过」并把锅甩给三契约（issue #1）。
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const probe = spawnSync(npmCommand, ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
	console.error(
		[
			'',
			'✗ 收尾未被验证：找不到可用的 npm —— 这是环境问题，不是代码问题。',
			'',
			'💡 修复指南：',
			'- 装 Node 22（npm 随附），并确认 npm 在 PATH 里：`npm --version` 能打印版本。',
			'- Windows 上钩子调用的是 npm.cmd；npm 装在非默认位置时，把它的目录加进 PATH。',
			'- 装好后重新收尾，钩子会自动跑 `npm run verify`。',
			'',
		].join('\n'),
	);
	process.exit(1);
}

const r = spawnSync(npmCommand, ['run', 'verify'], { cwd: repoRoot, stdio: 'inherit', encoding: 'utf8' });
if (r.status === 0) {
	console.log('✓ verify 全绿，可以收尾。');
	process.exit(0);
}
console.error(
	[
		'',
		'✗ 收尾被拦下：npm run verify 未通过。',
		'',
		'💡 修复指南（按报错对号入座）：',
		'- check-build-sync 报 prefix-mismatch：改了 lib/client.js 就要同时递增 lib/index.js 的 HOST_REV 与 lib/client.js 的 PANEL_BUILD（两个数字必须一致）。',
		'- check-build-sync 报 overlay-without-bump：改了 lib/overlay.js 注入载荷就要递增其中的 var REV（旧实例同 REV 会走 reattach，新逻辑不生效）。',
		'- check-build-sync 报 client-after-rev：本次改动忘了递增版本标记，先递增再提交。',
		'- check-embedded-runtime 报违规：lib/client.js 与 OVERLAY_SCRIPT 注入载荷只能跑浏览器运行时，禁 ESM import/export 与 Node API（process/Buffer/node: 模块）。',
		'- 测试或 lint 失败：按各自报错修；单独复跑某一段可 npm run gates 或 npm run canary。',
		'',
	].join('\n'),
);
process.exit(1);
