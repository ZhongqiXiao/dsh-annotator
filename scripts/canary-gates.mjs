#!/usr/bin/env node
/**
 * Canary drill for the two physical gates (clb-new lesson: a gate that has
 * never failed is worth 0). Builds throwaway fixtures in a temp dir, injects
 * synthetic violations, and requires every gate to EXIT 1 with the expected
 * finding. Exits 0 only when all drills behave. Repo files are never touched.
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
const run = (label, cmd, args, expectText) => cases.push({ label, cmd, args, expectText });

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

	// --- fixture: static skew (PANEL_BUILD left behind) ---
	const skewDir = path.join(tempRoot, 'skew', 'lib');
	copyLib(skewDir);
	const skewClient = readFileSync(path.join(skewDir, 'client.js'), 'utf8');
	writeFileSync(
		path.join(skewDir, 'client.js'),
		replaceOrThrow(skewClient, /PANEL_BUILD = 'v\d+'/, "PANEL_BUILD = 'v0'", 'PANEL_BUILD'),
	);
	run(
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
	run(
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
	run(
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
	g(['-c', 'user.email=canary@example.invalid', '-c', 'user.name=canary', 'add', '.']);
	g(['-c', 'user.email=canary@example.invalid', '-c', 'user.name=canary', 'commit', '-q', '-m', 'rev v1']);
	// client.js edited AFTER the rev commit without bumping -> must be flagged
	writeFileSync(
		path.join(gitLib, 'client.js'),
		readFileSync(path.join(gitLib, 'client.js'), 'utf8') + '\n// late edit without a rev bump\n',
	);
	g(['-c', 'user.email=canary@example.invalid', '-c', 'user.name=canary', 'add', '.']);
	g(['-c', 'user.email=canary@example.invalid', '-c', 'user.name=canary', 'commit', '-q', '-m', 'late client edit']);
	run(
		'build-sync history rule catches a late client.js edit',
		process.execPath,
		[script('check-build-sync.mjs'), '--repo', gitRoot],
		'client.js',
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
	og(['-c', 'user.email=canary@example.invalid', '-c', 'user.name=canary', 'add', '.']);
	og(['-c', 'user.email=canary@example.invalid', '-c', 'user.name=canary', 'commit', '-q', '-m', 'rev v1']);
	writeFileSync(
		path.join(ovLib, 'overlay.js'),
		replaceOrThrow(
			readFileSync(path.join(ovLib, 'overlay.js'), 'utf8'),
			'var REV = 1;',
			'var REV = 1; // payload touch',
			'payload touch',
		),
	);
	og(['-c', 'user.email=canary@example.invalid', '-c', 'user.name=canary', 'add', '.']);
	og(['-c', 'user.email=canary@example.invalid', '-c', 'user.name=canary', 'commit', '-q', '-m', 'payload touch']);
	run(
		'build-sync history rule catches a payload edit without a REV bump',
		process.execPath,
		[script('check-build-sync.mjs'), '--repo', ovRoot],
		'overlay-without-bump',
	);

	// --- run every drill: the gate MUST fail with the expected finding ---
	let failed = false;
	for (const c of cases) {
		const r = spawnSync(c.cmd, c.args, { encoding: 'utf8' });
		const out = (r.stdout || '') + (r.stderr || '');
		const ok = r.status === 1 && c.expectText.split('|').every((t) => out.includes(t));
		console.log((ok ? '✓' : '✗') + ' canary: ' + c.label);
		if (!ok) {
			failed = true;
			console.log('  期望 exit=1 且输出包含 ' + JSON.stringify(c.expectText));
			console.log('  实际 exit=' + r.status);
			console.log('  实际输出(截断): ' + out.slice(0, 600));
		}
	}
	if (failed) {
		console.error('✗ canary 演练失败：有门禁没有真判失败，或报错不含预期线索。');
		process.exit(1);
	}
	console.log('✓ canary 演练通过：' + cases.length + ' 个注入场景全部被门禁拦下。');
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}
