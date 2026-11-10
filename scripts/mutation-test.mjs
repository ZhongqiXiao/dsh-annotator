#!/usr/bin/env node
/**
 * 评分器的评分器：变异测试（mutation testing）。
 *
 * 做法：克隆本仓，逐个把控制项打坏，重跑 assess，断言分数必须下降。
 * 掉不下来的变异 = 判据在「读关键词」而不是「看行为」——正是 clb-new 最痛的
 * 假门禁同构问题（永远 exit 0 拿满分）。
 * Usage: node scripts/mutation-test.mjs [--keep]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(tmpdir(), 'va-mutation');
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const rd = (d, p) => fs.readFileSync(path.join(d, p), 'utf8');
const wr = (d, p, s) => fs.writeFileSync(path.join(d, p), s);

const mutations = [
	{ id: 'M01 删 AGENTS.md', apply: (d) => rm(path.join(d, 'AGENTS.md')) },
	{
		id: 'M02 AGENTS 抹掉三契约词',
		apply: (d) =>
			wr(
				d,
				'AGENTS.md',
				rd(d, 'AGENTS.md')
					.replace(/HOST_REV/g, 'X1')
					.replace(/PANEL_BUILD/g, 'X2'),
			),
	},
	{
		id: 'M03 AGENTS 抹掉双运行时段落',
		apply: (d) =>
			wr(
				d,
				'AGENTS.md',
				rd(d, 'AGENTS.md')
					.replace(/ESM/g, 'E5M')
					.replace(/Node API/g, 'N0de'),
			),
	},
	{
		id: 'M04 verify 链去掉 gates+canary',
		apply: (d) => {
			const p = JSON.parse(rd(d, 'package.json'));
			p.scripts.verify = 'node --check lib/index.js';
			wr(d, 'package.json', JSON.stringify(p, null, 2));
		},
	},
	{
		id: 'M05 ci.yml 去掉 fetch-depth: 0',
		apply: (d) => wr(d, '.github/workflows/ci.yml', rd(d, '.github/workflows/ci.yml').replace(/fetch-depth: 0/g, '')),
	},
	{
		id: 'M06 两道门禁桩化成 exit 0',
		apply: (d) => {
			wr(d, 'scripts/check-build-sync.mjs', 'process.exit(0);' + String.fromCharCode(10));
			wr(d, 'scripts/check-embedded-runtime.mjs', 'process.exit(0);' + String.fromCharCode(10));
		},
	},
	{
		id: 'M07 canary 桩化但保留阳性/阴性字样',
		apply: (d) =>
			wr(
				d,
				'scripts/canary-gates.mjs',
				'console.log("✓ canary 演练通过：12 个场景（阳性 7 / 阴性 5）");' +
					String.fromCharCode(10) +
					'process.exit(0);' +
					String.fromCharCode(10),
			),
	},
	{ id: 'M08 删 lib/shared', apply: (d) => rm(path.join(d, 'lib/shared')) },
	{
		id: 'M09 收尾钩子改成无条件 exit 0',
		apply: (d) =>
			wr(
				d,
				'hooks/verify-before-finish.mjs',
				'process.stdout.write(JSON.stringify({ decision: "approve" }));' +
					String.fromCharCode(10) +
					'process.exit(0);' +
					String.fromCharCode(10),
			),
	},
	{ id: 'M10 删 hook 注册', apply: (d) => wr(d, '.claude/settings.json', '{}') },
	{
		id: 'M11 bug 模板去掉验收标准+ai-fix',
		apply: (d) => {
			const t = rd(d, '.github/ISSUE_TEMPLATE/bug.md')
				.replace(/验收标准/g, 'AA')
				.replace(/ai-fix/g, 'xx');
			wr(d, '.github/ISSUE_TEMPLATE/bug.md', t);
		},
	},
	{
		id: 'M12 ci.yml 删 e2e job',
		apply: (d) =>
			wr(d, '.github/workflows/ci.yml', rd(d, '.github/workflows/ci.yml').replace(/e2e/g, 'zz').replace(/E2E/g, 'ZZ')),
	},
	{
		id: 'M13 PR 模板去掉 Resolves',
		apply: (d) =>
			wr(d, '.github/PULL_REQUEST_TEMPLATE.md', rd(d, '.github/PULL_REQUEST_TEMPLATE.md').replace(/Resolves/g, 'R3s')),
	},
	{
		id: 'M14 bug 模板 AC 退化成关键词（删代码块与复选项）',
		apply: (d) => {
			const nl = String.fromCharCode(10);
			const src = rd(d, '.github/ISSUE_TEMPLATE/bug.md');
			const head = src.split('## 验收标准')[0];
			const tail = '## 给修复 agent 的提示' + src.split('## 给修复 agent 的提示')[1];
			wr(
				d,
				'.github/ISSUE_TEMPLATE/bug.md',
				head + '## 验收标准（AC）' + nl + nl + '看起来正常就行。' + nl + nl + tail,
			);
		},
	},
	{
		id: 'M15 评分器删掉地板分（自证失效）',
		apply: (d) => {
			const s = rd(d, 'scripts/assess-ai-native.mjs').replace(/--min-score/g, '--zzz');
			wr(d, 'scripts/assess-ai-native.mjs', s);
		},
	},
];

const SKIP = new Set(['.git', 'node_modules', '.scratch']);
// git clone 只拿 HEAD；工作区未提交的改动必须覆盖上去，否则测的是旧代码
const clone = (dir) => {
	rm(dir);
	const r = spawnSync('git', ['clone', '-q', '--no-hardlinks', repoRoot, dir], { encoding: 'utf8' });
	if (r.status !== 0) throw new Error('git clone 失败：' + (r.stderr || ''));
	fs.cpSync(repoRoot, dir, { recursive: true, filter: (s) => s === repoRoot || !SKIP.has(path.basename(s)) });
};

const score = (dir) => {
	const r = spawnSync(process.execPath, [path.join(dir, 'scripts/assess-ai-native.mjs')], {
		cwd: dir,
		encoding: 'utf8',
		timeout: 300000,
	});
	const out = (r.stdout || '') + (r.stderr || '');
	const m = out.match(/成熟度：(\d+)\/100/);
	return m ? Number(m[1]) : -1;
};

rm(WORK);
fs.mkdirSync(WORK, { recursive: true });
const baseDir = path.join(WORK, 'base');
clone(baseDir);
const base = score(baseDir);
console.log('基线：' + base + '/100');
if (base < 90) {
	console.error('✗ 本仓基线分过低（' + base + '），先修好再跑变异测试');
	process.exit(1);
}

const rows = [];
const survivors = [];
mutations.forEach((m, i) => {
	const dir = path.join(WORK, 'm' + i);
	clone(dir);
	m.apply(dir);
	const s = score(dir);
	const delta = s - base;
	rows.push({ id: m.id, score: s, delta });
	if (delta >= 0) survivors.push(m.id + '（分数未下降：' + s + '）');
	console.log((delta < 0 ? '✓ ' : '✗ ') + m.id + ' → ' + s + '/100（' + (delta > 0 ? '+' : '') + delta + '）');
	rm(dir);
});

const width = Math.max(...rows.map((r) => r.id.length));
console.log(
	String.fromCharCode(10) +
		'变异测试结果：' +
		(rows.length - survivors.length) +
		'/' +
		rows.length +
		' 个变异被评分器检出',
);
rows.forEach((r) =>
	console.log('  ' + r.id.padEnd(width) + '  ' + String(r.score).padStart(3) + '/100  Δ' + String(r.delta).padStart(4)),
);
if (survivors.length) {
	console.error(String.fromCharCode(10) + '✗ 以下变异没被检出——这些判据只在读关键词，不在看行为：');
	survivors.forEach((s) => console.error('  - ' + s));
	process.exit(1);
}
console.log(String.fromCharCode(10) + '✓ 变异测试通过：每个控制项被打坏后分数都必须下降');
