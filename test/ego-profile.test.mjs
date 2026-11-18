import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { VisualPicker } from '../lib/session.js';
import { EGO_CONFIG_FILE, isEgoFirstRunDone } from '../lib/shared/ego.js';

function tempProfile() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'ego-profile-'));
}

test('a brand-new ego profile gets the not-first-run flag before launch', () => {
	const dir = tempProfile();
	try {
		const picker = new VisualPicker();
		assert.equal(picker.ensureEgoNotFirstRun(dir), true);
		const raw = fs.readFileSync(path.join(dir, EGO_CONFIG_FILE), 'utf8');
		assert.deepEqual(JSON.parse(raw), { not_first_run: true });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('ego keeps its own config keys and an already-marked file is left untouched', () => {
	const dir = tempProfile();
	try {
		const file = path.join(dir, EGO_CONFIG_FILE);
		fs.writeFileSync(file, JSON.stringify({ uninstalled_agent_skill_links_removed: true }));
		const picker = new VisualPicker();
		assert.equal(picker.ensureEgoNotFirstRun(dir), true);
		const first = fs.readFileSync(file, 'utf8');
		assert.deepEqual(JSON.parse(first), {
			uninstalled_agent_skill_links_removed: true,
			not_first_run: true,
		});
		// 第二次启动不能再改文件：已标记就不重写，免得平白抖动 profile。
		assert.equal(picker.ensureEgoNotFirstRun(dir), true);
		assert.equal(fs.readFileSync(file, 'utf8'), first);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('a corrupted ego config is rewritten instead of blocking the launch', () => {
	const dir = tempProfile();
	try {
		const file = path.join(dir, EGO_CONFIG_FILE);
		fs.writeFileSync(file, '{ not json');
		const picker = new VisualPicker();
		assert.equal(picker.ensureEgoNotFirstRun(dir), true);
		assert.equal(isEgoFirstRunDone(JSON.parse(fs.readFileSync(file, 'utf8'))), true);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('an unwritable profile reports failure instead of throwing', () => {
	const dir = tempProfile();
	try {
		const picker = new VisualPicker();
		// 目录不存在 → 写入 ENOENT；这里必须返回 false 让调用方继续（只告警），不能抛。
		assert.equal(picker.ensureEgoNotFirstRun(path.join(dir, 'nope', 'deeper')), false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
