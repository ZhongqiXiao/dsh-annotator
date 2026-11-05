/**
 * The DSH desktop UI is itself a local web page (Electron loads
 * http://127.0.0.1:<port>/, document title "DeepSeek Harness"). Such a page
 * must never be adopted as the debug target: it only ends up in the debug
 * window as leftover state (session restore, manual paste), and re-selecting
 * it makes the panel "navigate" the GUI web build. Match on loopback root
 * path AND title so user dev servers (localhost:5173/) stay valid targets.
 */
export function isGuiPage(url, title) {
	if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(String(url || ''))) {
		return false;
	}
	return /deepseek harness/i.test(String(title || ''));
}
