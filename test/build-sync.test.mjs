import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const build = (source, name) => {
	const match = source.match(new RegExp(name + " = '([^']+)'"));
	assert.ok(match, name + ' must be a single-quoted string literal');
	return match[1];
};

test('panel build matches the host revision prefix', () => {
	const hostRev = build(host, 'HOST_REV');
	const panelBuild = build(client, 'PANEL_BUILD');
	assert.match(hostRev, /^v\d+-/, 'HOST_REV should look like v10-<stamp>');
	assert.equal(
		hostRev.split('-')[0],
		panelBuild,
		'PANEL_BUILD must track HOST_REV or the panel warns about a false skew',
	);
});
