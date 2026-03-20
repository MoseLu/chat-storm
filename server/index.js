/**
 * OpenClaw Multi-Agent Chat Room — Backend Server
 * Express + WebSocket server that bridges frontend to 4 OpenClaw gateways
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { GatewayClient, GATEWAY_PORTS, AGENT_META } from './gateway.js';

const PORT = 3001;
const app = express();
const server = createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── In-memory state ──────────────────────────────────────────────
const clients = new Set();  // all connected WS clients
const messageHistory = [];  // shared history across all agents

// ── Gateway Clients ─────────────────────────────────────────────
const gateways = {};

for (const [agentId, port] of Object.entries(GATEWAY_PORTS)) {
  const client = new GatewayClient({
    port,
    agentId,
    onMessage: (evt) => {
      // Broadcast AI event to all connected frontend clients
      const payload = JSON.stringify({
        type: 'ai_event',
        event: evt,
        timestamp: Date.now(),
      });
      clients.forEach((ws) => {
        if (ws.readyState === 1) ws.send(payload);
      });
    },
    onStatusChange: (status) => {
      const statusPayload = JSON.stringify({
        type: 'agent_status',
        agentId,
        status,
        timestamp: Date.now(),
      });
      clients.forEach((ws) => {
        if (ws.readyState === 1) ws.send(statusPayload);
      });
    },
  });

  gateways[agentId] = client;
  console.log(`[server] Connecting to gateway ${agentId} on port ${port}...`);

  client.connect()
    .then(() => {
      console.log(`[server] Gateway ${agentId} connected.`);
      // Send initial status to all clients
      broadcastStatus(agentId, 'connected');
    })
    .catch((err) => {
      console.error(`[server] Gateway ${agentId} connection failed:`, err.message);
    });
}

// ── Helpers ─────────────────────────────────────────────────────
function broadcastStatus(agentId, status) {
  const payload = JSON.stringify({ type: 'agent_status', agentId, status, timestamp: Date.now() });
  clients.forEach((ws) => {
    if (ws.readyState === 1) ws.send(payload);
  });
}

function saveMessage(msg) {
  messageHistory.push({
    id: uuidv4(),
    ...msg,
    timestamp: Date.now(),
  });
  // Keep last 500 messages
  if (messageHistory.length > 500) messageHistory.shift();
}

// ── REST API ─────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  const status = {};
  for (const [agentId, gw] of Object.entries(gateways)) {
    status[agentId] = {
      ...AGENT_META[agentId],
      port: gw.port,
      connected: gw.connected,
    };
  }
  res.json({ gateways: status, connectedClients: clients.size });
});

app.post('/api/send', async (req, res) => {
  const { target, message } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const msgId = uuidv4();
  const timestamp = Date.now();

  // Save user message to history
  const userMsg = {
    id: msgId,
    type: 'user',
    target,
    text: message,
    timestamp,
  };
  saveMessage(userMsg);

  // Broadcast user message to all frontend clients
  const broadcastPayload = JSON.stringify({ type: 'message', message: userMsg });
  clients.forEach((ws) => {
    if (ws.readyState === 1) ws.send(broadcastPayload);
  });

  // Queue AI "thinking" events
  const targets = target === 'all' ? Object.keys(gateways) : [target];
  const queuedAgents = [];

  for (const agentId of targets) {
    const gw = gateways[agentId];
    if (!gw) {
      res.status(400).json({ error: `Unknown target: ${agentId}` });
      return;
    }

    queuedAgents.push(agentId);

    // Emit "thinking" event
    const thinkingPayload = JSON.stringify({
      type: 'ai_thinking',
      agentId,
      timestamp: Date.now(),
    });
    clients.forEach((ws) => {
      if (ws.readyState === 1) ws.send(thinkingPayload);
    });

    // Send to gateway
    gw.sendMessage(message).catch((err) => {
      const errorPayload = JSON.stringify({
        type: 'ai_event',
        event: { type: 'error', agentId, text: err.message },
        timestamp: Date.now(),
      });
      clients.forEach((ws) => {
        if (ws.readyState === 1) ws.send(errorPayload);
      });
    });
  }

  res.json({
    id: msgId,
    status: 'queued',
    targets: queuedAgents,
  });
});

app.get('/api/history', (_req, res) => {
  res.json({ messages: messageHistory });
});

app.get('/api/history/:agentId', (req, res) => {
  const filtered = messageHistory.filter(
    (m) => m.agentId === req.params.agentId || m.target === req.params.agentId || m.target === 'all'
  );
  res.json({ messages: filtered });
});

// ── WebSocket Server ──────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[ws] Client connected. Total: ${clients.size}`);

  // Send current gateway statuses
  const statuses = {};
  for (const [agentId, gw] of Object.entries(gateways)) {
    statuses[agentId] = gw.connected ? 'connected' : 'disconnected';
  }
  ws.send(JSON.stringify({ type: 'init', statuses, messages: messageHistory }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'send') {
        // Proxy send request
        const { target, message } = msg;
        if (!message?.trim()) return;

        const msgId = uuidv4();
        const userMsg = {
          id: msgId,
          type: 'user',
          target,
          text: message,
          timestamp: Date.now(),
        };
        saveMessage(userMsg);
        ws.send(JSON.stringify({ type: 'message', message: userMsg }));

        const targets = target === 'all' ? Object.keys(gateways) : [target];
        for (const agentId of targets) {
          const gw = gateways[agentId];
          if (!gw) continue;

          ws.send(JSON.stringify({ type: 'ai_thinking', agentId, timestamp: Date.now() }));
          gw.sendMessage(message).catch((err) => {
            ws.send(JSON.stringify({
              type: 'ai_event',
              event: { type: 'error', agentId, text: err.message },
              timestamp: Date.now(),
            }));
          });
        }
      }
    } catch (e) {
      console.error('[ws] Message parse error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] Client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[ws] Client error:', err.message);
    clients.delete(ws);
  });
});

// ── Start ────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 OpenClaw Chat Server running at http://localhost:${PORT}`);
  console.log(`   WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`\nGateways:`);
  for (const [id, port] of Object.entries(GATEWAY_PORTS)) {
    console.log(`   ${id.padEnd(6)} → 127.0.0.1:${port}`);
  }
  console.log(`\nWaiting for gateway connections...\n`);
});
