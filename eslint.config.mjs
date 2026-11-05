import globals from 'globals';

export default [
	{
		ignores: ['node_modules/', 'tmp*/', 'profile-*/'],
	},
	{
		// Web panel: runs inside the browser GUI.
		files: ['lib/client.js'],
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: 'script',
			globals: { ...globals.browser },
		},
	},
	{
		// Host side: runs in the DSH plugin host (Node 22). overlay.js is ESM
		// host code; the injected page script lives in a template string in it.
		files: ['lib/**/*.js', 'test/**/*.mjs'],
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: 'module',
			globals: { ...globals.node },
		},
		rules: {
			'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
		},
	},
];
