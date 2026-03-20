/**
 * OpenClaw Gateway Client — WebSocket bridge to OpenClaw instance
 *
 * Protocol: JSON-RPC over WebSocket
 *   Connect:  ws://127.0.0.1:{port}/__openclaw__/ws
 *   Handshake: send connect → receive hello-ok
 *   Send:     chat.send → stream agent.delta → agent.final
 *
 * Stability improvements:
 *   - Heartbeat ping/pong to detect zombie connections
 *   - Fixed reconnect logic (don't reject on already-connected close)
 *   - Connection timeout if no hello-ok within 10s
 *   - Proper cleanup on intentional disconnect
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

const MAX_RECONNECT_DELAY  = 30_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;  // max wait for hello-ok
const HEARTBEAT_INTERVAL   = 20_000;  // ping every 20 s
const HEARTBEAT_TIMEOUT    = 10_000;  // kill if no pong within 10 s

/**
 * Manages a WebSocket connection to a single OpenClaw Gateway instance.
 */
export class GatewayClient {
  constructor({ port, agentId, onMessage, onStatusChange }) {
    this.port           = port;
    this.agentId        = agentId;
    this.onMessage      = onMessage     || (() => {});
    this.onStatusChange = onStatusChange || (() => {});

    this._ws                = null;
    this._reconnectDelay    = 1000;
    this._reconnectTimer    = null;
    this._intentionalClose  = false;
    this._connectResolve    = null;
    this._connectReject     = null;
    this._handshakeTimer    = null;
    this._heartbeatInterval = null;
    this._heartbeatTimeout  = null;

    /** True once hello-ok received */
    this.connected = false;

    const meta = AGENT_META[agentId];
    this._personaText = meta?.persona || '';
    this._wsUrl = `ws://127.0.0.1:${port}/__openclaw__/ws`;
  }

  // ── Public API ─────────────────────────────────────────────────

  connect() {
    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject  = reject;
      this._intentionalClose = false;
      this._openSocket();
    });
  }

  disconnect() {
    this._intentionalClose = true;
    this._clearTimers();
    if (this._ws) {
      this._ws.removeAllListeners();
      this._ws.terminate();
      this._ws = null;
    }
    this.connected = false;
    this._setStatus('disconnected');
  }

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

      const onResponse = (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === payload.id) {
            this._ws.off('message', onResponse);
            if (msg.error) reject(new Error(msg.error.message || 'RPC error'));
            else resolve();
          }
        } catch (_) {}
      };

      this._ws.on('message', onResponse);
      this._ws.send(raw);

      // Safety valve — don't block forever waiting for RPC ack
      setTimeout(() => {
        this._ws?.off('message', onResponse);
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

    // Handshake timeout — if hello-ok never arrives, reconnect
    this._handshakeTimer = setTimeout(() => {
      if (!this.connected) {
        console.warn(`[gateway:${this.agentId}] Handshake timeout — terminating and retrying`);
        this._ws?.terminate();
      }
    }, HANDSHAKE_TIMEOUT_MS);

    this._ws.on('open', () => {
      console.log(`[gateway:${this.agentId}] Socket opened, sending connect...`);
      this._sendConnect();
    });

    this._ws.on('message', (data) => {
      this._handleMessage(data);
    });

    this._ws.on('pong', () => {
      // Connection is alive — clear pending heartbeat timeout
      clearTimeout(this._heartbeatTimeout);
      this._heartbeatTimeout = null;
    });

    this._ws.on('error', (err) => {
      console.error(`[gateway:${this.agentId}] WS error:`, err.message || '(no detail)');
    });

    this._ws.on('close', (code) => {
      const wasConnected = this.connected;
      this.connected = false;
      this._clearTimers();

      if (wasConnected) {
        console.warn(`[gateway:${this.agentId}] Connection closed (code=${code}), reconnecting...`);
        this._setStatus('disconnected');
      }

      if (!this._intentionalClose) {
        // Only reject the initial connect() promise when we were NOT yet connected
        if (!wasConnected) {
          this._connectReject?.(new Error(`WebSocket closed before hello-ok: ${code}`));
          this._connectResolve = null;
          this._connectReject  = null;
        }
        this._scheduleReconnect();
      }
    });
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

    // ── Handshake ──────────────────────────────────────────────
    if (msg.method === 'hello-ok' || (msg.result && msg.result.welcome)) {
      if (!this.connected) {
        clearTimeout(this._handshakeTimer);
        this._handshakeTimer = null;
        this.connected = true;
        console.log(`[gateway:${this.agentId}] Handshake complete — connected.`);
        this._setStatus('connected');
        this._reconnectDelay = 1000;
        this._connectResolve?.();
        this._connectResolve = null;
        this._connectReject  = null;
        this._startHeartbeat();
      }
      return;
    }

    const evt = this._normalizeEvent(msg);
    if (evt) {
      this.onMessage(evt);
    }
  }

  _normalizeEvent(msg) {
    if (msg.method === 'agent.delta') {
      return { type: 'delta', agentId: this.agentId, text: msg.params?.text ?? '' };
    }
    if (msg.method === 'agent.final') {
      return { type: 'final', agentId: this.agentId, text: msg.params?.text ?? '' };
    }
    if (msg.event === 'agent.delta' || msg.event === 'delta') {
      return { type: 'delta', agentId: this.agentId, text: msg.data?.text ?? msg.text ?? '' };
    }
    if (msg.event === 'agent.final' || msg.event === 'final') {
      return { type: 'final', agentId: this.agentId, text: msg.data?.text ?? msg.text ?? '' };
    }
    if (msg.type === 'delta' || msg.type === 'final') {
      return { type: msg.type, agentId: this.agentId, text: msg.text ?? '' };
    }
    if (typeof msg.delta?.text === 'string') {
      return { type: 'delta', agentId: this.agentId, text: msg.delta.text };
    }
    if (Array.isArray(msg.choices) && msg.choices[0]?.delta?.content) {
      return { type: 'delta', agentId: this.agentId, text: msg.choices[0].delta.content };
    }
    // Silently drop non-event messages (RPC acks, unknown shapes)
    if (!msg.id && !msg.result) {
      console.warn(`[gateway:${this.agentId}] Dropping unknown event:`, JSON.stringify(msg).slice(0, 200));
    }
    return null;
  }

  _startHeartbeat() {
    this._clearHeartbeat();
    this._heartbeatInterval = setInterval(() => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
      // If a previous ping still has no pong, the connection is zombie — kill it
      if (this._heartbeatTimeout) {
        console.warn(`[gateway:${this.agentId}] No pong received — terminating zombie connection`);
        this._ws.terminate();
        return;
      }
      this._ws.ping();
      this._heartbeatTimeout = setTimeout(() => {
        console.warn(`[gateway:${this.agentId}] Heartbeat timeout — terminating`);
        this._ws?.terminate();
      }, HEARTBEAT_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  }

  _clearHeartbeat() {
    clearInterval(this._heartbeatInterval);
    clearTimeout(this._heartbeatTimeout);
    this._heartbeatInterval = null;
    this._heartbeatTimeout  = null;
  }

  _clearTimers() {
    clearTimeout(this._handshakeTimer);
    clearTimeout(this._reconnectTimer);
    this._clearHeartbeat();
    this._handshakeTimer = null;
    this._reconnectTimer = null;
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
