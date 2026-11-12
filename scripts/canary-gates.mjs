#!/usr/bin/env node
/**
 * Canary drill for the physical gates and the scorer.
 *
 * clb-new lesson, in full: a gate that has never failed is worth 0 — but
 * that lesson has three heads, and each needs its own probe:
 * 1. 永远 exit 0（配置存在性评分）→ 阳性对照：注入违规必须被拦（exit 1）；
 * 2. 永远 exit 1（坏门禁把一切拦死）→ 阴性对照：干净夹具与同提交递增必须放行（exit 0）；
 * 3. 门禁自身永远 exit 0（评分器不设阈值）→ 评分器自证：--min-score 101 必须红、0 必须绿。
 *
 * Fixtures live in a temp dir; repo files are never touched. The scorer sets
 * DSH_VA_ASSESS_DEPTH when it invokes us, so group 3 (scorer self-proof) still
 * runs one level down and stops at depth 2 (recursion guard that does not
 * blind the drill).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libDir = path.join(repoRoot, 'lib');
const script = (name) => path.join(repoRoot, 'scripts', name);

const cases = [];
const fail = (label, cmd, args, expectText, env) => cases.push({ label, cmd, args, expectText, env, kind: 'fail' });
const pass = (label, cmd, args, env) => cases.push({ label, cmd, args, env, kind: 'pass' });

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'dsh-va-canary-'));

try {
	const copyLib = (destLib) => {
		mkdirSync(destLib, { recursive: true });
		for (const f of ['index.js', 'client.js', 'overlay.js']) {
			writeFileSync(path.join(destLib, f), readFileSync(path.join(libDir, f), 'utf8'));
		}
	};
	// replaceOrThrow: a canary fixture whose injection silently no-ops would
	// fake a passing drill; refuse to continue instead.
	const replaceOrThrow = (text, from, to, what) => {
		const next = text.replace(from, to);
		if (next === text) throw new Error('canary 夹具注入失败（替换未生效）: ' + what);
		return next;
	};
	const gitId = ['-c', 'user.email=canary@example.invalid', '-c', 'user.name=canary'];

	// ============ 阳性（fail）：注入违规，门禁必须真判失败 ============

	// --- fixture: static skew (PANEL_BUILD left behind) ---
	const skewDir = path.join(tempRoot, 'skew', 'lib');
	copyLib(skewDir);
	const skewClient = readFileSync(path.join(skewDir, 'client.js'), 'utf8');
	writeFileSync(
		path.join(skewDir, 'client.js'),
		replaceOrThrow(skewClient, /PANEL_BUILD = 'v\d+'/, "PANEL_BUILD = 'v0'", 'PANEL_BUILD'),
	);
	fail(
		'build-sync catches a PANEL_BUILD skew',
		process.execPath,
		[script('check-build-sync.mjs'), '--lib', skewDir, '--skip-history'],
		'prefix-mismatch',
	);

	// --- fixture: Node API smuggled into the panel script ---
	const clientDir = path.join(tempRoot, 'client', 'lib');
	copyLib(clientDir);
	const clientCanary = readFileSync(path.join(clientDir, 'client.js'), 'utf8') + '\nvar canary = process.env.HOME;\n';
	writeFileSync(path.join(clientDir, 'client.js'), clientCanary);
	fail(
		'embedded-runtime catches process.* in client.js',
		process.execPath,
		[script('check-embedded-runtime.mjs'), '--lib', clientDir],
		'process-global',
	);

	// --- fixture: require() smuggled into the overlay page payload ---
	const payloadDir = path.join(tempRoot, 'payload', 'lib');
	copyLib(payloadDir);
	const overlayCanary = readFileSync(path.join(payloadDir, 'overlay.js'), 'utf8').replace(
		/var REV = \d+;/,
		(match) => match + "\nvar probe = require('node:fs');",
	);
	writeFileSync(path.join(payloadDir, 'overlay.js'), overlayCanary);
	fail(
		'embedded-runtime catches require() inside the page payload',
		process.execPath,
		[script('check-embedded-runtime.mjs'), '--lib', payloadDir],
		'require-call',
	);

	// --- fixture: history rule (client edited without bumping HOST_REV) ---
	const gitRoot = path.join(tempRoot, 'hist');
	const gitLib = path.join(gitRoot, 'lib');
	copyLib(gitLib);
	writeFileSync(path.join(gitLib, 'index.js'), "const HOST_REV = 'v1-' + Date.now();\n");
	writeFileSync(
		path.join(gitLib, 'client.js'),
		replaceOrThrow(
			readFileSync(path.join(gitLib, 'client.js'), 'utf8'),
			/PANEL_BUILD = 'v\d+'/,
			"PANEL_BUILD = 'v1'",
			'PANEL_BUILD(v1)',
		),
	);
	writeFileSync(
		path.join(gitLib, 'overlay.js'),
		replaceOrThrow(readFileSync(path.join(gitLib, 'overlay.js'), 'utf8'), /var REV = \d+;/, 'var REV = 1;', 'REV(v1)'),
	);
	const g = (args) => execFileSync('git', args, { cwd: gitRoot, encoding: 'utf8' });
	g(['init', '-q']);
	g([...gitId, 'add', '.']);
	g([...gitId, 'commit', '-q', '-m', 'rev v1']);
	// client.js edited AFTER the rev commit without bumping -> must be flagged
	writeFileSync(
		path.join(gitLib, 'client.js'),
		readFileSync(path.join(gitLib, 'client.js'), 'utf8') + '\n// late edit without a rev bump\n',
	);
	g([...gitId, 'add', '.']);
	g([...gitId, 'commit', '-q', '-m', 'late client edit']);
	fail(
		'build-sync history rule catches a late client.js edit',
		process.execPath,
		[script('check-build-sync.mjs'), '--repo', gitRoot],
		'client-without-bump',
	);

	// --- fixture: overlay payload edited without bumping REV ---
	const ovRoot = path.join(tempRoot, 'ovhist');
	const ovLib = path.join(ovRoot, 'lib');
	copyLib(ovLib);
	writeFileSync(path.join(ovLib, 'index.js'), "const HOST_REV = 'v1-' + Date.now();\n");
	writeFileSync(
		path.join(ovLib, 'client.js'),
		replaceOrThrow(
			readFileSync(path.join(ovLib, 'client.js'), 'utf8'),
			/PANEL_BUILD = 'v\d+'/,
			"PANEL_BUILD = 'v1'",
			'PANEL_BUILD(v1)',
		),
	);
	writeFileSync(
		path.join(ovLib, 'overlay.js'),
		replaceOrThrow(readFileSync(path.join(ovLib, 'overlay.js'), 'utf8'), /var REV = \d+;/, 'var REV = 1;', 'REV(v1)'),
	);
	const og = (args) => execFileSync('git', args, { cwd: ovRoot, encoding: 'utf8' });
	og(['init', '-q']);
	og([...gitId, 'add', '.']);
	og([...gitId, 'commit', '-q', '-m', 'rev v1']);
	writeFileSync(
		path.join(ovLib, 'overlay.js'),
		replaceOrThrow(
			readFileSync(path.join(ovLib, 'overlay.js'), 'utf8'),
			'var REV = 1;',
			'var REV = 1; // payload touch',
			'payload touch',
		),
	);
	og([...gitId, 'add', '.']);
	og([...gitId, 'commit', '-q', '-m', 'payload touch']);
	fail(
		'build-sync history rule catches a payload edit without a REV bump',
		process.execPath,
		[script('check-build-sync.mjs'), '--repo', ovRoot],
		'overlay-without-bump',
	);

	// ============ 阴性（pass）：干净夹具必须放行，防「永远 exit 1」 ============

	const cleanDir = path.join(tempRoot, 'clean', 'lib');
	copyLib(cleanDir);
	pass('build-sync passes a clean lib copy', process.execPath, [
		script('check-build-sync.mjs'),
		'--lib',
		cleanDir,
		'--skip-history',
	]);
	const cleanDir2 = path.join(tempRoot, 'clean2', 'lib');
	copyLib(cleanDir2);
	pass('embedded-runtime passes a clean lib copy', process.execPath, [
		script('check-embedded-runtime.mjs'),
		'--lib',
		cleanDir2,
	]);

	// --- clean history: same-commit edit + bump is legal -> must pass ---
	const sameRoot = path.join(tempRoot, 'same');
	const sameLib = path.join(sameRoot, 'lib');
	copyLib(sameLib);
	writeFileSync(path.join(sameLib, 'index.js'), "const HOST_REV = 'v1-' + Date.now();\n");
	writeFileSync(
		path.join(sameLib, 'client.js'),
		replaceOrThrow(
			readFileSync(path.join(sameLib, 'client.js'), 'utf8'),
			/PANEL_BUILD = 'v\d+'/,
			"PANEL_BUILD = 'v1'",
			'PANEL_BUILD(v1)',
		),
	);
	writeFileSync(
		path.join(sameLib, 'overlay.js'),
		replaceOrThrow(readFileSync(path.join(sameLib, 'overlay.js'), 'utf8'), /var REV = \d+;/, 'var REV = 1;', 'REV(v1)'),
	);
	const sg = (args) => execFileSync('git', args, { cwd: sameRoot, encoding: 'utf8' });
	sg(['init', '-q']);
	sg([...gitId, 'add', '.']);
	sg([...gitId, 'commit', '-q', '-m', 'rev v1']);
	// same commit: client.js edit AND the v1 -> v2 bump together -> legal
	writeFileSync(
		path.join(sameLib, 'client.js'),
		readFileSync(path.join(sameLib, 'client.js'), 'utf8').replace(/PANEL_BUILD = 'v\d+'/, "PANEL_BUILD = 'v2'") +
			'\n// edited and bumped in one commit\n',
	);
	writeFileSync(path.join(sameLib, 'index.js'), "const HOST_REV = 'v2-' + Date.now();\n");
	sg([...gitId, 'add', '.']);
	sg([...gitId, 'commit', '-q', '-m', 'edit + bump v2 together']);
	pass('build-sync passes a same-commit edit+bump', process.execPath, [
		script('check-build-sync.mjs'),
		'--repo',
		sameRoot,
	]);

	// ============ 浅克隆假绿路径：CI 里必须直接红，本地放行 ============

	const shalRoot = path.join(tempRoot, 'shal');
	execFileSync('git', ['clone', '-q', '--depth', '1', 'file://' + sameRoot, shalRoot], { encoding: 'utf8' });
	fail(
		'build-sync fails a shallow clone inside CI (no silent fake-green)',
		process.execPath,
		[script('check-build-sync.mjs'), '--repo', shalRoot],
		'shallow-clone',
		{ CI: '1', GITHUB_ACTIONS: '1' },
	);
	pass(
		'build-sync warns (passes) a shallow clone outside CI',
		process.execPath,
		[script('check-build-sync.mjs'), '--repo', shalRoot],
		{ CI: '', GITHUB_ACTIONS: '' },
	);

	// --- gate-doctor: YAML 行内注释陷阱（job name 未加引号，# 之后被吃掉）---
	// 2026-11-12 PR #12 实锤：name: PR contract (Resolves #N) 不加引号，实际 job 名被截断成
	// PR contract (Resolves，必需 context 永不上报，所有 PR 卡死。双向探针防检测本身退化。
	const gateFixture = (root, quoted) => {
		mkdirSync(path.join(root, 'gate'), { recursive: true });
		mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
		writeFileSync(
			path.join(root, 'gate', 'branch-protection.json'),
			JSON.stringify(
				{
					branch: 'main',
					strict: true,
					enforceAdmins: true,
					requiredApprovals: 0,
					allowForcePushes: false,
					allowDeletions: false,
					requiredChecks: ['PR contract (Resolves #N)'],
				},
				null,
				'\t',
			),
		);
		const nameLine = quoted ? '    name: "PR contract (Resolves #N)"' : '    name: PR contract (Resolves #N)';
		writeFileSync(
			path.join(root, '.github', 'workflows', 'pr-gate.yml'),
			`name: PR Gate
on:
  pull_request:
jobs:
  issue-contract:
${nameLine}
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`,
		);
		writeFileSync(path.join(root, '.github', 'PULL_REQUEST_TEMPLATE.md'), '# PR\n\nResolves #N\n');
	};
	const gateTrapRoot = path.join(tempRoot, 'gate-trap');
	gateFixture(gateTrapRoot, false);
	fail(
		'gate-doctor catches an unquoted # in a job name (YAML inline comment trap)',
		process.execPath,
		[script('gate-doctor.mjs')],
		'行内注释陷阱|吃掉',
		{ DSH_VA_GATE_ROOT: gateTrapRoot },
	);
	const gateOkRoot = path.join(tempRoot, 'gate-ok');
	gateFixture(gateOkRoot, true);
	pass('gate-doctor passes a properly quoted job name fixture', process.execPath, [script('gate-doctor.mjs')], {
		DSH_VA_GATE_ROOT: gateOkRoot,
	});

	// ============ 评分器自证：它自己不许是「永远 exit 0」 ============

	// 评分器自证：默认始终执行。只在第二层嵌套（canary→评分器→canary）时停下，
	// 否则无限递归；第一层必须真跑，否则「评分器把地板分删了」这类变异永远发现不了。
	if (Number(process.env.DSH_VA_ASSESS_DEPTH || '0') < 2) {
		fail(
			'scorer --min-score 101 fails (it can actually exit non-zero)',
			process.execPath,
			[script('assess-ai-native.mjs'), '--min-score', '101'],
			'min-score',
		);
		pass('scorer --min-score 0 passes', process.execPath, [script('assess-ai-native.mjs'), '--min-score', '0']);
	}

	// --- run every drill ---
	let failed = false;
	const tally = { fail: 0, pass: 0 };
	for (const c of cases) {
		const r = spawnSync(c.cmd, c.args, { encoding: 'utf8', env: { ...process.env, ...(c.env || {}) } });
		const out = (r.stdout || '') + (r.stderr || '');
		const ok =
			c.kind === 'fail' ? r.status === 1 && c.expectText.split('|').every((t) => out.includes(t)) : r.status === 0;
		if (ok) tally[c.kind] += 1;
		console.log((ok ? '✓' : '✗') + ' canary[' + c.kind + ']: ' + c.label);
		if (!ok) {
			failed = true;
			const want = c.kind === 'fail' ? 'exit=1 且输出含 ' + JSON.stringify(c.expectText) : 'exit=0';
			console.log('  期望 ' + want);
			console.log('  实际 exit=' + r.status);
			console.log('  实际输出(截断): ' + out.slice(0, 600));
		}
	}
	if (failed) {
		console.error('✗ canary 演练失败：有门禁没按预期工作（该拦的没拦，或该放的没放）。');
		process.exit(1);
	}
	console.log(
		'✓ canary 演练通过：' + cases.length + ' 个场景（阳性 ' + tally.fail + ' / 阴性 ' + tally.pass + '）全部符合预期。',
	);
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
