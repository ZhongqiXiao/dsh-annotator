/**
 * Classify a JSON payload the page overlay reports through the CDP binding.
 * Pure on purpose: the host dispatch in session.js and the unit tests share
 * this one source of truth, and junk from the page must never reach a branch
 * we did not design for.
 */

/**
 * @param {unknown} payload parsed JSON from Runtime.bindingCalled
 * @returns {'pick' | 'mode' | 'undo' | 'consume' | null} null for anything not actionable
 */
export function classifyBindingAction(payload) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
	switch (payload.kind) {
		case 'pick':
			return 'pick';
		case 'mode':
			return payload.mode === 'pick' || payload.mode === 'off' ? 'mode' : null;
		case 'undo':
			return 'undo';
		case 'consume':
			return 'consume';
		default:
			return null;
	}
}
