import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseVersionReply, normalizeCdpBase, externalCandidates } from '../lib/shared/cdp-endpoint.js';

test('normalizeCdpBase accepts bare host:port, URLs and version URLs', () => {
	assert.equal(normalizeCdpBase('127.0.0.1:9222'), 'http://127.0.0.1:9222');
	assert.equal(normalizeCdpBase(' http://127.0.0.1:9222/ '), 'http://127.0.0.1:9222');
	assert.equal(normalizeCdpBase('http://127.0.0.1:9222/json/version'), 'http://127.0.0.1:9222');
	assert.equal(normalizeCdpBase('https://devbox.local:9444/'), 'https://devbox.local:9444');
	assert.equal(normalizeCdpBase(''), null);
	assert.equal(normalizeCdpBase('   '), null);
	assert.equal(normalizeCdpBase('ws://127.0.0.1:9222/devtools/browser/x'), null);
});

test('externalCandidates only ever returns an explicitly configured endpoint', () => {
	assert.deepEqual(externalCandidates({ DSH_VISUAL_ANNOTATOR_CDP_URL: '127.0.0.1:9333' }), ['http://127.0.0.1:9333']);
	// Never sniff the conventional ports: 9222 may well be the user's daily Chrome.
	assert.deepEqual(externalCandidates({}), []);
	assert.deepEqual(externalCandidates({ DSH_VISUAL_ANNOTATOR_REUSE: '1' }), []);
	assert.deepEqual(externalCandidates({ DSH_VISUAL_ANNOTATOR_CDP_URL: '  ' }), []);
});

test('parseVersionReply only trusts a browser-level ws endpoint', () => {
	const base = 'http://127.0.0.1:9222';
	const good = JSON.stringify({
		Browser: 'Chrome/140.0.0.0',
		webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc-123',
	});
	assert.equal(parseVersionReply(good, base), 'ws://127.0.0.1:9222/devtools/browser/abc-123');
	// No /devtools/browser/ path: some other JSON service on the port, not a browser.
	assert.equal(parseVersionReply(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/socket' }), base), null);
	assert.equal(parseVersionReply(JSON.stringify({ Browser: 'Chrome/140.0.0.0' }), base), null);
	assert.equal(parseVersionReply('not json', base), null);
	// A remote ws endpoint disguised as localhost's reply must be rejected.
	assert.equal(
		parseVersionReply(JSON.stringify({ webSocketDebuggerUrl: 'ws://evil.example:9222/devtools/browser/x' }), base),
		null,
	);
});
