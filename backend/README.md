# OpenClaw — Multi-Agent Brainstorming Chat Room Backend

A FastAPI + WebSocket backend that powers the OpenClaw AI multi-agent brainstorming chat room.

## Architecture

```
client (React, port 3000)  ←→  backend (FastAPI, port 3001)  ←→  LLM Provider
                              ├── WebSocket /ws
                              ├── GET  /api/status
                              ├── POST /api/send
                              ├── GET  /api/history
                              └── GET  /api/health
```

The backend manages WebSocket connections from frontend clients, routes messages to the appropriate AI agents, streams responses in real-time, and maintains an in-memory message history.

## Four AI Agents

| Agent  | Role            | Focus                                        |
|--------|-----------------|---------------------------------------------|
| Alpha  | 总架构师        | System design, architecture, tech choices   |
| Beta   | 代码工匠        | Implementation quality, refactoring         |
| Gamma  | 质量守门员      | Testing, edge cases, risk & security        |
| Delta  | 运维大脑        | Deployment, observability, fault tolerance  |

## Setup

### 1. Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

**Option A — OpenAI (recommended for production)**

```env
OPENAI_API_KEY=sk-...
```

When `OPENAI_API_KEY` is set, the backend uses `gpt-4o-mini` via the OpenAI API.

**Option B — Ollama (local, free)**

```env
OPENAI_API_KEY=
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5
```

When `OPENAI_API_KEY` is empty, the backend falls back to a local Ollama instance. Make sure Ollama is running (`ollama serve`) and the model is pulled:

```bash
ollama pull qwen2.5
```

## Running

```bash
uvicorn main:app --reload --port 3001
```

- `--reload` enables auto-reload on code changes (development only)
- The frontend on port 3000 connects to `ws://localhost:3001/ws`

To run in production without reload:

```bash
uvicorn main:app --host 0.0.0.0 --port 3001 --workers 4
```

## API Reference

### WebSocket — `/ws`

Connect from the frontend. Protocol is JSON over WebSocket.

**Server → Client**

| Message type        | Fields                                                              |
|---------------------|---------------------------------------------------------------------|
| `init`              | `{type, statuses, messages}`                                        |
| `agent_status`      | `{type, agentId, status}`                                          |
| `message`           | `{type, message: {id, type:"user", text, timestamp}}`              |
| `ai_thinking`       | `{type, agentId, timestamp}`                                        |
| `ai_event`          | `{type, event: {type, agentId, text}, timestamp}`                   |

`ai_event.event.type` values: `delta` (streamed partial text), `final` (complete), `error`.

**Client → Server**

| Message type | Fields                               |
|--------------|--------------------------------------|
| `send`       | `{type, target, message}`            |

`target` values: `alpha`, `beta`, `gamma`, `delta`, `all`.

### REST Endpoints

| Method | Path             | Description                        |
|--------|------------------|------------------------------------|
| GET    | `/api/status`    | Agent connection statuses          |
| POST   | `/api/send`      | Send a message (body: target + message) |
| GET    | `/api/history`   | Message history (query: ?limit=N) |
| GET    | `/api/health`    | Health check                       |

### POST /api/send — Example

```bash
curl -X POST http://localhost:3001/api/send \
  -H "Content-Type: application/json" \
  -d '{"target": "all", "message": "Should we use microservices for this project?"}'
```

Response:

```json
{"id": "a1b2c3d4-...", "status": "queued", "targets": ["alpha", "beta", "gamma", "delta"]}
```

## Message History

The server keeps the last 500 messages in memory. History is sent to new WebSocket clients on connect via the `init` message and available via `GET /api/history`.

## Development Notes

- The backend manages its own agent "connection" status — all four agents are always reported as `connected`.
- AI responses run concurrently across agents when `target: "all"` is used.
- A per-agent asyncio lock prevents interleaved responses from the same agent.
- The langchain `StreamingCallback` fires delta events for each token in real time.
