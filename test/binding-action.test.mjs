import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyBindingAction } from '../lib/shared/binding-action.js';

// 页面 -> host 的 binding 消息由这一个分类器统一把关；session 的分发和这里
// 必须一致，所以畸形 payload（非对象/数组/未知 kind）必须归 null。
test('classifyBindingAction accepts well-formed actions', () => {
	assert.equal(classifyBindingAction({ kind: 'pick' }), 'pick');
	assert.equal(classifyBindingAction({ kind: 'mode', mode: 'pick' }), 'mode');
	assert.equal(classifyBindingAction({ kind: 'mode', mode: 'off' }), 'mode');
	assert.equal(classifyBindingAction({ kind: 'undo' }), 'undo');
	assert.equal(classifyBindingAction({ kind: 'consume' }), 'consume');
});

test('classifyBindingAction rejects malformed or unknown payloads', () => {
	assert.equal(classifyBindingAction(null), null);
	assert.equal(classifyBindingAction(undefined), null);
	assert.equal(classifyBindingAction(42), null);
	assert.equal(classifyBindingAction('pick'), null);
	assert.equal(classifyBindingAction([{ kind: 'pick' }]), null);
	assert.equal(classifyBindingAction({}), null);
	assert.equal(classifyBindingAction({ kind: 'zoom' }), null);
	assert.equal(classifyBindingAction({ kind: 'mode', mode: 'pause' }), null);
	assert.equal(classifyBindingAction({ kind: 'mode', mode: 123 }), null);
});
