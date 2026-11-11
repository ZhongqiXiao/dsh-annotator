import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VisualPicker } from '../lib/session.js';
import { decideAutoPick } from '../lib/shared/auto-pick.js';

const mk = () =>
	new VisualPicker({ baseDir: path.join(os.tmpdir(), 'va-auto-pick-' + Math.random().toString(36).slice(2)) });

// 纯函数用例（test/auto-pick.test.mjs）证明不了「面板关掉之后真的不再自动开」：
// 那一条靠的是 setMode 里的记账，只有真的走一遍 session 才看得见。
test('面板关掉后 open-page / launch 都不再自动 pick（粘住）', async () => {
	const picker = mk();
	assert.equal(picker.userTurnedOff, false);
	await picker.setMode('off'); // 面板路径：不带 options，即用户操作
	assert.equal(picker.userTurnedOff, true);
	assert.equal(decideAutoPick('open-page', picker), 'off');
	assert.equal(decideAutoPick('launch', picker), 'off');
});

test('手动再打开后恢复自动', async () => {
	const picker = mk();
	await picker.setMode('off');
	await picker.setMode('pick');
	assert.equal(picker.userTurnedOff, false);
	assert.equal(decideAutoPick('open-page', picker), 'pick');
});

test('自动切换为 off 不会被误记成「用户关掉」', async () => {
	const picker = mk();
	await picker.setMode('off', { trigger: 'auto' });
	assert.equal(picker.userTurnedOff, false);
	assert.equal(decideAutoPick('open-page', picker), 'pick');
});

test('逃生阀 AUTO_PICK=0 时 launch 也不自动 pick', () => {
	const old = process.env.DSH_VISUAL_ANNOTATOR_AUTO_PICK;
	process.env.DSH_VISUAL_ANNOTATOR_AUTO_PICK = '0';
	try {
		const picker = mk();
		assert.equal(picker.autoPickEnabled, false);
		assert.equal(decideAutoPick('launch', picker), 'off');
	} finally {
		if (old === undefined) delete process.env.DSH_VISUAL_ANNOTATOR_AUTO_PICK;
		else process.env.DSH_VISUAL_ANNOTATOR_AUTO_PICK = old;
	}
});
