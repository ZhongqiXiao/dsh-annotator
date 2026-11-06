import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualPicker } from '../lib/session.js';

test('consumed picks stay readable for an inserted chip that is submitted later', async () => {
	const picker = new VisualPicker();
	picker.state.picks = [
		{ id: 'p1', seq: 1, selector: '#a', comment: '第一轮' },
		{ id: 'p2', seq: 2, selector: '#b', comment: '第二轮' },
	];
	await picker.consumePicks(['p1']);
	assert.deepEqual(
		picker.snapshot().picks.map((pick) => pick.id),
		['p2'],
	);
	assert.equal(picker.findPick('p1')?.selector, '#a');
	assert.equal(picker.findPick('p2')?.selector, '#b');
	assert.equal(picker.findPick('p9'), null);
	assert.deepEqual(
		picker.readablePicks().map((pick) => pick.id),
		['p1', 'p2'],
	);
	picker.clear();
});

test('clear() keeps the archive readable and close() finally drops it', async () => {
	const picker = new VisualPicker();
	picker.state.picks = [{ id: 'p1', seq: 1, selector: '#a' }];
	await picker.consumePicks(['p1']);
	picker.clear();
	assert.equal(picker.findPick('p1')?.selector, '#a');
	assert.deepEqual(
		picker.readablePicks().map((pick) => pick.id),
		['p1'],
	);
	await picker.close();
	assert.equal(picker.findPick('p1'), null);
	assert.deepEqual(picker.readablePicks(), []);
});
