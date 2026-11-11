import assert from 'node:assert/strict';
import test from 'node:test';

import { decideAutoPick, nextUserTurnedOff } from '../lib/shared/auto-pick.js';

test('launch + 自动开启时进入 pick', () => {
	assert.equal(decideAutoPick('launch', { autoPickEnabled: true, userTurnedOff: false }), 'pick');
});

test('open-page + 自动开启 + 未手动关时进入 pick', () => {
	assert.equal(decideAutoPick('open-page', { autoPickEnabled: true, userTurnedOff: false }), 'pick');
});

test('open-page + 用户手动关后保持 off（粘住）', () => {
	assert.equal(decideAutoPick('open-page', { autoPickEnabled: true, userTurnedOff: true }), 'off');
});

test('user-on 后再次 open-page 会回到 pick', () => {
	const userTurnedOff = nextUserTurnedOff('user-on', true);
	assert.equal(userTurnedOff, false);
	assert.equal(decideAutoPick('open-page', { autoPickEnabled: true, userTurnedOff }), 'pick');
});

test('DSH_VISUAL_ANNOTATOR_AUTO_PICK=0 时所有 trigger 都是 off', () => {
	for (const trigger of ['launch', 'open-page', 'user-on', 'user-off']) {
		assert.equal(decideAutoPick(trigger, { autoPickEnabled: false, userTurnedOff: false }), 'off');
	}
});

test('未知 trigger 不抛错，返回 off', () => {
	assert.doesNotThrow(() => decideAutoPick('not-exists', { autoPickEnabled: true, userTurnedOff: false }));
	assert.equal(decideAutoPick('not-exists', { autoPickEnabled: true, userTurnedOff: false }), 'off');
});
