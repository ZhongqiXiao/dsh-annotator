/**
 * Minimal Chrome DevTools Protocol client speaking the `--remote-debugging-pipe`
 * transport: NUL-terminated JSON over fd 3 (out) / fd 4 (in).
 *
 * Why the pipe and not WebSocket: no ws dependency, no port to collide with,
 * and Chrome hands us a private channel for exactly this child process.
 */

export class CdpPipe {
	/** @param {import('node:child_process').ChildProcess} proc */
	constructor(proc, label = 'browser') {
		this.label = label;
		this.proc = proc;
		this.nextId = 1;
		this.pending = new Map();
		this.handlers = new Set();
		this.buffer = Buffer.alloc(0);
		this.closed = false;
		this.out = proc.stdio?.[3];
		this.inc = proc.stdio?.[4];
		if (!this.out || !this.inc) throw new Error('remote-debugging-pipe stdio fds are missing');
		this.out.on('error', (err) => this._failAll(err));
		this.inc.on('data', (chunk) => this._onData(chunk));
		this.inc.on('error', (err) => this._failAll(err));
		this.inc.on('close', () => this._failAll(new Error(`${this.label} pipe closed`)));
		proc.once('exit', (code, signal) => {
			this.closed = true;
			this._failAll(new Error(`${this.label} exited (code=${code} signal=${signal})`));
		});
	}

	_onData(chunk) {
		this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
		for (;;) {
			const end = this.buffer.indexOf(0);
			if (end < 0) break;
			const text = this.buffer.subarray(0, end).toString('utf8');
			this.buffer = this.buffer.subarray(end + 1);
			if (!text.trim()) continue;
			let message;
			try {
				message = JSON.parse(text);
			} catch {
				continue;
			}
			this._dispatch(message);
		}
	}

	_dispatch(message) {
		if (message.id !== undefined && this.pending.has(message.id)) {
			const entry = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) {
				const err = new Error(`${entry.method}: ${message.error.message ?? 'protocol error'}`);
				err.cdp = message.error;
				entry.reject(err);
			} else {
				entry.resolve(message.result ?? {});
			}
			return;
		}
		for (const handler of this.handlers) {
			try {
				handler(message);
			} catch {
				/* a broken listener must not break the transport */
			}
		}
	}

	send(method, params = {}, sessionId) {
		if (this.closed) return Promise.reject(new Error(`${this.label} connection is closed`));
		const id = this.nextId++;
		const payload = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, method });
			try {
				this.out.write(JSON.stringify(payload) + '\u0000');
			} catch (err) {
				this.pending.delete(id);
				reject(err);
			}
		});
	}

	onEvent(handler) {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	_failAll(err) {
		for (const entry of this.pending.values()) entry.reject(err);
		this.pending.clear();
	}

	close() {
		this.closed = true;
		this._failAll(new Error(`${this.label} connection closed`));
		try {
			this.proc.kill();
		} catch {
			/* already gone */
		}
	}
}

/**
 * WebSocket transport for `--remote-debugging-port=0`. Same interface as
 * CdpPipe, but it can also attach to a browser this process did not spawn:
 * Chrome writes the port + browser ws path into <profile>/DevToolsActivePort,
 * so after a host restart (or a singleton handoff) we reconnect to the SAME
 * window instead of spawning a duplicate one.
 */
export class CdpWs {
	/** @param {string} wsUrl e.g. ws://127.0.0.1:PORT/devtools/browser/<uuid> */
	constructor(wsUrl, label = 'browser') {
		this.label = label;
		this.proc = null; // adopted browsers have no child process of ours
		this.nextId = 1;
		this.pending = new Map();
		this.handlers = new Set();
		this.closed = false;
		this.ws = new WebSocket(wsUrl);
		this.open = new Promise((resolve, reject) => {
			this.ws.addEventListener('open', () => resolve());
			this.ws.addEventListener('error', () => reject(new Error(`${label} websocket failed to connect`)));
			setTimeout(() => reject(new Error(`${label} websocket connect timeout`)), 8000);
		});
		this.open.catch(() => {});
		this.ws.addEventListener('message', async (event) => {
			let text = event.data;
			if (typeof text !== 'string') {
				try {
					text = Buffer.from(text instanceof Blob ? await text.arrayBuffer() : text).toString('utf8');
				} catch {
					return;
				}
			}
			let message;
			try {
				message = JSON.parse(text);
			} catch {
				return;
			}
			this._dispatch(message);
		});
		this.ws.addEventListener('close', () => {
			this.closed = true;
			this._failAll(new Error(`${this.label} connection closed`));
		});
		this.ws.addEventListener('error', () => {
			if (!this.closed) {
				this.closed = true;
				this._failAll(new Error(`${this.label} websocket error`));
			}
		});
	}

	_dispatch(message) {
		if (message.id !== undefined && this.pending.has(message.id)) {
			const entry = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) {
				const err = new Error(`${entry.method}: ${message.error.message ?? 'protocol error'}`);
				err.cdp = message.error;
				entry.reject(err);
			} else {
				entry.resolve(message.result ?? {});
			}
			return;
		}
		for (const handler of this.handlers) {
			try {
				handler(message);
			} catch {
				/* a broken listener must not break the transport */
			}
		}
	}

	send(method, params = {}, sessionId) {
		if (this.closed) return Promise.reject(new Error(`${this.label} connection is closed`));
		const id = this.nextId++;
		const payload = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, method });
			try {
				this.ws.send(JSON.stringify(payload));
			} catch (err) {
				this.pending.delete(id);
				reject(err);
			}
		});
	}

	onEvent(handler) {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	_failAll(err) {
		for (const entry of this.pending.values()) entry.reject(err);
		this.pending.clear();
	}

	close() {
		this.closed = true;
		this._failAll(new Error(`${this.label} connection closed`));
		try {
			this.ws.close();
		} catch {
			/* already gone */
		}
	}
}
