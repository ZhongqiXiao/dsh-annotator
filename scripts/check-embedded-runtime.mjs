#!/usr/bin/env node
/**
 * Gate: browser-bound code must stay browser-only (AGENTS.md 硬性约束).
 *
 * - lib/client.js runs in the DSH GUI browser as a ModuleLoader factory:
 *   `require` / `module` / `exports` are loader idioms — allowed; ESM
 *   syntax and Node-only globals are not.
 * - OVERLAY_SCRIPT (lib/overlay.js) is evaluated inside the target page via
 *   CDP: no require, no ESM, no Node globals.
 *
 * Flags: --lib <dir> (default <repo>/lib).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanEmbeddedRuntime, scanPageScript } from '../lib/shared/embedded-runtime.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
	const args = { lib: path.join(repoRoot, 'lib') };
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === '--lib') args.lib = path.resolve(repoRoot, argv[(i += 1)] ?? '');
		else {
			console.error(`未知参数：${argv[i]}`);
			process.exit(2);
		}
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
const violations = [];

let clientSource;
try {
	clientSource = readFileSync(path.join(args.lib, 'client.js'), 'utf8');
} catch (error) {
	console.error(`无法读取 ${path.join(args.lib, 'client.js')}：${error.message}`);
	process.exit(2);
}
violations.push(...scanEmbeddedRuntime(clientSource).map((v) => ({ ...v, file: 'lib/client.js' })));

let overlayModule = null;
try {
	overlayModule = await import(pathToFileURL(path.join(args.lib, 'overlay.js')).href);
} catch (error) {
	violations.push({
		file: 'lib/overlay.js',
		rule: 'overlay-import',
		line: 0,
		snippet: String(error.message).slice(0, 120),
		why: 'overlay.js 必须是合法 ESM 才能取出 OVERLAY_SCRIPT 载荷',
	});
}
if (overlayModule?.OVERLAY_SCRIPT) {
	violations.push(...scanPageScript(overlayModule.OVERLAY_SCRIPT).map((v) => ({ ...v, file: 'lib/overlay.js' })));
}
if (!overlayModule?.OVERLAY_SCRIPT && !violations.some((v) => v.rule === 'overlay-import')) {
	violations.push({
		file: 'lib/overlay.js',
		rule: 'overlay-missing',
		line: 0,
		snippet: '',
		why: 'overlay.js 没有导出 OVERLAY_SCRIPT，注入层无从装载',
	});
}

if (violations.length > 0) {
	for (const violation of violations) {
		console.error(`✗ ${violation.file}:${violation.line} [${violation.rule}] ${violation.snippet}`);
		console.error(`  为什么不行：${violation.why}`);
	}
	console.error('💡 修复指南：');
	console.error('  - lib/client.js 跑在 DSH GUI 浏览器：模块引用走 ModuleLoader 的 require（见文件头 factory 注释），');
	console.error('    不要用 import/export 语句，不要碰 process / Buffer / __dirname 等 Node API。');
	console.error('  - lib/overlay.js 的 OVERLAY_SCRIPT 跑在目标网页主世界：只用 var / window / document 等浏览器 API，');
	console.error('    require / import / export / Node 全局都不存在。');
	process.exit(1);
}
console.log('✓ embedded-runtime：client.js 与注入载荷都是纯浏览器运行时。');
