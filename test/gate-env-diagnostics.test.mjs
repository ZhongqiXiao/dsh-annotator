import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// 环境异常（不是代码写错）时的诊断契约，见 issue #1：
// 门禁与收尾钩子必须说清「缺什么」，不许甩 Node 异常栈，也不许把环境问题报成验证失败。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = path.join(repoRoot, 'scripts', 'check-build-sync.mjs');
const hook = path.join(repoRoot, 'hooks', 'verify-before-finish.mjs');

/** 造一个「有 lib、没有 .git」的工作树：zip 解包或纯拷贝目录就是这个样子。 */
function makeNonGitTree() {
	const dir = mkdtempSync(path.join(tmpdir(), 'va-nogit-'));
	mkdirSync(path.join(dir, 'lib'), { recursive: true });
	for (const file of ['index.js', 'client.js', 'overlay.js']) {
		copyFileSync(path.join(repoRoot, 'lib', file), path.join(dir, 'lib', file));
	}
	return dir;
}

test('gate: 无 .git 时给出环境诊断，而不是 Node 异常栈', () => {
	const dir = makeNonGitTree();
	const r = spawnSync(process.execPath, [gate, '--repo', dir], { encoding: 'utf8' });
	assert.equal(r.status, 1, '没有 git 历史就无法校验递增，必须判红');
	const out = `${r.stdout}${r.stderr}`;
	assert.match(out, /not-a-git-repo/);
	assert.match(out, /不在 git 仓库里/);
	assert.doesNotMatch(out, /node:internal\/errors/, '不许把 Node 内部异常栈甩给用户');
});

test('gate: 无 .git 且显式 --skip-history 时放行（防「永远 exit 1」）', () => {
	const dir = makeNonGitTree();
	const r = spawnSync(process.execPath, [gate, '--repo', dir, '--skip-history'], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
});

test(
	'hook: npm 不在 PATH 时报「找不到可用的 npm」，不把锅甩给 verify',
	{ skip: process.platform === 'win32' && 'Windows 的 PATH 解析与 POSIX 不同，此用例在 macOS/Linux 上跑' },
	() => {
		const bin = mkdtempSync(path.join(tmpdir(), 'va-nonpm-'));
		symlinkSync(process.execPath, path.join(bin, 'node'));
		const r = spawnSync(process.execPath, [hook], {
			encoding: 'utf8',
			input: '{}',
			env: { ...process.env, PATH: bin },
		});
		assert.equal(r.status, 1);
		const out = `${r.stdout}${r.stderr}`;
		assert.match(out, /找不到可用的 npm/);
		assert.doesNotMatch(out, /npm run verify 未通过/);
	},
);
