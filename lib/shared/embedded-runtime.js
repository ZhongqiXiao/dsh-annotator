/**
 * Runtime rules for code that leaves the Node host, as pure scanners.
 *
 * - lib/client.js runs inside the DSH GUI browser. It is a ModuleLoader
 *   factory: `(require) => { var module = { exports: {} }; ... }` —
 *   require / module / exports are loader idioms and must stay allowed.
 * - The OVERLAY_SCRIPT payload (lib/overlay.js) runs in the target page's
 *   main world via CDP Runtime.evaluate: no loader, no ESM, no Node globals.
 *
 * Rules fire per line so violations carry a line number for the fix guide.
 */

export const EMBEDDED_RULES = [
	{ rule: 'esm-import', re: /^\s*import\b/, why: '注入脚本不是 ESM：DSH GUI 以经典 script 装载' },
	{ rule: 'esm-export', re: /^\s*export\b/, why: '注入脚本不是 ESM：导出走 module.exports（loader 惯用法）' },
	{ rule: 'node-specifier', re: /(?:require\s*\(\s*|from\s+|import\s*\(\s*)['"]node:/, why: '浏览器里没有 node: 模块' },
	{ rule: 'process-global', re: /\bprocess\s*(?:\.|\[)/, why: '浏览器里没有 process 全局' },
	{ rule: 'buffer-global', re: /\bBuffer\b/, why: '浏览器里没有 Buffer 全局' },
	{ rule: 'node-file-vars', re: /__dirname|__filename/, why: '浏览器里没有 __dirname / __filename' },
	{
		rule: 'immediate',
		re: /\b(?:set|clear)Immediate\s*\(/,
		why: '浏览器没有 setImmediate / clearImmediate，用 setTimeout(fn, 0)',
	},
];

/** Extra rules for the page payload, which has no ModuleLoader at all. */
const PAGE_ONLY_RULES = [
	{ rule: 'require-call', re: /\brequire\s*\(/, why: '页面注入脚本没有 ModuleLoader，require 不存在' },
];

function scanWithRules(text, rules) {
	const violations = [];
	const lines = String(text ?? '').split('\n');
	lines.forEach((line, index) => {
		for (const { rule, re, why } of rules) {
			if (re.test(line)) {
				violations.push({ rule, line: index + 1, snippet: line.trim().slice(0, 120), why });
			}
		}
	});
	return violations;
}

/** Scan the GUI panel script (lib/client.js). Loader idioms are allowed. */
export function scanEmbeddedRuntime(text) {
	return scanWithRules(text, EMBEDDED_RULES);
}

/** Scan the page payload (OVERLAY_SCRIPT). No loader idioms at all. */
export function scanPageScript(text) {
	return scanWithRules(text, [...EMBEDDED_RULES, ...PAGE_ONLY_RULES]);
}
