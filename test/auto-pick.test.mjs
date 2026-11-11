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

test('逃生阀关掉自动触发，但手动打开仍然有效', () => {
	for (const trigger of ['launch', 'open-page', 'user-off']) {
		assert.equal(decideAutoPick(trigger, { autoPickEnabled: false, userTurnedOff: false }), 'off');
	}
	assert.equal(decideAutoPick('user-on', { autoPickEnabled: false, userTurnedOff: false }), 'pick');
});

test('未知 trigger 不抛错，返回 off', () => {
	assert.doesNotThrow(() => decideAutoPick('not-exists', { autoPickEnabled: true, userTurnedOff: false }));
	assert.equal(decideAutoPick('not-exists', { autoPickEnabled: true, userTurnedOff: false }), 'off');
});
