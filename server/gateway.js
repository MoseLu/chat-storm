/**
 * OpenClaw Gateway Client — WebSocket bridge to OpenClaw instance
 *
 * Protocol: JSON-RPC over WebSocket
 *   Connect:  ws://127.0.0.1:{port}/__openclaw__/ws
 *   Handshake: send connect → receive hello-ok
 *   Send:     chat.send → stream agent.delta → agent.final
 */

import WebSocket from 'ws';

// ── Port mapping (matches OpenClaw-MultiInstance deploy) ────────────
export const GATEWAY_PORTS = {
  alpha: 18789,
  beta:  18790,
  gamma: 18791,
  delta: 18792,
};

// ── Agent metadata ────────────────────────────────────────────────
export const AGENT_META = {
  alpha: {
    id:    'alpha',
    name:  'Alpha',
    title: '总架构师',
    color: '#6366f1',
    persona: (
      '你现在是"总架构师"(Alpha)。高屋建瓴，战略思维，热爱设计模式。' +
      '擅长系统设计、技术选型和架构权衡。用结构化、宏观的视角分析问题。' +
      '回复语言跟随用户，使用清晰的技术术语。'
    ),
  },
  beta: {
    id:    'beta',
    name:  'Beta',
    title: '代码工匠',
    color: '#22c55e',
    persona: (
      '你现在是"代码工匠"(Beta)。实用主义，代码洁癖，追求优雅实现。' +
      '擅长实现细节、代码重构和工程最佳实践。注重代码可读性、性能和可维护性。' +
      '回复语言跟随用户，给出具体可执行的代码建议。'
    ),
  },
  gamma: {
    id:    'gamma',
    name:  'Gamma',
    title: '质量守门员',
    color: '#f59e0b',
    persona: (
      '你现在是"质量守门员"(Gamma)。怀疑一切，测试驱动，风险意识强。' +
      '擅长单元测试、边界情况、安全审计和风险评估。' +
      '回复语言跟随用户，指出潜在风险和遗漏场景。'
    ),
  },
  delta: {
    id:    'delta',
    name:  'Delta',
    title: '运维大脑',
    color: '#ec4899',
    persona: (
      '你现在是"运维大脑"(Delta)。稳定优先，监控敏锐，偏好自动化。' +
      '擅长部署、监控、容错、扩展性和运维最佳实践。' +
      '回复语言跟随用户，关注系统的可靠性和可维护性。'
    ),
  },
};

// ── GatewayClient ─────────────────────────────────────────────────

const MAX_RECONNECT_DELAY = 30000;

/**
 * Manages a WebSocket connection to a single OpenClaw Gateway instance.
 *
 * @param {object}   options
 * @param {number}   options.port        - OpenClaw instance port (e.g. 18789)
 * @param {string}   options.agentId     - Agent identifier (alpha|beta|gamma|delta)
 * @param {function} options.onMessage    - Called with a parsed event object
 * @param {function} options.onStatusChange - Called with status: 'connecting'|'connected'|'disconnected'
 */
export class GatewayClient {
  constructor({ port, agentId, onMessage, onStatusChange }) {
    this.port           = port;
    this.agentId        = agentId;
    this.onMessage      = onMessage     || (() => {});
    this.onStatusChange = onStatusChange || (() => {});

    this._ws             = null;
    this._reconnectDelay = 1000;
    this._reconnectTimer = null;
    this._intentionalClose = false;
    this._connectResolve  = null;
    this._connectReject   = null;

    /** True once hello-ok received */
    this.connected = false;

    const meta = AGENT_META[agentId];
    this._personaText = meta?.persona || '';
    this._wsUrl = `ws://127.0.0.1:${port}/__openclaw__/ws`;
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Opens the WebSocket connection and waits for handshake.
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject  = reject;
      this._intentionalClose = false;
      this._openSocket();
    });
  }

  /**
   * Gracefully closes the connection (no auto-reconnect).
   */
  disconnect() {
    this._intentionalClose = true;
    clearTimeout(this._reconnectTimer);
    this._ws?.close();
    this._setStatus('disconnected');
  }

  /**
   * Sends a chat message to the gateway.
   * Persona prefix is prepended automatically.
   *
   * @param {string} text - Raw user message
   * @returns {Promise<void>}
   */
  async sendMessage(text) {
    if (!this.connected || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Gateway ${this.agentId} not connected`);
    }

    const payload = {
      jsonrpc: '2.0',
      id:      Date.now(),
      method:  'chat.send',
      params: {
        message: this._personaText
          ? `${this._personaText}\n\n用户的问题是：${text}`
          : text,
      },
    };

    return new Promise((resolve, reject) => {
      const raw = JSON.stringify(payload);

      const onResponse = (event) => {
        try {
          const msg = JSON.parse(event.data.toString());
          if (msg.id === payload.id) {
            this._ws.removeEventListener('message', onResponse);
            if (msg.error) reject(new Error(msg.error.message || 'RPC error'));
            else resolve();
          }
        } catch (_) {}
      };

      this._ws.addEventListener('message', onResponse);
      this._ws.send(raw);

      // Safety valve — don't block forever waiting for RPC ack
      setTimeout(() => {
        this._ws?.removeEventListener('message', onResponse);
        resolve();
      }, 5000);
    });
  }

  // ── Internals ───────────────────────────────────────────────────

  _openSocket() {
    this._setStatus('connecting');
    console.log(`[gateway:${this.agentId}] Connecting to ${this._wsUrl}...`);

    try {
      this._ws = new WebSocket(this._wsUrl);
    } catch (err) {
      console.error(`[gateway:${this.agentId}] WS constructor error:`, err.message);
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => {
      console.log(`[gateway:${this.agentId}] Socket opened, sending connect...`);
      this._sendConnect();
    };

    this._ws.onmessage = (event) => {
      this._handleMessage(event.data);
    };

    this._ws.onerror = (event) => {
      console.error(`[gateway:${this.agentId}] WS error:`, event.message || '(no detail)');
    };

    this._ws.onclose = (event) => {
      const wasConnected = this.connected;
      this.connected = false;

      if (wasConnected) {
        console.warn(`[gateway:${this.agentId}] Connection closed (code=${event.code}), reconnecting...`);
        this._setStatus('disconnected');
        this._scheduleReconnect();
      }
      this._connectReject?.(new Error(`WebSocket closed before hello-ok: ${event.code}`));
      this._connectReject  = null;
      this._connectResolve = null;
    };
  }

  _sendConnect() {
    this._ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id:      Date.now(),
      method:  'connect',
      params: {
        token:  'gateway-bridge',
        scopes: ['chat:send', 'chat:read'],
      },
    }));
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ── Handshake ───────────────────────────────────────────────
    if (msg.method === 'hello-ok' || (msg.result && msg.result.welcome)) {
      if (!this.connected) {
        this.connected = true;
        console.log(`[gateway:${this.agentId}] Handshake complete — connected.`);
        this._setStatus('connected');
        this._reconnectDelay = 1000;
        this._connectResolve?.();
        this._connectResolve = null;
        this._connectReject  = null;
      }
      return;
    }

    // ── Normalize OpenClaw gateway events into frontend format ──
    // index.js → frontend expects: { type: 'delta'|'final', agentId, text }
    const evt = this._normalizeEvent(msg);
    if (evt) {
      this.onMessage(evt);
    }
  }

  /**
   * Normalize raw gateway messages into the { type, agentId, text } shape.
   * Handles multiple known OpenClaw event formats.
   */
  _normalizeEvent(msg) {
    // JSON-RPC notification: { method: 'agent.delta', params: { text: '...' } }
    if (msg.method === 'agent.delta') {
      return { type: 'delta', agentId: this.agentId, text: msg.params?.text ?? '' };
    }

    // JSON-RPC notification: { method: 'agent.final', params: { text: '...' } }
    if (msg.method === 'agent.final') {
      return { type: 'final', agentId: this.agentId, text: msg.params?.text ?? '' };
    }

    // SSE-style event: { event: 'agent.delta', data: { text: '...' } }
    if (msg.event === 'agent.delta' || msg.event === 'delta') {
      const text = msg.data?.text ?? msg.text ?? '';
      return { type: 'delta', agentId: this.agentId, text };
    }
    if (msg.event === 'agent.final' || msg.event === 'final') {
      const text = msg.data?.text ?? msg.text ?? '';
      return { type: 'final', agentId: this.agentId, text };
    }

    // Direct format: { type: 'delta'|'final', text: '...' }
    if (msg.type === 'delta' || msg.type === 'final') {
      return { type: msg.type, agentId: this.agentId, text: msg.text ?? '' };
    }

    // Stream chunk format: { delta: { text: '...' } } — seen in some OpenAI-compatible APIs
    if (typeof msg.delta?.text === 'string') {
      return { type: 'delta', agentId: this.agentId, text: msg.delta.text };
    }

    // OpenClaw may also send { choices: [{ delta: { content: '...' } }] }
    if (Array.isArray(msg.choices) && msg.choices[0]?.delta?.content) {
      return { type: 'delta', agentId: this.agentId, text: msg.choices[0].delta.content };
    }

    // Unknown / unparseable — log and drop
    console.warn(`[gateway:${this.agentId}] Dropping unknown event shape:`, JSON.stringify(msg).slice(0, 200));
    return null;
  }

  _scheduleReconnect() {
    if (this._intentionalClose) return;

    clearTimeout(this._reconnectTimer);
    console.log(`[gateway:${this.agentId}] Reconnecting in ${this._reconnectDelay}ms...`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, MAX_RECONNECT_DELAY);
      this._openSocket();
    }, this._reconnectDelay);
  }

  _setStatus(status) {
    this.onStatusChange(status);
  }
}
