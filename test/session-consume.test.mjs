import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualPicker } from '../lib/session.js';

function seed(picks) {
	const picker = new VisualPicker();
	picker.state.picks = picks;
	return picker;
}

test('consumePicks removes the batch and keeps its screenshots restorable', async () => {
	const picker = seed([
		{ id: 1, seq: 1 },
		{ id: 2, seq: 2 },
		{ id: 3, seq: 3 },
	]);
	const result = await picker.consumePicks(['1', 3]);
	assert.equal(result.consumed, 2);
	assert.deepEqual(
		result.picks.map((pick) => pick.id),
		[2],
	);
	assert.deepEqual(
		picker.retired.map((pick) => pick.id),
		[1, 3],
	);
	picker.clear();
});

test('restorePick brings a consumed batch back in seq order and leaves retired empty', async () => {
	const picker = seed([
		{ id: 1, seq: 1 },
		{ id: 2, seq: 2 },
	]);
	await picker.consumePicks([1, 2]);
	const restored = picker.restorePick();
	assert.equal(restored.restored, 2);
	assert.deepEqual(
		restored.picks.map((pick) => pick.id),
		[1, 2],
	);
	assert.equal(picker.retired.length, 0);
	picker.clear();
});

test('consumePicks ignores unknown ids, and clear() archives the batch until close()', async () => {
	const picker = seed([{ id: 7, seq: 7 }]);
	assert.equal((await picker.consumePicks([])).consumed, 0);
	assert.equal((await picker.consumePicks([42])).consumed, 0);
	assert.equal((await picker.consumePicks([7])).consumed, 1);
	// clear() archives instead of wiping: the batch stays undoable and its chip
	// stays resolvable; only close() drops the archive and its screenshots.
	picker.clear();
	assert.equal(picker.state.picks.length, 0);
	assert.equal(picker.retired.length, 1);
	assert.equal(picker.restorePick().restored, 1);
	picker.clear();
	await picker.close();
	assert.equal(picker.retired.length, 0);
	assert.equal(picker.lastRemoved, null);
});
