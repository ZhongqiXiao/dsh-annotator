#!/usr/bin/env node
/**
 * AI-Native maturity scorer (right-sized port of clb-new assess-maturity).
 *
 * 证据分两级，报告里分列：
 *   exec = 真跑进程看退出码/输出（门禁、canary、收尾钩子、哨兵探针）；
 *   text = 只读文本存在性（AGENTS.md 关键词、模板段落、CI 配置行），天然可被关键词满足。
 * 变异实验（npm run mutate）证明：只靠 text 的判据会被「关键词堆满」骗过，
 * 因此 Tier 1 要求执行型探针全绿，且报告显式暴露文本项上限分。
 *
 * 评分器自身也不许当假门禁：--min-score <n> 低于地板分 exit 1。
 * Usage: node scripts/assess-ai-native.mjs [--write-docs] [--min-score <n>].
 */
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	mkdtempSync,
	copyFileSync,
	cpSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FENCE = String.fromCharCode(96).repeat(3);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.scratch']);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => {
	try {
		return readFileSync(path.join(repoRoot, rel), 'utf8');
	} catch {
		return null;
	}
};
const runNode = (rel, args = [], env = {}, cwd = repoRoot) => {
	const r = spawnSync(process.execPath, [path.join(cwd, rel), ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, ...env },
		timeout: 180000,
	});
	return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

const checks = [];
const totals = { exec: 0, text: 0, execMax: 0, textMax: 0 };
const dim = (name, max) => {
	const c = { name, max, got: 0, rows: [] };
	checks.push(c);
	return c;
};
const add = (c, weight, label, pass, hint, kind = 'exec') => {
	const got = pass ? weight : 0;
	c.got += got;
	totals[kind] += got;
	totals[kind + 'Max'] += weight;
	c.rows.push({ label, got, max: weight, hint: pass ? null : hint, kind });
};

// ---------- D1 治理与文档 (15)｜全部是文本型证据 ----------
const d1 = dim('治理与文档', 15);
const agents = read('AGENTS.md');
add(
	d1,
	3,
	'AGENTS.md 存在且非空',
	!!agents && agents.trim().length > 100,
	'写 AGENTS.md：结构、硬性约束、命令',
	'text',
);
add(
	d1,
	4,
	'HOST_REV / PANEL_BUILD / overlay REV 三契约写明',
	!!agents && /HOST_REV/.test(agents) && /PANEL_BUILD/.test(agents),
	'AGENTS.md 记录三契约（HOST_REV / PANEL_BUILD / overlay REV）',
	'text',
);
add(
	d1,
	4,
	'双运行时约束写明',
	!!agents && /(ESM|Node API)/.test(agents),
	'AGENTS.md 说明注入脚本禁 ESM/Node API',
	'text',
);
add(
	d1,
	4,
	'提交与发版规范写明',
	!!agents && /Conventional Commits/.test(agents),
	'AGENTS.md 记录 Conventional Commits 与发版流程',
	'text',
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
	'text',
);
add(
	d2,
	1,
	'embedded-runtime 门禁存在',
	existsSync(path.join(repoRoot, 'scripts/check-embedded-runtime.mjs')),
	'写 scripts/check-embedded-runtime.mjs',
	'text',
);
const pkg = JSON.parse(read('package.json') || '{}');
const verifyChain = (pkg.scripts || {}).verify || '';
add(
	d2,
	3,
	'npm run verify 串联门禁与 canary',
	/gates/.test(verifyChain) && /canary/.test(verifyChain),
	'package.json 的 verify 链加入 npm run gates 与 npm run canary',
	'text',
);

// 阳性/阴性不再是「输出里有没有这个词」：从 canary 汇总行解析真实场景数
// 嵌套保护：评分器 → canary → 评分器；第二层不再展开（否则无限递归），
// 但第一层必须真跑，canary 的评分器自证才有效（变异 M15 即靠这条被发现）。
const DEPTH = Number(process.env.DSH_VA_ASSESS_DEPTH || '0');
const nested = DEPTH > 0;
const canaryRun = nested
	? { status: 0, out: '' }
	: runNode('scripts/canary-gates.mjs', [], { DSH_VA_ASSESS_DEPTH: String(DEPTH + 1) });
const canaryOk = nested ? true : canaryRun.status === 0;
const posCount = Number((canaryRun.out.match(/阳性\s*(\d+)/) || [])[1] || 0);
const negCount = Number((canaryRun.out.match(/阴性\s*(\d+)/) || [])[1] || 0);
add(
	d2,
	4,
	nested
		? 'canary 阳性实跑通过（嵌套调用：沿用外层结果）'
		: 'canary 阳性实跑通过（注入违规必须真被拦，实测 ' + posCount + ' 例）',
	canaryOk && (nested || posCount >= 5),
	'运行 node scripts/canary-gates.mjs 看哪个阳性场景失效',
);
add(
	d2,
	3,
	nested
		? 'canary 阴性对照实跑通过（嵌套调用：沿用外层结果）'
		: 'canary 阴性对照实跑通过（干净夹具必须放行，实测 ' + negCount + ' 例）',
	canaryOk && (nested || negCount >= 3),
	'canary-gates.mjs 补阴性对照场景（干净夹具与同提交递增）',
);
const ci = read('.github/workflows/ci.yml');
add(
	d2,
	5,
	'CI 跑 verify 且 fetch-depth: 0（历史规则在 CI 真生效）',
	!!ci && /npm run verify/.test(ci) && /fetch-depth: 0/.test(ci),
	'ci.yml verify job 补 npm run verify 与 fetch-depth: 0',
	'text',
);
add(
	d2,
	4,
	'浅克隆在 CI 直接判红（堵死「警告放行」假绿路径）',
	/GITHUB_ACTIONS|process\.env\.CI/.test(syncSrc),
	'check-build-sync.mjs 浅克隆分支加 CI 环境严格判定',
	'text',
);

// 哨兵探针：把 build-sync 桩化成 exit 0，canary 必须变红。
// 缺了这条，「桩化 canary + 打印阳性/阴性字样」就能骗到 9 分（变异实验 M07 只掉 5 分）。
const probeCanarySensitivity = () => {
	const fx = mkdtempSync(path.join(tmpdir(), 'va-sentry-'));
	const dst = path.join(fx, 'repo');
	try {
		const cl = spawnSync('git', ['clone', '-q', '--no-hardlinks', repoRoot, dst], {
			encoding: 'utf8',
			timeout: 180000,
		});
		if (cl.status !== 0) return { ok: false, hint: '哨兵探针克隆本仓失败：' + String(cl.stderr || '').slice(0, 200) };
		// clone 只拿 HEAD：哨兵必须测「当前工作区的 canary」，否则桩化后仍然过
		cpSync(repoRoot, dst, { recursive: true, filter: (s) => s === repoRoot || !SKIP_DIRS.has(path.basename(s)) });
		writeFileSync(path.join(dst, 'scripts/check-build-sync.mjs'), 'process.exit(0);' + String.fromCharCode(10));
		const r = spawnSync(process.execPath, [path.join(dst, 'scripts/canary-gates.mjs')], {
			cwd: dst,
			encoding: 'utf8',
			env: { ...process.env, DSH_VA_ASSESS_DEPTH: '2' },
			timeout: 180000,
		});
		if (r.status === 0) return { ok: false, hint: '门禁桩化后 canary 仍全绿：canary 没在真校验门禁' };
		return { ok: true };
	} catch (e) {
		return { ok: false, hint: '哨兵探针异常：' + e.message };
	} finally {
		rmSync(fx, { recursive: true, force: true });
	}
};
const sentry = nested ? { ok: true } : probeCanarySensitivity();
add(
	d2,
	4,
	nested ? 'canary 哨兵探针（嵌套调用：沿用外层结果）' : 'canary 对「门禁被桩化」必须变红（哨兵探针）',
	sentry.ok,
	sentry.hint || 'canary 必须能在门禁桩化时判红',
);

// ---------- D3 架构边界 (15) ----------
const d3 = dim('架构边界', 15);
let sharedFiles = [];
try {
	sharedFiles = readdirSync(path.join(repoRoot, 'lib/shared')).filter((f) => f.endsWith('.js'));
} catch {
	// lib/shared missing -> 0 points, hint below
}
add(d3, 5, 'lib/shared/ 存放纯函数模块', sharedFiles.length > 0, '可单测逻辑下沉 lib/shared/', 'text');
const hostSources = ['lib/index.js', 'lib/session.js'].map(read).filter(Boolean).join(String.fromCharCode(10));
add(d3, 5, 'host 代码复用 shared 模块', /shared\//.test(hostSources), 'session.js 等对 shared 纯函数做薄委托', 'text');
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
	'text',
);
add(d4, 5, 'git 历史递增规则启用', /merge-base/.test(syncSrc), '门禁用 merge-base 校验契约递增历史', 'text');
const canarySrc = read('scripts/canary-gates.mjs') || '';
const failCases = (canarySrc.match(/fail\(/g) || []).length;
const passCases = (canarySrc.match(/pass\(/g) || []).length;
add(
	d4,
	5,
	'canary 双向覆盖（阳性≥5 且阴性≥3）',
	failCases >= 5 && passCases >= 3,
	'canary-gates.mjs 补阴性对照：坏门禁「永远 exit 1」也必须拿 0 分',
	'text',
);

// ---------- D5 工作流自动化 (20) ----------
const d5 = dim('工作流自动化', 20);
const hookPath = path.join(repoRoot, 'hooks/verify-before-finish.mjs');
add(
	d5,
	2,
	'verify-before-finish 收尾钩子存在',
	existsSync(hookPath),
	'写 hooks/verify-before-finish.mjs（收尾前强制 verify）',
	'text',
);
const settings = read('.claude/settings.json');
add(
	d5,
	2,
	'钩子已注册（Stop hook）',
	!!settings && /verify-before-finish/.test(settings),
	'在 .claude/settings.json 注册 Stop hook',
	'text',
);
// 正向：guard 模式必须放行（防死循环）
const hookGuard = spawnSync(process.execPath, [hookPath], {
	encoding: 'utf8',
	input: JSON.stringify({ stop_hook_active: true }),
	timeout: 120000,
});
add(
	d5,
	2,
	'收尾钩子 guard 放行实跑（stop_hook_active 防死循环）',
	hookGuard.status === 0,
	'echo stop_hook_active:true | node hooks/verify-before-finish.mjs',
);
// 反向：verify 变红时必须拦住。只测 guard 方向分不清「因 guard 放行」与「永远放行」
// ——变异实验 M09 把钩子改成无条件 exit 0，旧判据给了满分。
let hookBlocks = false;
let hookBlockDetail = '钩子缺失';
if (existsSync(hookPath)) {
	const fx = mkdtempSync(path.join(tmpdir(), 'va-hook-'));
	try {
		mkdirSync(path.join(fx, 'hooks'), { recursive: true });
		copyFileSync(hookPath, path.join(fx, 'hooks', 'verify-before-finish.mjs'));
		writeFileSync(
			path.join(fx, 'package.json'),
			JSON.stringify({ name: 'hook-fixture', version: '0.0.0', scripts: { verify: 'node -e "process.exit(1)"' } }),
		);
		const r = spawnSync(process.execPath, [path.join(fx, 'hooks', 'verify-before-finish.mjs')], {
			cwd: fx,
			encoding: 'utf8',
			input: '{}',
			timeout: 120000,
		});
		hookBlocks = r.status !== 0;
		hookBlockDetail = 'exit=' + r.status;
	} finally {
		rmSync(fx, { recursive: true, force: true });
	}
}
add(
	d5,
	4,
	'收尾钩子失败方向实跑拦截（verify 红必须拦，实测 ' + hookBlockDetail + '）',
	hookBlocks,
	'钩子在 npm run verify 失败时必须 exit 1，不能无条件放行',
);
const bugTpl = read('.github/ISSUE_TEMPLATE/bug.md');
const acSection = (bugTpl || '').split('验收标准').slice(1).join(String.fromCharCode(10));
const BT = String.fromCharCode(96);
// 真契约 = 复选项里带反引号包住的命令，或代码块；只写「看起来正常」不算
const acExecutable =
	acSection.includes(FENCE) ||
	acSection
		.split(String.fromCharCode(10))
		.filter((l) => l.trim().startsWith('- [ ]'))
		.some((l) => (l.match(new RegExp(BT, 'g')) || []).length >= 2);
add(
	d5,
	4,
	'bug 模板验收标准段含可执行断言（代码块/复选项/命令）',
	acExecutable,
	'验收标准写成可执行断言（代码块或复核项），否则只是关键词',
	'text',
);
add(
	d5,
	3,
	'bug 模板带 ai-fix 触发标签',
	!!bugTpl && /ai-fix/.test(bugTpl),
	'issue 模板 front-matter labels 加 ai-fix，供编码 agent 认领',
	'text',
);
const prTpl = read('.github/PULL_REQUEST_TEMPLATE.md');
add(
	d5,
	3,
	'PR 模板绑定 Resolves #issue',
	!!prTpl && /Resolves/.test(prTpl),
	'PR 模板加 Resolves #N，形成闭环引用',
	'text',
);

// ---------- D6 验证与测试 (10) ----------
const d6 = dim('验证与测试', 10);
add(d6, 3, 'verify 链包含测试', /test/.test(verifyChain), 'verify 链加入 npm test', 'text');
add(d6, 3, 'CI 运行测试', !!ci && /(npm test|npm run verify|node --test)/.test(ci), 'ci.yml 跑 npm run verify', 'text');
add(
	d6,
	4,
	'e2e 进 CI（允许 continue-on-error）',
	!!ci && /(test:e2e|E2E)/.test(ci),
	'ci.yml 增加 e2e job，continue-on-error: true',
	'text',
);

// ---------- score & report ----------
const total = checks.reduce((s, c) => s + c.got, 0);
const execFull = totals.exec === totals.execMax;
const tier =
	total >= 90 && execFull
		? 'Tier 1 · Exemplar'
		: total >= 90
			? 'Tier 1 未达（文本满分但执行型探针未全绿）'
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
	'证据结构：执行型 ' +
		totals.exec +
		'/' +
		totals.execMax +
		'（真跑进程取证）｜文本型 ' +
		totals.text +
		'/' +
		totals.textMax +
		'（仅文本存在性）',
	'⚠ 文本项满分上限 ' + totals.textMax + ' 分，只堆关键词也能到 Tier 3/2——所以 Tier 1 额外要求执行型探针全绿。',
	...checks.map((c) => c.name + '  ' + c.got + '/' + c.max),
	'',
	'待改进项：',
	...(hints.length ? hints : ['- 无']),
].join(String.fromCharCode(10));

console.log(text);
const floorIdx = process.argv.indexOf('--min-score');
const minScore = floorIdx >= 0 ? Number(process.argv[floorIdx + 1]) : null;
if (minScore !== null) console.log('地板分：--min-score ' + minScore + ' → ' + (total >= minScore ? '达标' : '未达标'));
if (process.argv.includes('--write-docs')) {
	mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
	const stamp = new Date().toISOString().slice(0, 10);
	writeFileSync(
		path.join(repoRoot, 'docs/ai-native-health-report.md'),
		'# AI-Native 健康报告' +
			String.fromCharCode(10, 10) +
			'> 由 scripts/assess-ai-native.mjs 生成于 ' +
			stamp +
			String.fromCharCode(10, 10) +
			FENCE +
			String.fromCharCode(10) +
			text +
			String.fromCharCode(10) +
			FENCE +
			String.fromCharCode(10),
	);
	console.log(String.fromCharCode(10) + '已写入 docs/ai-native-health-report.md');
}
if (minScore !== null && Number.isFinite(minScore) && total < minScore) {
	console.error(
		'✗ 未达成熟度地板分：' + total + '/100 < --min-score ' + minScore + '——评分器不许自己当「永远 exit 0」的假门禁',
	);
	process.exit(1);
}
process.exit(0);
