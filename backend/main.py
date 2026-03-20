"""
OpenClaw Multi-Agent Brainstorming Chat Room — FastAPI + WebSocket Backend
"""

import asyncio
import base64
import json
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Deque, Dict, List, Literal, Optional, Set

from dotenv import load_dotenv
import httpx
from fastapi import FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
load_dotenv()

import os

# ── Provider selection ───────────────────────────────────────
# "ollama" | "dashscope" | "minimax" | "zhipu" | "kimi"
PROVIDER = os.getenv("LLM_PROVIDER", "ollama")

# ── Ollama (local) ───────────────────────────────────────────
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL_DEFAULT = os.getenv("OLLAMA_MODEL", "qwen2.5")
OLLAMA_MODEL_ROUTER = os.getenv("OLLAMA_MODEL_ROUTER", "dolphin-mistral")

# ── Dashscope (Aliyun qwen) ──────────────────────────────────
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
DASHSCOPE_BASE_URL = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
DASHSCOPE_MODEL_DEFAULT = os.getenv("DASHSCOPE_MODEL", "qwen3.5-plus")
DASHSCOPE_ASR_KEY = os.getenv("DASHSCOPE_ASR_KEY", "")  # same as chat key or separate Bailian key
DASHSCOPE_ASR_MODEL = os.getenv("DASHSCOPE_ASR_MODEL", "fun-asr-realtime")
DASHSCOPE_EMBED_KEY = os.getenv("DASHSCOPE_EMBED_KEY", "")  # same as chat key or separate Bailian key
DASHSCOPE_EMBED_MODEL = os.getenv("DASHSCOPE_EMBED_MODEL", "text-embedding-v4")

# ── MiniMax ─────────────────────────────────────────────────
MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY", "")
MINIMAX_BASE_URL = os.getenv("MINIMAX_BASE_URL", "https://api.minimaxi.com/anthropic/v1")
MINIMAX_MODEL_DEFAULT = os.getenv("MINIMAX_MODEL", "MiniMax-M2.7")

# ── Zhipu GLM ────────────────────────────────────────────────
ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY", "")
ZHIPU_BASE_URL = os.getenv("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")
ZHIPU_MODEL_DEFAULT = os.getenv("ZHIPU_MODEL", "glm-4")

# ── Kimi / Moonshot ─────────────────────────────────────────
KIMI_API_KEY = os.getenv("KIMI_API_KEY", "")
KIMI_BASE_URL = os.getenv("KIMI_BASE_URL", "https://api.moonshot.cn/v1")
KIMI_MODEL_DEFAULT = os.getenv("KIMI_MODEL", "moonshot-v1-8k")

def _model_default() -> str:
    if PROVIDER == "dashscope": return DASHSCOPE_MODEL_DEFAULT
    if PROVIDER == "minimax":   return MINIMAX_MODEL_DEFAULT
    if PROVIDER == "zhipu":     return ZHIPU_MODEL_DEFAULT
    if PROVIDER == "kimi":      return KIMI_MODEL_DEFAULT
    return OLLAMA_MODEL_DEFAULT

# ── Per-agent model overrides ────────────────────────────────
_agent_models: Dict[str, str] = {
    "alpha": os.getenv("LLM_MODEL_ALPHA", "") or _model_default(),
    "beta":  os.getenv("LLM_MODEL_BETA",  "") or _model_default(),
    "gamma": os.getenv("LLM_MODEL_GAMMA", "") or _model_default(),
    "delta": os.getenv("LLM_MODEL_DELTA", "") or _model_default(),
}

# Legacy env var names for backwards compat
for _aid in ["alpha", "beta", "gamma", "delta"]:
    _legacy = f"OLLAMA_MODEL_{_aid.upper()}"
    if os.getenv(_legacy) and not os.getenv(f"LLM_MODEL_{_aid.upper()}"):
        _agent_models[_aid] = os.getenv(_legacy)  # type: ignore

# Vision model (always Ollama local)
VISION_MODEL = os.getenv("OLLAMA_MODEL_VISION", "qwen3-vl:4b")

import chromadb
from chromadb.config import Settings

# ── ChromaDB — persistent vector memory ─────────────────────
_chroma_client: Optional[chromadb.PersistentClient] = None
_memory_collection: Optional[chromadb.Collection] = None

def _init_chroma() -> None:
    global _chroma_client, _memory_collection
    try:
        _chroma_client = chromadb.PersistentClient(path="./chroma_data")
        _memory_collection = _chroma_client.get_or_create_collection(
            name="chat_memory",
            metadata={"description": "OpenClaw multi-agent chat history"},
        )
        print("[ChromaDB] Vector memory ready")
    except Exception as exc:  # noqa: BLE001
        print(f"[ChromaDB] Init failed: {exc}")
        _chroma_client = None
        _memory_collection = None

# ── Bailian text embedding ──────────────────────────────────

async def _embed_texts(texts: List[str]) -> List[List[float]]:
    """Return embeddings for a list of texts via Bailian text-embedding-v4."""
    print(f"[_embed_texts] embedding {len(texts)} texts")
    key = DASHSCOPE_EMBED_KEY or DASHSCOPE_API_KEY
    if not key:
        raise RuntimeError("DASHSCOPE_EMBED_KEY not configured")

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": DASHSCOPE_EMBED_MODEL,
        "input": texts,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
            json=payload,
            headers=headers,
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Embedding API error {resp.status_code}: {resp.text[:200]}")

    result = resp.json()
    embeddings = result.get("data", [])
    return [e.get("embedding", []) for e in embeddings]

async def memory_search(query: str, top_k: int = 5) -> List[dict]:
    """Search ChromaDB for top_k messages most relevant to query."""
    if not _memory_collection:
        return []
    try:
        # Embed the query
        results = await _embed_texts([query])
        query_embedding = results[0]
        if not query_embedding:
            return []

        hits = _memory_collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            include=["metadatas", "documents"],
        )
        docs = hits.get("documents", [[]])[0]
        metas = hits.get("metadatas", [[]])[0]
        if not docs:
            return []
        return [
            {"text": doc, "metadata": meta or {}}
            for doc, meta in zip(docs, metas)
        ]
    except Exception:  # noqa: BLE001
        return []

async def memory_add(text: str, metadata: dict) -> None:
    """Store a message in ChromaDB vector memory."""
    if not _memory_collection:
        return
    try:
        doc_id = f"{metadata.get('agent_id','user')}-{metadata.get('timestamp', int(time.time()*1000))}"
        embeddings = await _embed_texts([text])
        _memory_collection.add(
            ids=[doc_id],
            documents=[text],
            embeddings=embeddings,
            metadatas=[metadata],
        )
    except Exception:  # noqa: BLE001
        pass

# ---------------------------------------------------------------------------
# Local router — Ollama small model decides routing + keyword fallback
# ---------------------------------------------------------------------------

ROUTER_SYSTEM = """You are a message router. Output ONLY valid JSON, nothing else.

Output format (exact keys required):
{"intent":"","targets":[],"model":"","reason":""}

Intents: architecture | coding | testing | operations | simple | general
Targets: ["alpha"] | ["beta"] | ["gamma"] | ["delta"] | ["all"]
Model: "" (empty) or specific model name

Rules:
- architecture/system design/tech selection → ["alpha"]
- code/implementation/algorithm/refactor → ["beta"]
- test/bug/risk/audit/boundary → ["gamma"]
- deploy/ops/monitoring/scaling/infrastructure → ["delta"]
- greeting/casual/simple question → ["all"]
- complex/ambiguous/major decision → ["all"]

Output JSON only. No explanation. No markdown."""


# Keyword-based fallback router (runs if LLM router fails)
def _keyword_route(text: str) -> dict:
    """Fast keyword-based routing when LLM is unavailable or misbehaves."""
    t = text.lower()
    if any(k in t for k in ["架构", "设计", "系统设计", "技术选型", "architecture", "design"]):
        return {"intent": "architecture", "target_agents": ["alpha"], "model_override": "", "reason": "关键词匹配: architecture"}
    if any(k in t for k in ["代码", "实现", "算法", "重构", "code", "implement", "algorithm"]):
        return {"intent": "coding", "target_agents": ["beta"], "model_override": "", "reason": "关键词匹配: coding"}
    if any(k in t for k in ["测试", "bug", "边界", "风险", "test", "audit", "boundary"]):
        return {"intent": "testing", "target_agents": ["gamma"], "model_override": "", "reason": "关键词匹配: testing"}
    if any(k in t for k in ["部署", "运维", "监控", "扩展", "deploy", "ops", "monitor", "scale"]):
        return {"intent": "operations", "target_agents": ["delta"], "model_override": "", "reason": "关键词匹配: operations"}
    if any(k in t for k in ["你好", "hi", "hello", "嗨", "天气", "吗"]):
        return {"intent": "simple", "target_agents": ["all"], "model_override": "", "reason": "关键词匹配: simple"}
    return {"intent": "general", "target_agents": ["all"], "model_override": "", "reason": "关键词默认: general"}


async def route_message(user_message: str) -> dict:
    """
    Use local Ollama small model to decide routing.
    Falls back to keyword routing if the model fails or returns invalid JSON.
    """
    payload = {
        "model": OLLAMA_MODEL_ROUTER,
        "messages": [
            {"role": "system", "content": ROUTER_SYSTEM},
            {"role": "user", "content": user_message},
        ],
        "stream": False,
        "options": {"num_predict": 120, "temperature": 0.1},
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data.get("message", {}).get("content", "").strip()

        # Try to extract JSON object
        start = content.find("{")
        end = content.rfind("}") + 1
        if start == -1 or end <= start:
            print(f"[Router] no JSON found in: {content[:100]}, using keyword fallback")
            return _keyword_route(user_message)

        result = json.loads(content[start:end])
        targets = result.get("targets", result.get("target_agents", []))
        if isinstance(targets, str):
            targets = [targets]
        if not targets or targets == ["me"]:
            targets = ["all"]

        return {
            "intent": result.get("intent", "general"),
            "target_agents": targets,
            "model_override": result.get("model", result.get("model_override", "")) or "",
            "reason": result.get("reason", ""),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"[Router] LLM failed ({exc}), using keyword fallback")
        return _keyword_route(user_message)


# ---------------------------------------------------------------------------
# Agent definitions
# ---------------------------------------------------------------------------

AGENT_IDS: List[Literal["alpha", "beta", "gamma", "delta"]] = [
    "alpha",
    "beta",
    "gamma",
    "delta",
]

AGENT_META: Dict[str, Dict[str, str]] = {
    "alpha": {
        "name": "总架构师",
        "color": "#6366f1",
        "system": (
            "你是'总架构师'(Alpha)，高屋建瓴，战略思维，热爱设计模式。"
            "擅长系统设计、技术选型和架构权衡。"
            "请用中文回答，分析问题时要有大局观，主动提出架构层面的建议。"
        ),
    },
    "beta": {
        "name": "代码工匠",
        "color": "#22c55e",
        "system": (
            "你是'代码工匠'(Beta)，实用主义，代码洁癖，追求优雅实现。"
            "擅长实现细节、代码重构、最佳实践。"
            "请用中文回答，注重代码质量和实现细节，偏好简洁优雅的方案。"
        ),
    },
    "gamma": {
        "name": "质量守门员",
        "color": "#f59e0b",
        "system": (
            "你是'质量守门员'(Gamma)，怀疑一切，测试驱动，风险意识强。"
            "擅长单元测试、边界情况、安全审计。"
            "请用中文回答，关注潜在风险和边界条件，质疑一切未经证实的假设。"
        ),
    },
    "delta": {
        "name": "运维大脑",
        "color": "#ec4899",
        "system": (
            "你是'运维大脑'(Delta)，稳定优先，监控敏锐，偏好自动化。"
            "擅长部署、监控、容错、扩展性。"
            "请用中文回答，关注系统的稳定性、可观测性和运维友好性。"
        ),
    },
}

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------
MAX_HISTORY = 500

# All connected frontend WebSocket clients
clients: Set[WebSocket] = set()

# Rolling message history
message_history: Deque[dict] = deque(maxlen=MAX_HISTORY)

# Agent connection statuses (always "connected" — no external gateway needed)
agent_statuses: Dict[str, str] = {agent_id: "connected" for agent_id in AGENT_IDS}

# Per-agent streaming text buffers  {agent_id: accumulated_text}
stream_buffers: Dict[str, str] = {}

# Lock to serialise AI responses per agent (prevents interleaving)
_response_locks: Dict[str, asyncio.Lock] = {agent_id: asyncio.Lock() for agent_id in AGENT_IDS}

# LLM instance cache (one per model, reused across requests to avoid connection overhead)
_llm_cache: Dict[str, ChatOpenAI] = {}

# ---------------------------------------------------------------------------
# LLM factory (cached per model)
# ---------------------------------------------------------------------------

def make_llm(agent_id: Optional[str] = None, model_override: str = "") -> ChatOpenAI:
    """Return a cached ChatOpenAI instance for the given agent.

    model_override: if set, bypasses cache and uses this model for this request.
    """
    # Use override if provided, otherwise fall back to agent/default model
    if model_override:
        model = model_override
        cache_key = ""  # bypass cache for overrides
    elif agent_id and agent_id in _agent_models:
        model = _agent_models[agent_id]
        cache_key = f"{PROVIDER}:{model}"
    else:
        model = _model_default()
        cache_key = f"{PROVIDER}:{model}"

    if cache_key and cache_key in _llm_cache:
        return _llm_cache[cache_key]

    if PROVIDER == "ollama":
        llm = ChatOpenAI(
            model=model,
            openai_api_base=f"{OLLAMA_URL}/v1",
            openai_api_key="ollama",
            streaming=True,
            request_timeout=300,
        )

    elif PROVIDER == "dashscope":
        llm = ChatOpenAI(
            model=model,
            openai_api_base=DASHSCOPE_BASE_URL,
            openai_api_key=DASHSCOPE_API_KEY,
            streaming=True,
            request_timeout=120,
        )

    elif PROVIDER == "minimax":
        llm = ChatOpenAI(
            model=model,
            openai_api_base=MINIMAX_BASE_URL,
            openai_api_key=MINIMAX_API_KEY,
            streaming=True,
            request_timeout=120,
        )

    elif PROVIDER == "zhipu":
        llm = ChatOpenAI(
            model=model,
            openai_api_base=ZHIPU_BASE_URL,
            openai_api_key=ZHIPU_API_KEY,
            streaming=True,
            request_timeout=120,
        )

    elif PROVIDER == "kimi":
        llm = ChatOpenAI(
            model=model,
            openai_api_base=KIMI_BASE_URL,
            openai_api_key=KIMI_API_KEY,
            streaming=True,
            request_timeout=120,
        )

    else:
        raise ValueError(f"Unknown LLM provider: {PROVIDER}")

    if cache_key:
        _llm_cache[cache_key] = llm
    return llm


# ---------------------------------------------------------------------------
# Vision — image understanding via Ollama native API
# ---------------------------------------------------------------------------

async def analyze_image(base64_data: str) -> str:
    """
    Use a vision model to understand an image (base64).
    Falls back to '无法分析图片' on failure.
    """
    try:
        # Strip data URL prefix if present (e.g. "data:image/png;base64,...")
        if "," in base64_data:
            base64_data = base64_data.split(",", 1)[1]

        payload = {
            "model": VISION_MODEL,
            "prompt": (
                "你是一位图像分析专家。请详细描述这张图片的内容，包括："
                "主体是什么、场景/背景、颜色特征、文字内容（如果有）、"
                "以及任何值得注意的细节。用中文回答，描述控制在100字以内。"
            ),
            "images": [base64_data],
            "stream": False,
            "options": {"num_predict": 200},
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            description = data.get("response", "").strip()
            return description if description else "[图片内容无法识别]"

    except Exception as exc:  # noqa: BLE001
        return f"[图片分析失败: {exc}]"


# ---------------------------------------------------------------------------
# WebSocket broadcast helpers
# ---------------------------------------------------------------------------

async def send_json(ws: WebSocket, data: dict) -> None:
    """Send a JSON-encoded message to a single client."""
    try:
        await ws.send_json(data)
    except Exception:
        pass  # client may have disconnected; broadcast_* helpers handle removal


async def broadcast(data: dict) -> None:
    """Send a JSON message to all connected frontend clients."""
    dead = set()
    for ws in list(clients):
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    for ws in dead:
        clients.discard(ws)


def build_msg_payload(message: dict) -> dict:
    """Wrap a raw message dict in the protocol envelope."""
    return {"type": "message", "message": message}


def build_ai_event_payload(event: dict) -> dict:
    """Wrap an AI event in the protocol envelope."""
    return {"type": "ai_event", "event": event, "timestamp": int(time.time() * 1000)}


def build_ai_thinking_payload(agent_id: str) -> dict:
    """Build an ai_thinking notification."""
    return {
        "type": "ai_thinking",
        "agentId": agent_id,
        "timestamp": int(time.time() * 1000),
    }


def build_agent_status_payload(agent_id: str, status_val: str) -> dict:
    """Build an agent_status notification."""
    return {"type": "agent_status", "agentId": agent_id, "status": status_val}


# ---------------------------------------------------------------------------
# Streaming callback
# ---------------------------------------------------------------------------

class StreamingCallback:
    """
    Collects streamed tokens and pushes them to all frontend clients
    in real-time as `delta` events, then fires a `final` event when done.
    """

    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.text = ""
        self._done = False
        self._closed = False

    async def _emit_delta(self, full_text: str) -> None:
        """Broadcast a delta event to all connected clients."""
        if self._closed:
            return
        payload = build_ai_event_payload({
            "type": "delta",
            "agentId": self.agent_id,
            "text": full_text,
        })
        await broadcast(payload)

    async def _emit_final(self, final_text: str) -> None:
        """Broadcast a final event to all connected clients."""
        if self._closed:
            return
        self._closed = True
        payload = build_ai_event_payload({
            "type": "final",
            "agentId": self.agent_id,
            "text": final_text,
        })
        await broadcast(payload)

    async def _emit_error(self, message: str) -> None:
        """Broadcast an error event to all connected clients."""
        if self._closed:
            return
        self._closed = True
        payload = build_ai_event_payload({
            "type": "error",
            "agentId": self.agent_id,
            "text": message,
        })
        await broadcast(payload)

    # ── Legacy callback interface (still works for langchain-openai) ──

    def on_llm_new_token(self, token: str, **kwargs) -> None:
        """Called synchronously by langchain. Schedule an async broadcast."""
        if not token or self._closed:
            return
        self.text += token
        # Schedule the async broadcast without blocking the LLM callback thread
        asyncio.create_task(self._emit_delta(self.text))

    def on_llm_end(self, *_args, **_kwargs) -> None:
        # Note: stream_ai_response sends final directly after the astream() loop,
        # so we do NOT emit final here to avoid duplicates.
        # Keep _done guard only for error-callback deduplication.
        if self._done:
            return
        self._done = True

    def on_llm_error(self, error: Exception, **_kwargs) -> None:
        asyncio.create_task(self._emit_error(f"LLM 错误: {error}"))


# ---------------------------------------------------------------------------
# AI response handler
# ---------------------------------------------------------------------------

async def stream_ai_response(agent_id: str, user_message: str, model_override: str = "") -> None:
    """
    Call the LLM for a single agent and stream the response back to clients.

    Protocol sequence per agent:
      1. ai_thinking  (server → client)
      2. ai_event delta × N  (streamed)
      3. ai_event final  (when complete)
      4. ai_event error  (if something goes wrong)
    """
    async with _response_locks[agent_id]:
        # 1. Notify thinking state
        print(f"[Agent {agent_id}] broadcasting thinking")
        await broadcast(build_ai_thinking_payload(agent_id))

        # 2. Retrieve relevant memories from ChromaDB
        meta = AGENT_META[agent_id]
        memories = await memory_search(user_message, top_k=5)
        memory_block = ""
        if memories:
            memory_lines = [
                f"[历史上下文] {m['text']}（{m['metadata'].get('agent_id','?')}）"
                for m in memories
            ]
            memory_block = "\n".join(memory_lines) + "\n\n"

        # Build system prompt with memory context
        system_with_memory = (
            meta["system"]
            + ("\n\n" + memory_block if memory_block else "")
            + ("记住：用户可能引用了上面的历史上下文，请结合回答。" if memory_block else "")
        )

        try:
            print(f"[Agent {agent_id}] starting LLM call (provider={PROVIDER})")
            # 3. Provider-agnostic LLM call via httpx OpenAI-compatible endpoint
            model_name = model_override or _agent_models.get(agent_id, _model_default())

            # Resolve base URL and API key based on active provider
            if PROVIDER == "ollama":
                base_url = f"{OLLAMA_URL}/v1"
                api_key = "ollama"
            elif PROVIDER == "dashscope":
                base_url = DASHSCOPE_BASE_URL
                api_key = DASHSCOPE_API_KEY
            elif PROVIDER == "minimax":
                base_url = MINIMAX_BASE_URL
                api_key = MINIMAX_API_KEY
            elif PROVIDER == "zhipu":
                base_url = ZHIPU_BASE_URL
                api_key = ZHIPU_API_KEY
            elif PROVIDER == "kimi":
                base_url = KIMI_BASE_URL
                api_key = KIMI_API_KEY
            else:
                raise ValueError(f"Unknown LLM provider: {PROVIDER}")

            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_with_memory},
                    {"role": "user", "content": user_message},
                ],
                "max_tokens": 2048,
                "stream": False,
            }
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

            # Run blocking httpx call in thread pool to avoid blocking the asyncio event loop
            def _sync_call():
                with httpx.Client(timeout=120.0) as client:
                    resp = client.post(
                        f"{base_url}/chat/completions",
                        json=payload,
                        headers=headers,
                    )
                    resp.raise_for_status()
                    result = resp.json()
                    choices = result.get("choices", [])
                    if choices:
                        return choices[0].get("message", {}).get("content", "").strip()
                    return ""

            full_text = await asyncio.to_thread(_sync_call)
            print(f"[Agent {agent_id}] LLM done, text_len={len(full_text)}")

            # 4. Broadcast complete response
            if full_text:
                # Fire a single delta with the complete text (fast path)
                asyncio.create_task(broadcast(build_ai_event_payload({
                    "type": "delta",
                    "agentId": agent_id,
                    "text": full_text,
                })))

                # Persist to history
                ts = int(time.time() * 1000)
                ai_msg = {
                    "id": f"ai-{agent_id}-{ts}",
                    "type": "ai",
                    "agentId": agent_id,
                    "text": full_text,
                    "timestamp": ts,
                }
                message_history.append(ai_msg)
                await broadcast(build_msg_payload(ai_msg))
                # Store in ChromaDB vector memory (fire-and-forget)
                asyncio.create_task(memory_add(full_text, {
                    "agent_id": agent_id,
                    "type": "ai",
                    "timestamp": ts,
                }))

            final_payload = build_ai_event_payload({
                "type": "final",
                "agentId": agent_id,
                "text": full_text,
            })
            await broadcast(final_payload)

        except Exception as exc:  # noqa: BLE001
            # Send error event if the LLM call itself fails — also persist
            print(f"[Agent {agent_id}] EXCEPTION: {type(exc).__name__}: {exc}")
            error_text = f"[{meta['name']}] 调用失败: {exc}"
            error_msg = {
                "id": f"err-{agent_id}-{int(time.time() * 1000)}",
                "type": "ai",
                "agentId": agent_id,
                "text": error_text,
                "timestamp": int(time.time() * 1000),
            }
            message_history.append(error_msg)
            await broadcast(build_msg_payload(error_msg))
            error_payload = build_ai_event_payload({
                "type": "error",
                "agentId": agent_id,
                "text": error_text,
            })
            await broadcast(error_payload)


async def process_send(target: str, message: str) -> List[str]:
    """
    Handle an incoming 'send' action.

    - target: "alpha" | "beta" | "gamma" | "delta" | "all"
    - message: the user's text

    Returns the list of agent IDs that were activated.
    """
    print(f"[ProcessSend] target={target} msg={message[:20]}")
    # Unique message ID for this user message
    msg_id = str(uuid.uuid4())
    ts = int(time.time() * 1000)

    user_msg = {
        "id": msg_id,
        "type": "user",
        "agentId": "user",
        "text": message,
        "timestamp": ts,
    }

    # Record in history and broadcast to all clients
    message_history.append(user_msg)
    await broadcast(build_msg_payload(user_msg))

    # Store user message in ChromaDB vector memory
    asyncio.create_task(memory_add(message, {"agent_id": "user", "type": "user", "timestamp": ts}))

    # Determine which agents should respond — use local router if broadcast
    if target == "all":
        route = await route_message(message)
        active_agents = route["target_agents"]
        # Expand "all" sentinel to all real agents
        if "all" in active_agents:
            active_agents = list(AGENT_IDS)
        model_override = route.get("model_override", "")
        print(f"[Router] intent={route['intent']} → {active_agents} ({route['reason']})")
    elif target in AGENT_IDS:
        active_agents = [target]
        model_override = ""
    else:
        active_agents = []
        model_override = ""

    # Fire AI responses concurrently
    print(f"[ProcessSend] spawning {len(active_agents)} agents: {active_agents}")
    tasks = [
        stream_ai_response(agent_id, message, model_override)
        for agent_id in active_agents
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    print(f"[ProcessSend] all done, results: {[type(r).__name__ for r in results]}")
    for r in results:
        if isinstance(r, Exception):
            print(f"[ProcessSend] agent error: {r}")

    return active_agents


async def process_send_with_image(target: str, message: str, image_b64: str) -> List[str]:
    """
    Handle a send action that includes an image.
    The image is first analyzed by the vision model, then the enriched
    prompt is broadcast to all agents.
    """
    msg_id = str(uuid.uuid4())
    ts = int(time.time() * 1000)

    # Step 1: Analyze image
    vision_description = await analyze_image(image_b64)

    # Step 2: Build enriched prompt
    enriched_prompt = (
        f"[用户上传了一张图片。图片内容描述：{vision_description}]\n\n"
        f"用户的提问或发言：{message}"
    )

    # Step 3: Broadcast user message with image metadata
    user_msg = {
        "id": msg_id,
        "type": "user",
        "agentId": "user",
        "text": message,
        "image": image_b64,
        "visionDescription": vision_description,
        "timestamp": ts,
    }
    message_history.append(user_msg)
    await broadcast(build_msg_payload(user_msg))

    # Step 4: Route and fire AI responses
    if target == "all":
        route = await route_message(enriched_prompt)
        active_agents = route["target_agents"]
        model_override = route.get("model_override", "")
    elif target in AGENT_IDS:
        active_agents = [target]
        model_override = ""
    else:
        active_agents = []
        model_override = ""

    tasks = [
        stream_ai_response(agent_id, enriched_prompt, model_override)
        for agent_id in active_agents
    ]
    await asyncio.gather(*tasks, return_exceptions=True)

    return active_agents


# ---------------------------------------------------------------------------
# FastAPI lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown hooks."""
    _init_chroma()  # Initialise ChromaDB vector memory
    yield
    # Shutdown: close all client connections gracefully
    for ws in list(clients):
        try:
            await ws.close()
        except Exception:
            pass
    clients.clear()


app = FastAPI(title="OpenClaw Chat Room", lifespan=lifespan)

# Allow the React frontend (port 3000) to access this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """
    Main WebSocket entrypoint for the React frontend.

    Protocol (server → client):
      - { type: "init", statuses: {alpha:"connected",...}, messages: [] }
      - { type: "agent_status", agentId, status }
      - { type: "message", message: {...} }
      - { type: "ai_thinking", agentId, timestamp }
      - { type: "ai_event", event: {type:"delta"|"final"|"error", agentId, text}, timestamp }

    Protocol (client → server):
      - { type: "send", target: "alpha"|"beta"|"gamma"|"delta"|"all", message: string }
    """
    await ws.accept()
    clients.add(ws)

    # Send initial state
    init_payload = {
        "type": "init",
        "statuses": dict(agent_statuses),
        "messages": list(message_history),
    }
    try:
        await ws.send_json(init_payload)
    except Exception:
        clients.discard(ws)
        return

    # Broadcast connected statuses to everyone else
    for agent_id in AGENT_IDS:
        await broadcast(build_agent_status_payload(agent_id, "connected"))

    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            if msg_type == "send":
                target = msg.get("target", "all")
                text = msg.get("message", "").strip()
                if text:
                    asyncio.create_task(process_send(target, text))

            elif msg_type == "send_with_image":
                target = msg.get("target", "all")
                text = msg.get("message", "").strip()
                image_b64 = msg.get("image", "")
                if text and image_b64:
                    asyncio.create_task(process_send_with_image(target, text, image_b64))

            # Unknown message types are silently ignored

    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

class SendRequest(BaseModel):
    target: str = "all"
    message: str
    image: str | None = None  # base64 data URL


class SendResponse(BaseModel):
    id: str
    status: str
    targets: List[str]


@app.get("/api/status", response_model=Dict[str, str])
async def get_status() -> Dict[str, str]:
    """Return the current connection status of every agent."""
    return dict(agent_statuses)


@app.post("/api/send", response_model=SendResponse, status_code=status.HTTP_200_OK)
async def rest_send(body: SendRequest) -> SendResponse:
    """
    Send a message to one or all agents via REST (alternative to WebSocket).

    Body: { "target": "alpha"|"beta"|"gamma"|"delta"|"all", "message": "...", "image": "data:..." }
    """
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="message cannot be empty")

    if body.image:
        targets = await process_send_with_image(body.target, body.message.strip(), body.image)
    else:
        targets = await process_send(body.target, body.message.strip())

    return SendResponse(
        id=str(uuid.uuid4()),
        status="queued",
        targets=targets,
    )


@app.get("/api/history", response_model=List[dict])
async def get_history(limit: int = 100) -> List[dict]:
    """
    Return the message history.

    Query param `limit` (default 100) caps how many recent messages are returned.
    """
    return list(message_history)[-limit:]


# ---------------------------------------------------------------------------
# ASR — MiniMax qwen-audio-asr
# ---------------------------------------------------------------------------

async def transcribe_dashscope_asr(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """
    Call Dashscope Bailian ASR API (fun-asr-realtime / qwen-audio-asr).
    Frontend fallback chain:
      1. Browser Web Speech API (native, no quota) ← primary
      2. Dashscope Bailian ASR  ← this endpoint
    """
    key = DASHSCOPE_ASR_KEY or DASHSCOPE_API_KEY
    if not key:
        raise HTTPException(status_code=503, detail="DASHSCOPE_ASR_KEY not configured")

    # Choose best model by preference
    model = DASHSCOPE_ASR_MODEL  # e.g. "fun-asr-realtime"

    # Compute content type
    ext = filename.rsplit(".", 1)[-1].lower()
    mime_map = {"webm": "audio/webm", "wav": "audio/wav", "mp3": "audio/mpeg", "ogg": "audio/ogg", "m4a": "audio/mp4"}
    content_type = mime_map.get(ext, "audio/webm")

    base64_audio = base64.b64encode(audio_bytes).decode("utf-8")

    payload = {
        "model": model,
        "input": {
            "audio": f"data:{content_type};base64,{base64_audio}",
        },
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
            json=payload,
            headers=headers,
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"ASR error: {resp.text}")

    result = resp.json()
    # Bailian ASR returns { output: { text: "..." }, ... }
    output = result.get("output", {})
    return output.get("text", "") or output.get("content", "")


@app.post("/api/asr", response_model=Dict[str, str])
async def asr_endpoint(file: UploadFile) -> Dict[str, str]:
    """
    Accept an audio file upload and transcribe it via Dashscope Bailian ASR.

    Frontend fallback chain:
      1. Browser Web Speech API (native, no quota) ← primary
      2. Dashscope Bailian ASR  ← this endpoint
    """
    if not file.content_type or not file.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Only audio files are accepted")

    audio_bytes = await file.read()
    if len(audio_bytes) < 512:
        raise HTTPException(status_code=400, detail="Audio file too small")

    try:
        text = await transcribe_dashscope_asr(audio_bytes, file.filename or "audio.webm")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"text": text}


@app.get("/api/health")
async def health_check() -> dict:
    """Simple health check endpoint."""
    return {
        "status": "ok",
        "provider": PROVIDER,
        "default_model": _model_default(),
        "agent_models": _agent_models,
    }


# ---------------------------------------------------------------------------
# Entry point (for `uvicorn main:app`)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)
