"""
chat-storm backend — multi-agent brainstorming room
====================================================
Standalone FastAPI server.  No OpenClaw, no LangChain.
Calls LLMs directly via OpenAI-compatible streaming API (httpx SSE).

Supported providers (set LLM_PROVIDER env var):
  ollama | dashscope | minimax | zhipu | kimi
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import signal
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from typing import AsyncIterator, Deque, Dict, List, Optional, Set

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

# ══════════════════════════════════════════════════════════════════════════════
# Configuration
# ══════════════════════════════════════════════════════════════════════════════

PROVIDER = os.getenv("LLM_PROVIDER", "ollama")

# Ollama (local)
OLLAMA_URL    = os.getenv("OLLAMA_URL",   "http://localhost:11434")
OLLAMA_MODEL  = os.getenv("OLLAMA_MODEL", "qwen2.5")
OLLAMA_VISION = os.getenv("OLLAMA_MODEL_VISION",  "qwen3-vl:4b")
OLLAMA_ROUTER = os.getenv("OLLAMA_MODEL_ROUTER",  "dolphin-mistral")

# Dashscope / Aliyun Qwen
DASHSCOPE_KEY  = os.getenv("DASHSCOPE_API_KEY", "")
DASHSCOPE_URL  = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
DASHSCOPE_MODEL = os.getenv("DASHSCOPE_MODEL",  "qwen-plus")
DASHSCOPE_ASR_KEY   = os.getenv("DASHSCOPE_ASR_KEY", "")
DASHSCOPE_ASR_MODEL = os.getenv("DASHSCOPE_ASR_MODEL", "fun-asr-realtime")
DASHSCOPE_EMBED_KEY   = os.getenv("DASHSCOPE_EMBED_KEY", "")
DASHSCOPE_EMBED_MODEL = os.getenv("DASHSCOPE_EMBED_MODEL", "text-embedding-v4")

# MiniMax
MINIMAX_KEY   = os.getenv("MINIMAX_API_KEY",    "")
MINIMAX_URL   = os.getenv("MINIMAX_BASE_URL",   "https://api.minimaxi.com/v1")
MINIMAX_MODEL = os.getenv("MINIMAX_MODEL",      "MiniMax-M1")

# Zhipu GLM
ZHIPU_KEY   = os.getenv("ZHIPU_API_KEY",    "")
ZHIPU_URL   = os.getenv("ZHIPU_BASE_URL",   "https://open.bigmodel.cn/api/paas/v4")
ZHIPU_MODEL = os.getenv("ZHIPU_MODEL",      "glm-4")

# Kimi / Moonshot
KIMI_KEY   = os.getenv("KIMI_API_KEY",    "")
KIMI_URL   = os.getenv("KIMI_BASE_URL",   "https://api.moonshot.cn/v1")
KIMI_MODEL = os.getenv("KIMI_MODEL",      "moonshot-v1-8k")


def _provider_defaults() -> tuple[str, str, str]:
    """Return (base_url, api_key, default_model) for the active provider."""
    if PROVIDER == "dashscope": return DASHSCOPE_URL,  DASHSCOPE_KEY,  DASHSCOPE_MODEL
    if PROVIDER == "minimax":   return MINIMAX_URL,    MINIMAX_KEY,    MINIMAX_MODEL
    if PROVIDER == "zhipu":     return ZHIPU_URL,      ZHIPU_KEY,      ZHIPU_MODEL
    if PROVIDER == "kimi":      return KIMI_URL,        KIMI_KEY,       KIMI_MODEL
    # default: ollama
    return f"{OLLAMA_URL}/v1", "ollama", OLLAMA_MODEL


BASE_URL, API_KEY, DEFAULT_MODEL = _provider_defaults()

# Per-agent model overrides (fall back to DEFAULT_MODEL)
_AGENT_MODELS: Dict[str, str] = {
    aid: os.getenv(f"LLM_MODEL_{aid.upper()}") or
         os.getenv(f"OLLAMA_MODEL_{aid.upper()}") or   # legacy compat
         DEFAULT_MODEL
    for aid in ("alpha", "beta", "gamma", "delta")
}

# ══════════════════════════════════════════════════════════════════════════════
# Agent definitions
# ══════════════════════════════════════════════════════════════════════════════

AGENTS: Dict[str, Dict] = {
    "alpha": {
        "name":  "总架构师",
        "color": "#6366f1",
        "system": (
            "你是「总架构师」(Alpha)，高屋建瓴，战略思维，热爱设计模式。"
            "擅长系统设计、技术选型和架构权衡。"
            "请用中文回答，从大局视角分析，主动提出架构层面的建议。"
        ),
    },
    "beta": {
        "name":  "代码工匠",
        "color": "#22c55e",
        "system": (
            "你是「代码工匠」(Beta)，实用主义，代码洁癖，追求优雅实现。"
            "擅长实现细节、代码重构、工程最佳实践。"
            "请用中文回答，给出具体可执行的代码建议，注重代码质量与可维护性。"
        ),
    },
    "gamma": {
        "name":  "质量守门员",
        "color": "#f59e0b",
        "system": (
            "你是「质量守门员」(Gamma)，怀疑一切，测试驱动，风险意识强。"
            "擅长单元测试、边界情况、安全审计。"
            "请用中文回答，指出潜在风险和遗漏场景，质疑未经证实的假设。"
        ),
    },
    "delta": {
        "name":  "运维大脑",
        "color": "#ec4899",
        "system": (
            "你是「运维大脑」(Delta)，稳定优先，监控敏锐，偏好自动化。"
            "擅长部署、监控、容错、扩展性和 SRE 实践。"
            "请用中文回答，关注系统的稳定性、可观测性和运维友好性。"
        ),
    },
}

AGENT_IDS = list(AGENTS.keys())

# ══════════════════════════════════════════════════════════════════════════════
# Optional: ChromaDB vector memory
# ══════════════════════════════════════════════════════════════════════════════

_chroma_collection = None

def _init_chroma() -> None:
    global _chroma_collection
    try:
        import chromadb  # noqa: PLC0415
        client = chromadb.PersistentClient(path="./chroma_data")
        _chroma_collection = client.get_or_create_collection(
            name="chat_memory",
            metadata={"description": "chat-storm multi-agent history"},
        )
        print("[ChromaDB] vector memory ready")
    except Exception as exc:
        print(f"[ChromaDB] not available ({exc}) — memory disabled")
        _chroma_collection = None


async def _embed(texts: List[str]) -> List[List[float]]:
    key = DASHSCOPE_EMBED_KEY or DASHSCOPE_KEY
    if not key:
        return [[] for _ in texts]
    async with httpx.AsyncClient(timeout=30) as c:
        resp = await c.post(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": DASHSCOPE_EMBED_MODEL, "input": texts},
        )
    if resp.status_code != 200:
        return [[] for _ in texts]
    return [e["embedding"] for e in resp.json().get("data", [])]


async def memory_search(query: str, top_k: int = 5) -> List[dict]:
    if not _chroma_collection:
        return []
    try:
        vecs = await _embed([query])
        if not vecs or not vecs[0]:
            return []
        hits = _chroma_collection.query(query_embeddings=[vecs[0]], n_results=top_k,
                                         include=["metadatas", "documents"])
        docs  = hits.get("documents",  [[]])[0]
        metas = hits.get("metadatas",  [[]])[0]
        return [{"text": d, "metadata": m or {}} for d, m in zip(docs, metas)]
    except Exception:
        return []


async def memory_add(text: str, metadata: dict) -> None:
    if not _chroma_collection:
        return
    try:
        doc_id = f"{metadata.get('agent_id','?')}-{metadata.get('timestamp', _now_ms())}"
        vecs = await _embed([text])
        if vecs and vecs[0]:
            _chroma_collection.add(ids=[doc_id], documents=[text],
                                   embeddings=vecs, metadatas=[metadata])
    except Exception:
        pass

# ══════════════════════════════════════════════════════════════════════════════
# Message routing
# ══════════════════════════════════════════════════════════════════════════════

_ROUTER_SYSTEM = """You are a message router. Output ONLY valid JSON, nothing else.

Format: {"intent":"","target_agents":[],"reason":""}

Intents and targets:
- architecture/system design/tech selection → target_agents: ["alpha"]
- code/implementation/algorithm/refactor   → target_agents: ["beta"]
- test/bug/risk/audit/boundary             → target_agents: ["gamma"]
- deploy/ops/monitoring/scaling            → target_agents: ["delta"]
- greeting/casual/simple question          → target_agents: ["all"]
- complex/multi-domain/major decision      → target_agents: ["all"]

Output JSON only. No explanation."""


def _keyword_route(text: str) -> List[str]:
    t = text.lower()
    if any(k in t for k in ("架构", "设计", "系统设计", "技术选型", "architecture", "design", "tech stack")):
        return ["alpha"]
    if any(k in t for k in ("代码", "实现", "算法", "重构", "code", "implement", "algorithm", "refactor")):
        return ["beta"]
    if any(k in t for k in ("测试", "bug", "边界", "风险", "安全", "test", "audit", "boundary", "security")):
        return ["gamma"]
    if any(k in t for k in ("部署", "运维", "监控", "扩展", "deploy", "ops", "monitor", "scale", "k8s", "docker")):
        return ["delta"]
    return ["all"]


async def route_message(text: str) -> List[str]:
    """Return list of agent IDs. Falls back to keyword routing on any failure."""
    if PROVIDER != "ollama":
        # Only use LLM router with local Ollama (avoid extra quota cost)
        return _expand_all(_keyword_route(text))

    try:
        async with httpx.AsyncClient(timeout=12) as c:
            resp = await c.post(
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": OLLAMA_ROUTER,
                    "messages": [
                        {"role": "system", "content": _ROUTER_SYSTEM},
                        {"role": "user",   "content": text},
                    ],
                    "stream": False,
                    "options": {"num_predict": 80, "temperature": 0.05},
                },
            )
        raw = resp.json().get("message", {}).get("content", "")
        s, e = raw.find("{"), raw.rfind("}") + 1
        if s < 0 or e <= s:
            raise ValueError("no JSON")
        result = json.loads(raw[s:e])
        targets = result.get("target_agents", result.get("targets", ["all"]))
        if isinstance(targets, str):
            targets = [targets]
    except Exception as exc:
        print(f"[Router] LLM failed ({exc}), using keyword fallback")
        targets = _keyword_route(text)

    return _expand_all(targets)


def _expand_all(targets: List[str]) -> List[str]:
    if "all" in targets or not targets:
        return list(AGENT_IDS)
    return [t for t in targets if t in AGENTS]

# ══════════════════════════════════════════════════════════════════════════════
# LLM streaming client
# ══════════════════════════════════════════════════════════════════════════════

async def llm_stream(agent_id: str, system: str, user_msg: str,
                     model_override: str = "") -> AsyncIterator[str]:
    """
    Async generator: yields accumulated text after each new token from the LLM.
    Uses OpenAI-compatible SSE streaming (stream=True).
    """
    model = model_override or _AGENT_MODELS[agent_id]
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user_msg},
        ],
        "max_tokens": 2048,
        "stream": True,
    }

    accumulated = ""
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
        async with client.stream(
            "POST", f"{BASE_URL}/chat/completions",
            json=payload, headers=headers,
        ) as resp:
            resp.raise_for_status()
            async for raw_line in resp.aiter_lines():
                line = raw_line.strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                # Support both OpenAI-style and reasoning_content (Dashscope qwen3)
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                token = delta.get("content") or delta.get("reasoning_content") or ""
                if token:
                    accumulated += token
                    yield accumulated

# ══════════════════════════════════════════════════════════════════════════════
# Vision — local Ollama image understanding
# ══════════════════════════════════════════════════════════════════════════════

async def analyze_image(b64_data: str) -> str:
    try:
        if "," in b64_data:
            b64_data = b64_data.split(",", 1)[1]
        async with httpx.AsyncClient(timeout=60) as c:
            resp = await c.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": OLLAMA_VISION,
                    "prompt": (
                        "请详细描述这张图片的内容，包括：主体、场景、颜色特征、"
                        "文字内容（如有）及值得注意的细节。中文回答，100字以内。"
                    ),
                    "images": [b64_data],
                    "stream": False,
                    "options": {"num_predict": 200},
                },
            )
            resp.raise_for_status()
            return resp.json().get("response", "").strip() or "[图片内容无法识别]"
    except Exception as exc:
        return f"[图片分析失败: {exc}]"

# ══════════════════════════════════════════════════════════════════════════════
# In-memory state
# ══════════════════════════════════════════════════════════════════════════════

clients: Set[WebSocket] = set()
message_history: Deque[dict] = deque(maxlen=500)
_agent_locks: Dict[str, asyncio.Lock] = {aid: asyncio.Lock() for aid in AGENT_IDS}

# ══════════════════════════════════════════════════════════════════════════════
# WebSocket broadcast helpers
# ══════════════════════════════════════════════════════════════════════════════

def _now_ms() -> int:
    return int(time.time() * 1000)


async def broadcast(data: dict) -> None:
    dead: Set[WebSocket] = set()
    for ws in list(clients):
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    clients.difference_update(dead)


def _thinking(agent_id: str) -> dict:
    return {"type": "ai_thinking", "agentId": agent_id, "timestamp": _now_ms()}

def _delta(agent_id: str, text: str) -> dict:
    return {"type": "ai_event", "event": {"type": "delta", "agentId": agent_id, "text": text}, "timestamp": _now_ms()}

def _final(agent_id: str, text: str) -> dict:
    return {"type": "ai_event", "event": {"type": "final", "agentId": agent_id, "text": text}, "timestamp": _now_ms()}

def _error_event(agent_id: str, text: str) -> dict:
    return {"type": "ai_event", "event": {"type": "error", "agentId": agent_id, "text": text}, "timestamp": _now_ms()}

def _msg_wrap(message: dict) -> dict:
    return {"type": "message", "message": message}

# ══════════════════════════════════════════════════════════════════════════════
# Agent response runner
# ══════════════════════════════════════════════════════════════════════════════

async def run_agent(agent_id: str, user_message: str, model_override: str = "") -> None:
    """
    Runs one agent: thinking → streaming deltas → final → save to history.
    Serialised per-agent via asyncio.Lock (prevents interleaving when two
    messages arrive before the first agent finishes).
    """
    async with _agent_locks[agent_id]:
        meta = AGENTS[agent_id]
        await broadcast(_thinking(agent_id))

        # Optional: enrich system prompt with relevant memory
        system = meta["system"]
        memories = await memory_search(user_message, top_k=4)
        if memories:
            ctx = "\n".join(f"- {m['text'][:120]}" for m in memories)
            system += f"\n\n[相关历史上下文]\n{ctx}\n请结合上述历史回答。"

        try:
            full_text = ""
            async for accumulated in llm_stream(agent_id, system, user_message, model_override):
                full_text = accumulated
                await broadcast(_delta(agent_id, full_text))

            if not full_text:
                raise RuntimeError("LLM returned empty response")

            # Persist to history and broadcast as a committed message
            ts = _now_ms()
            ai_msg = {
                "id":        f"ai-{agent_id}-{ts}",
                "type":      "ai",
                "agentId":   agent_id,
                "text":      full_text,
                "timestamp": ts,
            }
            message_history.append(ai_msg)
            await broadcast(_msg_wrap(ai_msg))
            asyncio.create_task(memory_add(full_text, {"agent_id": agent_id, "type": "ai", "timestamp": ts}))
            await broadcast(_final(agent_id, full_text))

        except Exception as exc:
            print(f"[Agent {agent_id}] ERROR: {type(exc).__name__}: {exc}")
            error_text = f"[{meta['name']}] 调用失败: {exc}"
            ts = _now_ms()
            err_msg = {"id": f"err-{agent_id}-{ts}", "type": "ai", "agentId": agent_id,
                       "text": error_text, "timestamp": ts}
            message_history.append(err_msg)
            await broadcast(_msg_wrap(err_msg))
            await broadcast(_error_event(agent_id, error_text))

# ══════════════════════════════════════════════════════════════════════════════
# Message dispatch
# ══════════════════════════════════════════════════════════════════════════════

async def dispatch(
    target: str,
    text: str,
    image_b64: Optional[str] = None,
    quote: Optional[dict] = None,
) -> List[str]:
    """
    Save the user message, determine which agents reply, fire them concurrently.
    Returns the list of agent IDs that were activated.
    """
    ts = _now_ms()
    msg_id = str(uuid.uuid4())

    user_msg: dict = {
        "id":        msg_id,
        "type":      "user",
        "agentId":   "user",
        "text":      text,
        "timestamp": ts,
    }
    if image_b64:
        user_msg["image"] = image_b64
    if quote:
        user_msg["quote"] = quote

    message_history.append(user_msg)
    await broadcast(_msg_wrap(user_msg))
    asyncio.create_task(memory_add(text, {"agent_id": "user", "type": "user", "timestamp": ts}))

    # If image supplied, enrich the prompt with vision description
    prompt = text
    if image_b64:
        description = await analyze_image(image_b64)
        user_msg["visionDescription"] = description
        prompt = f"[用户上传了图片。图片描述：{description}]\n\n用户提问：{text}"

    # Routing
    if target in AGENT_IDS:
        active = [target]
        model_override = ""
    else:  # "all" or unknown → smart route
        active = await route_message(prompt)
        model_override = ""
        print(f"[Router] '{prompt[:40]}...' → {active}")

    # Run all agents concurrently
    await asyncio.gather(
        *(run_agent(aid, prompt, model_override) for aid in active),
        return_exceptions=True,
    )
    return active

# ══════════════════════════════════════════════════════════════════════════════
# FastAPI app
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_chroma()

    # Signal handlers for graceful shutdown
    loop = asyncio.get_event_loop()
    def _shutdown():
        print("\n[server] Shutdown signal — closing connections...")
        for ws in list(clients):
            loop.create_task(ws.close(1001))
        clients.clear()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _shutdown)
        except NotImplementedError:
            pass  # Windows

    yield

    for ws in list(clients):
        try:
            await ws.close()
        except Exception:
            pass
    clients.clear()


app = FastAPI(title="chat-storm backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════════════════════════
# WebSocket endpoint  /ws
# ══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    clients.add(ws)

    # Send initial state
    try:
        await ws.send_json({
            "type":     "init",
            "statuses": {aid: "connected" for aid in AGENT_IDS},
            "messages": list(message_history),
        })
        # Confirm all agents are online
        for aid in AGENT_IDS:
            await broadcast({"type": "agent_status", "agentId": aid, "status": "connected"})
    except Exception:
        clients.discard(ws)
        return

    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue

            mtype = msg.get("type", "")
            if mtype == "send":
                text = msg.get("message", "").strip()
                if text:
                    asyncio.create_task(dispatch(
                        target=msg.get("target", "all"),
                        text=text,
                        quote=msg.get("quote"),
                    ))

            elif mtype == "send_with_image":
                text  = msg.get("message", "").strip()
                image = msg.get("image", "")
                if text and image:
                    asyncio.create_task(dispatch(
                        target=msg.get("target", "all"),
                        text=text,
                        image_b64=image,
                        quote=msg.get("quote"),
                    ))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[ws] Unexpected error: {exc}")
    finally:
        clients.discard(ws)

# ══════════════════════════════════════════════════════════════════════════════
# REST endpoints
# ══════════════════════════════════════════════════════════════════════════════

class SendRequest(BaseModel):
    target:  str = "all"
    message: str
    image:   Optional[str] = None
    quote:   Optional[dict] = None


@app.post("/api/send")
async def rest_send(body: SendRequest):
    if not body.message.strip():
        raise HTTPException(400, "message cannot be empty")
    targets = await dispatch(body.target, body.message.strip(), body.image, body.quote)
    return {"id": str(uuid.uuid4()), "status": "ok", "targets": targets}


@app.get("/api/history")
async def get_history(limit: int = 200):
    return {"messages": list(message_history)[-limit:]}


@app.get("/api/status")
async def get_status():
    return {aid: "connected" for aid in AGENT_IDS}


@app.get("/api/health")
async def health():
    return {
        "status":        "ok",
        "provider":      PROVIDER,
        "base_url":      BASE_URL,
        "default_model": DEFAULT_MODEL,
        "agent_models":  _AGENT_MODELS,
        "memory":        _chroma_collection is not None,
        "clients":       len(clients),
    }


# ── ASR endpoint (Dashscope Bailian, optional) ────────────────────────────────

async def _dashscope_asr(audio_bytes: bytes, filename: str) -> str:
    key = DASHSCOPE_ASR_KEY or DASHSCOPE_KEY
    if not key:
        raise HTTPException(503, "DASHSCOPE_ASR_KEY not configured")

    ext   = (filename or "audio.webm").rsplit(".", 1)[-1].lower()
    mime  = {"webm": "audio/webm", "wav": "audio/wav", "mp3": "audio/mpeg",
             "ogg": "audio/ogg", "m4a": "audio/mp4"}.get(ext, "audio/webm")
    b64   = base64.b64encode(audio_bytes).decode()

    async with httpx.AsyncClient(timeout=60) as c:
        resp = await c.post(
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": DASHSCOPE_ASR_MODEL,
                  "input": {"audio": f"data:{mime};base64,{b64}"}},
        )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"ASR error: {resp.text}")
    out = resp.json().get("output", {})
    return out.get("text") or out.get("content") or ""


@app.post("/api/asr")
async def asr_endpoint(file: UploadFile):
    if not (file.content_type or "").startswith("audio/"):
        raise HTTPException(400, "Only audio files accepted")
    audio = await file.read()
    if len(audio) < 512:
        raise HTTPException(400, "Audio file too small")
    try:
        text = await _dashscope_asr(audio, file.filename or "audio.webm")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))
    return {"text": text}


# ══════════════════════════════════════════════════════════════════════════════
# Entry point
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=False)
