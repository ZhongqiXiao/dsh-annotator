#!/usr/bin/env node
/**
 * AI-Native maturity scorer (right-sized port of clb-new assess-maturity).
 * Six dimensions, 100 points. Evidence is EXECUTED where possible: the
 * gates, the canary drill and the finish hook are run for real, so a dead
 * gate can never score. And per clb-new hardest lesson, the scorer itself
 * must not be a fake gate: without a floor it would always exit 0, so
 * --min-score <n> exits 1 below the threshold (CI runs npm run assess:gate).
 * Usage: node scripts/assess-ai-native.mjs [--write-docs] [--min-score <n>].
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => {
	try {
		return readFileSync(path.join(repoRoot, rel), 'utf8');
	} catch {
		return null;
	}
};
const runNode = (rel, args = [], env = {}) => {
	const r = spawnSync(process.execPath, [path.join(repoRoot, rel), ...args], {
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});
	return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

const checks = [];
const dim = (name, max) => {
	const c = { name, max, got: 0, rows: [] };
	checks.push(c);
	return c;
};
const add = (c, weight, label, pass, hint) => {
	const got = pass ? weight : 0;
	c.got += got;
	c.rows.push({ label, got, max: weight, hint: pass ? null : hint });
};

// ---------- D1 治理与文档 (15) ----------
const d1 = dim('治理与文档', 15);
const agents = read('AGENTS.md');
add(d1, 3, 'AGENTS.md 存在且非空', !!agents && agents.trim().length > 100, '写 AGENTS.md：结构、硬性约束、命令');
add(
	d1,
	4,
	'HOST_REV ↔ PANEL_BUILD 契约写明',
	!!agents && /HOST_REV/.test(agents) && /PANEL_BUILD/.test(agents),
	'AGENTS.md 记录三契约（HOST_REV / PANEL_BUILD / overlay REV）',
);
add(d1, 4, '双运行时约束写明', !!agents && /(ESM|Node API)/.test(agents), 'AGENTS.md 说明注入脚本禁 ESM/Node API');
add(
	d1,
	4,
	'提交与发版规范写明',
	!!agents && /Conventional Commits/.test(agents),
	'AGENTS.md 记录 Conventional Commits 与发版流程',
);

// ---------- D2 物理拦截 (25) ----------
const d2 = dim('物理拦截', 25);
const syncSrc = read('scripts/check-build-sync.mjs') || '';
add(
	d2,
	1,
	'build-sync 门禁存在',
	existsSync(path.join(repoRoot, 'scripts/check-build-sync.mjs')),
	'写 scripts/check-build-sync.mjs',
);
add(
	d2,
	1,
	'embedded-runtime 门禁存在',
	existsSync(path.join(repoRoot, 'scripts/check-embedded-runtime.mjs')),
	'写 scripts/check-embedded-runtime.mjs',
);
const pkg = JSON.parse(read('package.json') || '{}');
const verifyChain = (pkg.scripts || {}).verify || '';
add(
	d2,
	4,
	'npm run verify 串联门禁与 canary',
	/gates/.test(verifyChain) && /canary/.test(verifyChain),
	'package.json 的 verify 链加入 npm run gates 与 npm run canary',
);
// 阳性+阴性都在同一次 canary 实跑里取证；NO_SCORER 防评分器自证递归
const canaryRun = runNode('scripts/canary-gates.mjs', [], { DSH_VA_CANARY_NO_SCORER: '1' });
add(
	d2,
	5,
	'canary 阳性实跑通过（注入违规必须真被拦）',
	canaryRun.status === 0 && /阳性/.test(canaryRun.out),
	'运行 node scripts/canary-gates.mjs 看哪个阳性场景失效',
);
add(
	d2,
	4,
	'canary 阴性对照实跑通过（干净夹具必须放行，防「永远 exit 1」）',
	canaryRun.status === 0 && /阴性/.test(canaryRun.out),
	'canary-gates.mjs 补阴性对照场景（干净夹具与同提交递增）',
);
const ci = read('.github/workflows/ci.yml');
add(
	d2,
	6,
	'CI 跑 verify 且 fetch-depth: 0（历史规则在 CI 真生效）',
	!!ci && /npm run verify/.test(ci) && /fetch-depth: 0/.test(ci),
	'ci.yml verify job 补 npm run verify 与 fetch-depth: 0',
);
add(
	d2,
	4,
	'浅克隆在 CI 直接判红（堵死「警告放行」假绿路径）',
	/GITHUB_ACTIONS|process\.env\.CI/.test(syncSrc),
	'check-build-sync.mjs 浅克隆分支加 CI 环境严格判定',
);

// ---------- D3 架构边界 (15) ----------
const d3 = dim('架构边界', 15);
let sharedFiles = [];
try {
	sharedFiles = readdirSync(path.join(repoRoot, 'lib/shared')).filter((f) => f.endsWith('.js'));
} catch {
	// lib/shared missing -> 0 points, hint below
}
add(d3, 5, 'lib/shared/ 存放纯函数模块', sharedFiles.length > 0, '可单测逻辑下沉 lib/shared/');
const hostSources = ['lib/index.js', 'lib/session.js'].map(read).filter(Boolean).join('\n');
add(d3, 5, 'host 代码复用 shared 模块', /shared\//.test(hostSources), 'session.js 等对 shared 纯函数做薄委托');
const gateSync = runNode('scripts/check-build-sync.mjs');
const gateRuntime = runNode('scripts/check-embedded-runtime.mjs');
add(
	d3,
	5,
	'两道扫描门禁在真仓实跑通过',
	gateSync.status === 0 && gateRuntime.status === 0,
	'先让两道门禁在真仓变绿，再谈评分',
);

// ---------- D4 契约同步 (15) ----------
const d4 = dim('契约同步', 15);
add(
	d4,
	5,
	'三契约（HOST_REV/PANEL_BUILD/overlay REV）由门禁覆盖',
	/PANEL_BUILD/.test(syncSrc) && /REV/.test(syncSrc) && /HOST_REV/.test(syncSrc),
	'check-build-sync.mjs 需覆盖三个同步契约',
);
add(d4, 5, 'git 历史递增规则启用', /merge-base/.test(syncSrc), '门禁用 merge-base 校验契约递增历史');
const canarySrc = read('scripts/canary-gates.mjs') || '';
const failCases = (canarySrc.match(/fail\(/g) || []).length;
const passCases = (canarySrc.match(/pass\(/g) || []).length;
add(
	d4,
	5,
	'canary 双向覆盖（阳性≥5 且阴性≥3）',
	failCases >= 5 && passCases >= 3,
	'canary-gates.mjs 补阴性对照：坏门禁「永远 exit 1」也必须拿 0 分',
);

// ---------- D5 工作流自动化 (20) ----------
const d5 = dim('工作流自动化', 20);
add(
	d5,
	3,
	'verify-before-finish 收尾钩子存在',
	existsSync(path.join(repoRoot, 'hooks/verify-before-finish.mjs')),
	'写 hooks/verify-before-finish.mjs（收尾前强制 verify）',
);
const settings = read('.claude/settings.json');
add(
	d5,
	3,
	'钩子已注册（Stop hook）',
	!!settings && /verify-before-finish/.test(settings),
	'在 .claude/settings.json 注册 Stop hook',
);
// guard 模式真跑：stop_hook_active=true 必须直接放行（防死循环契约）；
// 连这条都过不了的钩子说明 stdin 契约已坏
const hookGuard = spawnSync(process.execPath, [path.join(repoRoot, 'hooks/verify-before-finish.mjs')], {
	encoding: 'utf8',
	input: JSON.stringify({ stop_hook_active: true }),
});
add(
	d5,
	4,
	'收尾钩子 guard 模式实跑通过（stop_hook_active 直接放行）',
	hookGuard.status === 0,
	'echo {\"stop_hook_active\":true} | node hooks/verify-before-finish.mjs 验证',
);
const bugTpl = read('.github/ISSUE_TEMPLATE/bug.md');
add(
	d5,
	4,
	'bug 模板含验收标准（AC）段',
	!!bugTpl && /验收标准/.test(bugTpl),
	'issue 模板加验收标准段，作为自动验证契约',
);
add(
	d5,
	3,
	'bug 模板带 ai-fix 触发标签',
	!!bugTpl && /ai-fix/.test(bugTpl),
	'issue 模板 front-matter labels 加 ai-fix，供编码 agent 认领',
);
const prTpl = read('.github/PULL_REQUEST_TEMPLATE.md');
add(d5, 3, 'PR 模板绑定 Resolves #issue', !!prTpl && /Resolves/.test(prTpl), 'PR 模板加 Resolves #N，形成闭环引用');

// ---------- D6 验证与测试 (10) ----------
const d6 = dim('验证与测试', 10);
add(d6, 3, 'verify 链包含测试', /test/.test(verifyChain), 'verify 链加入 npm test');
add(d6, 3, 'CI 运行测试', !!ci && /(npm test|npm run verify|node --test)/.test(ci), 'ci.yml 跑 npm run verify');
add(
	d6,
	4,
	'e2e 进 CI（允许 continue-on-error）',
	!!ci && /(test:e2e|E2E)/.test(ci),
	'ci.yml 增加 e2e job，continue-on-error: true',
);

// ---------- score & report ----------
const total = checks.reduce((s, c) => s + c.got, 0);
const tier =
	total >= 90
		? 'Tier 1 · Exemplar'
		: total >= 75
			? 'Tier 2 · AI-Ready'
			: total >= 50
				? 'Tier 3 · 过渡期'
				: 'Tier 4 · Ad-Hoc';
const hints = checks.flatMap((c) =>
	c.rows.filter((r) => !r.got).map((r) => '- [' + c.name + '] ' + r.label + ' → ' + r.hint),
);

const text = [
	'AI-Native 成熟度：' + total + '/100（' + tier + '）',
	...checks.map((c) => c.name + '  ' + c.got + '/' + c.max),
	'',
	'待改进项：',
	...(hints.length ? hints : ['- 无']),
].join('\n');

console.log(text);
const floorIdx = process.argv.indexOf('--min-score');
const minScore = floorIdx >= 0 ? Number(process.argv[floorIdx + 1]) : null;
if (minScore !== null) console.log('地板分：--min-score ' + minScore + ' → ' + (total >= minScore ? '达标' : '未达标'));
if (process.argv.includes('--write-docs')) {
	mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
	const stamp = new Date().toISOString().slice(0, 10);
	writeFileSync(
		path.join(repoRoot, 'docs/ai-native-health-report.md'),
		'# AI-Native 健康报告\n\n> 由 scripts/assess-ai-native.mjs 生成于 ' + stamp + '\n\n```\n' + text + '\n```\n',
	);
	console.log('\n已写入 docs/ai-native-health-report.md');
}
if (minScore !== null && Number.isFinite(minScore) && total < minScore) {
	console.error(
		'✗ 未达成熟度地板分：' + total + '/100 < --min-score ' + minScore + '——评分器不许自己当「永远 exit 0」的假门禁',
	);
	process.exit(1);
}
process.exit(0);
