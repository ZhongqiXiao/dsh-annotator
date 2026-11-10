import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OVERLAY_SCRIPT } from '../lib/overlay.js';
import { scanEmbeddedRuntime, scanPageScript } from '../lib/shared/embedded-runtime.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('the shipped panel script is browser-only (loader idioms allowed)', () => {
	assert.deepEqual(scanEmbeddedRuntime(read('../lib/client.js')), [], 'client.js 基线必须干净，否则门禁上线即红');
});

test('the shipped overlay payload is browser-only and has no loader', () => {
	assert.deepEqual(scanPageScript(OVERLAY_SCRIPT), [], 'OVERLAY_SCRIPT 基线必须干净，否则门禁上线即红');
});

test('canary: ESM syntax and Node globals in the panel script are flagged with line numbers', () => {
	const canary = [
		'var ok = 1;',
		'var env = process.env.HOME;',
		"import fs from 'node:fs';",
		'var chunk = Buffer.from("x");',
	].join('\n');
	const violations = scanEmbeddedRuntime(canary);
	const rules = violations.map((v) => v.rule);
	assert.ok(rules.includes('process-global'), 'process 必须被拦下');
	assert.ok(rules.includes('esm-import'), 'import 语句必须被拦下');
	assert.ok(rules.includes('node-specifier'), 'node: 模块必须被拦下');
	assert.ok(rules.includes('buffer-global'), 'Buffer 必须被拦下');
	const env = violations.find((v) => v.rule === 'process-global');
	assert.equal(env.line, 2, '违规要带行号，修复指南才有落点');
});

test('canary: require is a violation only for the page payload', () => {
	const loaderIdiom = "var React = require('react');" + '\n' + 'module.exports = {};';
	assert.deepEqual(scanEmbeddedRuntime(loaderIdiom), [], 'ModuleLoader 的 require/module 是合法惯用法');

	const pageRequire = "var x = require('react');";
	const flagged = scanPageScript(pageRequire);
	assert.ok(
		flagged.some((v) => v.rule === 'require-call'),
		'页面载荷里 require 不存在，必须被拦下',
	);
});

test('words that merely mention banned names do not fire', () => {
	const decoys = [
		'// the process of picking an element',
		'var label = "process diagram";',
		'exports.apply = apply;',
		'* import 语句请看文档（块注释续行）',
	].join('\n');
	assert.deepEqual(scanEmbeddedRuntime(decoys), [], '成员访问/词边界之外的提及不算违规');
});
