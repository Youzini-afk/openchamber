import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import log from 'electron-log/main.js';

const MIN_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const BACKOFF_FACTOR = 2;

export class NotificationListener {
  #serverUrl;
  #password;
  #clientToken;
  #onNotification;
  #logger;
  #sessionCookie;
  #request;
  #reconnectTimer;
  #reconnectDelay;
  #stopped;
  #connected;

  constructor({ serverUrl, password, clientToken, onNotification, logger }) {
    this.#serverUrl = serverUrl.replace(/\/+$/, '');
    this.#password = password || '';
    this.#clientToken = typeof clientToken === 'string' ? clientToken.trim() : '';
    this.#onNotification = onNotification;
    this.#logger = logger || log;
    this.#sessionCookie = '';
    this.#request = null;
    this.#reconnectTimer = null;
    this.#reconnectDelay = MIN_RECONNECT_DELAY_MS;
    this.#stopped = true;
    this.#connected = false;
  }

  isConnected() {
    return this.#connected;
  }

  updateAuth({ password, clientToken }) {
    this.#password = password || '';
    this.#clientToken = typeof clientToken === 'string' ? clientToken.trim() : '';
    this.#sessionCookie = '';
  }

  async start() {
    if (!this.#stopped) this.stop();
    this.#stopped = false;
    this.#reconnectDelay = MIN_RECONNECT_DELAY_MS;
    this.#logger.info('[notification-listener] starting', { url: this.#serverUrl });
    await this.#connect();
  }

  stop() {
    this.#stopped = true;
    this.#connected = false;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#request) {
      try { this.#request.destroy(); } catch {}
      this.#request = null;
    }
    this.#logger.info('[notification-listener] stopped');
  }

  async #connect() {
    if (this.#stopped) return;

    try {
      if (!this.#clientToken && !this.#sessionCookie && this.#password) {
        await this.#authenticate();
      }
      this.#openSseStream();
    } catch (error) {
      this.#logger.warn('[notification-listener] connect error:', error?.message || error);
      this.#scheduleReconnect();
    }
  }

  async #authenticate() {
    const url = new URL('/auth/session', this.#serverUrl);
    const body = JSON.stringify({ password: this.#password });
    const mod = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = mod.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        rejectUnauthorized: false,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 204) {
            const setCookie = res.headers['set-cookie'];
            if (Array.isArray(setCookie) && setCookie.length > 0) {
              this.#sessionCookie = setCookie.map((c) => c.split(';')[0]).join('; ');
            }
            this.#logger.info('[notification-listener] authenticated');
            resolve();
          } else {
            reject(new Error(`auth failed: ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('auth timeout')); });
      req.setTimeout(10_000);
      req.write(body);
      req.end();
    });
  }

  #openSseStream() {
    if (this.#stopped) return;

    const url = new URL('/api/notifications/stream', this.#serverUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const headers = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };
    if (this.#sessionCookie) {
      headers.Cookie = this.#sessionCookie;
    }
    if (this.#clientToken) {
      headers.Authorization = `Bearer ${this.#clientToken}`;
    }

    const req = mod.request(url, {
      method: 'GET',
      headers,
      rejectUnauthorized: false,
    }, (res) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        this.#logger.warn('[notification-listener] auth rejected, clearing session cookie');
        this.#sessionCookie = '';
        res.resume();
        this.#scheduleReconnect();
        return;
      }

      if (res.statusCode !== 200) {
        this.#logger.warn(`[notification-listener] unexpected status: ${res.statusCode}`);
        res.resume();
        this.#scheduleReconnect();
        return;
      }

      this.#connected = true;
      this.#reconnectDelay = MIN_RECONNECT_DELAY_MS;
      this.#logger.info('[notification-listener] SSE stream connected');

      let buffer = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            this.#handleSseData(line.slice(6).trim());
          }
        }
      });

      res.on('end', () => {
        this.#connected = false;
        this.#logger.info('[notification-listener] SSE stream ended');
        this.#scheduleReconnect();
      });

      res.on('error', (error) => {
        this.#connected = false;
        this.#logger.warn('[notification-listener] SSE stream error:', error?.message);
        this.#scheduleReconnect();
      });
    });

    req.on('error', (error) => {
      this.#connected = false;
      const code = error?.code || '';
      if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
        this.#logger.warn(`[notification-listener] connection ${code}`);
      } else {
        this.#logger.warn('[notification-listener] request error:', error?.message);
      }
      this.#scheduleReconnect();
    });

    req.end();
    this.#request = req;
  }

  #handleSseData(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.type !== 'openchamber:notification') return;
      const props = parsed.properties;
      if (!props) return;
      this.#onNotification({
        title: props.title || 'OpenChamber',
        body: props.body || '',
        sessionId: props.sessionId || null,
        directory: props.directory || null,
        tag: props.tag || '',
        requireHidden: Boolean(props.requireHidden ?? props.require_hidden),
        kind: props.kind || '',
      });
    } catch {
      // Not JSON or not a notification event — ignore.
    }
  }

  #scheduleReconnect() {
    if (this.#stopped) return;
    if (this.#reconnectTimer) return;

    const delay = this.#reconnectDelay;
    this.#reconnectDelay = Math.min(this.#reconnectDelay * BACKOFF_FACTOR, MAX_RECONNECT_DELAY_MS);
    this.#logger.info(`[notification-listener] reconnecting in ${delay}ms`);

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, delay);
  }
}
