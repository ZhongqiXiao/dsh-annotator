#!/usr/bin/env node
// 合入闸门的体检与上闸工具。闸门本身是「服务端配置」，配置不在仓库里就没有人核它：
// 哪天有人在网页上把必需检查删掉、或把 job 改名让某个 context 永远不上报，PR 会静默变成「永远合不进去」或
// 「随便合进去」，两种都不是我们想要的。所以把闸门声明成 gate/branch-protection.json（配置即代码），
// 再由这个脚本做三件事：
//   node scripts/gate-doctor.mjs          静态体检（离线，进 npm run verify 与 CI）：
//                                         必需检查名必须真的存在于某个 workflow 的 job name，且该 workflow 必须在
//                                         pull_request 上触发（否则 PR 永远等不到这个 context）；开关语义必须正确。
//   node scripts/gate-doctor.mjs --live   对比线上分支保护与声明（需要 gh 且是仓库管理员）。
//   node scripts/gate-doctor.mjs --apply  把声明写进线上分支保护（幂等）。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// canary 夹具需要把体检指到临时目录；不设时体检本仓根。--live/--apply 的 git/gh 操作仍用 repoRoot。
const ROOT = process.env.DSH_VA_GATE_ROOT ? path.resolve(process.env.DSH_VA_GATE_ROOT) : repoRoot;
const GATE_FILE = path.join(ROOT, 'gate', 'branch-protection.json');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

const problems = [];
const ok = (msg) => console.log('✓ ' + msg);
const bad = (msg, hint) => {
	problems.push(msg);
	console.log('✗ ' + msg + (hint ? '\n   → ' + hint : ''));
};

const readGate = () => {
	if (!existsSync(GATE_FILE)) {
		bad('缺少 gate/branch-protection.json', '闸门必须声明成仓库里的文件，否则没人能核对线上配置');
		return null;
	}
	try {
		return JSON.parse(readFileSync(GATE_FILE, 'utf8'));
	} catch (err) {
		bad('gate/branch-protection.json 不是合法 JSON：' + err.message, '修好 JSON 再谈闸门');
		return null;
	}
};

// 极简 workflow 解析：只要「job 显示名」与「是否在 pull_request 触发」两件事。
// 不引 YAML 依赖（本仓只用 node: 内置模块），用行级扫描就够——写错缩进的话
// GitHub 自己会红，这里只防「改名 / 换触发器」这类静默失效。
const parseWorkflow = (file) => {
	const text = readFileSync(file, 'utf8');
	const jobNames = [];
	// YAML 行内注释陷阱：值未加引号时 ` #` 之后被解析器当注释吃掉，job 显示名随之截断，
	// 必需 context 永远等不到（2026-11-12 PR #12 实锤）。行级扫描必须按解析后的真实名字算。
	const commentTraps = [];
	let inJobs = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/\t/g, '  ');
		if (!line.trim() || line.trim().startsWith('#')) continue;
		const indent = line.length - line.trimStart().length;
		if (indent === 0) {
			inJobs = /^jobs:\s*$/.test(line.trim());
			continue;
		}
		if (!inJobs) continue;
		// 步骤的 `- name:` 以 "- " 开头，不是 job 名
		const m = line.trim().match(/^name:\s*(.+)$/);
		if (!m) continue;
		const value = m[1].trim();
		const quoted = /^(['"]).*\1$/.test(value);
		if (!quoted && /\s#/.test(value)) {
			commentTraps.push(value);
			jobNames.push(value.replace(/\s#.*$/, '').trim());
		} else {
			jobNames.push(value.replace(/^['"]|['"]$/g, '').trim());
		}
	}
	return {
		file: path.relative(ROOT, file),
		jobNames,
		commentTraps,
		onPullRequest: /pull_request/.test(text),
	};
};

// ---------- 静态体检：仓库自洽（离线，CI 也跑）----------
const gate = readGate();
const workflows = existsSync(WORKFLOW_DIR)
	? readdirSync(WORKFLOW_DIR)
			.filter((f) => /\.ya?ml$/.test(f))
			.map((f) => parseWorkflow(path.join(WORKFLOW_DIR, f)))
	: [];
if (!workflows.length) bad('.github/workflows/ 下没有任何 workflow', '闸门必需检查至少要有 job 去上报');

// job name 里未加引号的 ` #` = 行内注释截断：必需检查名永远上报不上来（幽灵检查卡死所有 PR）。
for (const w of workflows) {
	for (const t of w.commentTraps) {
		bad(
			'job name「' + t + '」（' + w.file + '）未加引号且含 " #"——YAML 行内注释陷阱',
			'解析器会把 # 之后当注释吃掉，实际 job 名是「' +
				t.replace(/\s#.*$/, '').trim() +
				'」，必需 context 永远等不到 → 所有 PR 卡死。给 name 值加引号（双引号或单引号均可）',
		);
	}
}

if (gate) {
	if (!Array.isArray(gate.requiredChecks) || gate.requiredChecks.length === 0) {
		bad('requiredChecks 为空', '没有必需检查的分支保护等于「谁都能合」，把 Verify / e2e 等写进去');
	}
	// 每个必需检查都必须能在某条 workflow 的 job name 里找到，且那条 workflow 在 PR 上触发。
	// 少一个 = 该 context 永远不上报 = 所有 PR 永久卡在「Waiting for status to be reported」。
	for (const check of gate.requiredChecks || []) {
		const owner = workflows.find((w) => w.jobNames.includes(check));
		if (!owner) {
			bad(
				'必需检查「' + check + '」在任何 workflow 的 job 显示名里都找不到',
				'job 被改名了，分支保护却在等旧名字 → 所有 PR 永久合不进去。改回 job name，或同步改 gate/branch-protection.json',
			);
			continue;
		}
		if (!owner.onPullRequest) {
			bad(
				'必需检查「' + check + '」所在 workflow（' + owner.file + '）不在 pull_request 触发',
				'只有 push 触发的 job 在 PR 上不会上报，分支保护会一直等它。给 workflow 加 pull_request 触发器',
			);
			continue;
		}
		if (owner.onPullRequest) ok('必需检查「' + check + '」由 ' + owner.file + ' 在 PR 上上报');
	}
	if (gate.strict !== true) {
		bad('strict 必须为 true', '否则分支落后 main 也能合：你测的是旧基线的绿，合进去的是没测过的新代码');
	} else ok('strict=true：分支必须与 main 同步，测过的和合进去的是同一份');

	if (gate.enforceAdmins !== true) {
		bad('enforceAdmins 必须为 true', '否则管理员（也就是你自己）能绕过所有检查合入，闸门形同虚设');
	} else ok('enforceAdmins=true：管理员也不能绕');
	if (gate.allowForcePushes !== false || gate.allowDeletions !== false) {
		bad('allowForcePushes / allowDeletions 必须为 false', '允许强推或删 main 等于把历史与闸门一起抹掉');
	} else ok('force push 与删除 main 均禁止');

	if (!existsSync(path.join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'))) {
		bad('缺少 .github/PULL_REQUEST_TEMPLATE.md', 'PR 模板是「Resolves #N」闭环的入口');
	}
}

// ---------- 线上比对 / 上闸（需要 gh + 管理员）----------
const args = new Set(process.argv.slice(2));
const repoSlug = () => {
	if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
	const r = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd: repoRoot, encoding: 'utf8' });
	const url = (r.stdout || '').trim();
	const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
	return m ? m[1] + '/' + m[2] : null;
};
const gh = (ghArgs, input) => {
	const r = spawnSync('gh', ghArgs, { cwd: repoRoot, encoding: 'utf8', input, timeout: 60000 });
	return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
};

const protectionPayload = (g) => ({
	required_status_checks: { strict: g.strict, contexts: g.requiredChecks },
	enforce_admins: g.enforceAdmins,
	required_pull_request_reviews: {
		dismiss_stale_reviews: false,
		require_code_owner_reviews: false,
		required_approving_review_count: g.requiredApprovals || 0,
	},
	restrictions: null,
	allow_force_pushes: g.allowForcePushes,
	allow_deletions: g.allowDeletions,
});

const liveProtection = (repo, branch) => {
	const r = gh(['api', 'repos/' + repo + '/branches/' + branch + '/protection']);
	if (r.status !== 0) return { error: r.out.trim() };
	try {
		return { data: JSON.parse(r.stdout) };
	} catch (err) {
		return { error: '无法解析分支保护响应：' + err.message };
	}
};

if ((args.has('--live') || args.has('--apply')) && gate) {
	const repo = repoSlug();
	if (!repo) {
		bad(
			'拿不到仓库名（没有 GITHUB_REPOSITORY，git remote 也不是 GitHub）',
			'在 GitHub 仓库里跑，或设置 GITHUB_REPOSITORY',
		);
	} else if (args.has('--apply')) {
		const body = JSON.stringify(protectionPayload(gate));
		const r = gh(
			['api', '--method', 'PUT', 'repos/' + repo + '/branches/' + gate.branch + '/protection', '--input', '-'],
			body,
		);
		if (r.status !== 0) bad('上闸失败：' + r.out.trim(), '确认 gh 已登录且对仓库有 admin 权限');
		else ok('已写入线上分支保护：' + repo + ' @ ' + gate.branch);
	}

	if (!args.has('--apply')) {
		const live = liveProtection(repo, gate.branch);
		if (live.error) {
			bad('读不到线上分支保护：' + live.error.split('\n')[0], 'gh 需要 admin 权限；没配闸门就跑 npm run gate:apply');
		} else {
			const d = live.data;
			const liveChecks = (d.required_status_checks && d.required_status_checks.contexts) || [];
			const missing = gate.requiredChecks.filter((c) => !liveChecks.includes(c));
			const extra = liveChecks.filter((c) => !gate.requiredChecks.includes(c));
			if (missing.length) bad('线上缺少必需检查：' + missing.join(' / '), 'npm run gate:apply');
			if (extra.length)
				bad('线上多了未声明的必需检查：' + extra.join(' / '), '多出来的 context 会挡住合并，声明它或从线上删');
			if (d.required_status_checks && d.required_status_checks.strict !== gate.strict)
				bad('线上 strict=' + d.required_status_checks.strict + '，声明是 ' + gate.strict, 'npm run gate:apply');
			const admins = d.enforce_admins && d.enforce_admins.enabled;
			if (admins !== gate.enforceAdmins)
				bad('线上 enforce_admins=' + admins + '，声明是 ' + gate.enforceAdmins, 'npm run gate:apply');
			if (
				!missing.length &&
				!extra.length &&
				d.required_status_checks.strict === gate.strict &&
				admins === gate.enforceAdmins
			)
				ok('线上分支保护与 gate/branch-protection.json 完全一致（' + liveChecks.length + ' 个必需检查）');
		}
	}
}

console.log('');
if (problems.length) {
	console.log('合入闸门体检：' + problems.length + ' 项不合格');
	process.exit(1);
}
if (args.has('--live') || args.has('--apply')) console.log('合入闸门体检：静态 + 线上全部一致');
else console.log('合入闸门体检：静态检查全部通过（' + (gate ? gate.requiredChecks.length : 0) + ' 个必需检查）');
process.exit(0);
