# OpenClaw Multi-Agent Brainstorming Chat Room

## 1. Concept & Vision

一个融合四个 AI Agent 的群聊空间，每个 Agent 都有鲜明的身份、思维模式和专长领域。用户发起讨论，四个 Agent 各抒己见、相互辩驳、补充盲点，模拟一场高质量的技术头脑风暴会议。界面风格：深邃科技感，暗色主题，仿佛置身于指挥中心。

## 2. Design Language

- **Aesthetic**: 深空指挥中心（Deep Space Command Center）— 暗色背景、发光边框、粒子动效
- **Color Palette**:
  - Background: `#0a0e1a`
  - Surface: `#111827`
  - Surface Elevated: `#1f2937`
  - Border: `#374151`
  - Alpha (架构师): `#6366f1` (Indigo)
  - Beta (工匠): `#22c55e` (Emerald)
  - Gamma (质量官): `#f59e0b` (Amber)
  - Delta (运维官): `#ec4899` (Pink)
  - User: `#60a5fa` (Sky Blue)
  - Text Primary: `#f9fafb`
  - Text Secondary: `#9ca3af`
- **Typography**: JetBrains Mono (代码), Inter (UI)
- **Motion**: 消息滑入（slide-in 300ms ease-out），AI 思考时有打字机光标效果，连接状态脉冲动画

## 3. Layout & Structure

```
┌─────────────────────────────────────────────────────────┐
│  HEADER: Logo + 连接状态 + 四个 Agent 状态指示灯         │
├───────────┬───────────┬───────────┬──────────┬──────────┤
│  Alpha    │   Beta    │   Gamma   │   Delta  │  [ALL]   │  ← 频道选择
├───────────┴───────────┴───────────┴──────────┴──────────┤
│                                                          │
│              MESSAGE AREA (虚拟滚动)                      │
│  [Avatar] Name — HH:mm                                   │
│  Message bubble with agent-specific accent color         │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [Select Agent ▼]  [Message Input...]  [Send ▶]         │
└──────────────────────────────────────────────────────────┘
```

## 4. Features & Interactions

### 4.1 四 Agent 身份定义

| Agent | 代号 | 颜色 | 性格描述 | 专长 |
|-------|------|------|----------|------|
| Alpha | 总架构师 | Indigo | 高屋建瓴，战略思维，热爱设计模式 | 系统设计、技术选型、架构权衡 |
| Beta | 代码工匠 | Emerald | 实用主义，代码洁癖，追求优雅实现 | 实现细节、代码重构、最佳实践 |
| Gamma | 质量守门员 | Amber | 怀疑一切，测试驱动，风险意识强 | 单元测试、边界情况、安全审计 |
| Delta | 运维大脑 | Pink | 稳定优先，监控敏锐，偏好自动化 | 部署、监控、容错、扩展性 |

### 4.2 消息发送模式
- **单播**: 选择特定 Agent 发送，只有一个 Agent 回复
- **广播**: 选择"All"，消息同时发送给所有 Agent（异步并发）
- **回复引用**: 点击消息可引用/回复特定 Agent 的消息

### 4.3 消息展示
- 每条消息显示 Avatar（Agent 首字母）、名称、时间戳
- AI 回复流式展示（typing effect）
- 思考中显示动画省略号
- 消息气泡颜色与 Agent 主题色一致

### 4.4 连接状态
- 每个 Agent 有独立连接状态指示灯：绿色=已连接，红色=断开，橙色=连接中
- 连接断开时自动重连（指数退避）
- 连接状态在 Header 实时显示

## 5. Component Inventory

### 5.1 AgentStatusPill
- 圆形指示灯 + Agent 名称 + 状态文字
- States: connected（绿色脉冲）、connecting（橙色闪烁）、disconnected（红色）

### 5.2 ChatMessage
- Avatar (彩色首字母) + Agent Name + 时间
- 消息气泡（圆角，颜色按 Agent 区分）
- 用户消息右对齐蓝色，AI 消息左对齐

### 5.3 MessageInput
- Select dropdown 选择目标 Agent
- TextArea 自动扩展
- Send 按钮 (蓝色)
- Disabled 状态当全部离线时

### 5.4 AgentChannelTabs
- 5 个 Tab: Alpha / Beta / Gamma / Delta / All
- 每个 Tab 显示未读消息计数

## 6. Technical Approach

### 6.1 Backend (Python FastAPI) — ✅ 已实现
```
backend/
  main.py            # FastAPI + WebSocket + LangChain 流式后端
  requirements.txt    # 依赖：fastapi, uvicorn, langchain-openai, python-dotenv
  .env.example       # 环境变量模板
```

**API Design:**
- `WS /ws` — 前端 WebSocket 连接，接收实时消息推送
- `POST /api/send` — 发送消息到指定 Agent 或全部
  - Body: `{ target: "alpha|beta|gamma|delta|all", message: string }`
  - Response: `{ id: string, status: "queued", targets: string[] }`
- `GET /api/status` — 所有 Agent 连接状态（始终 connected）
- `GET /api/history` — 全部消息历史
- `GET /api/health` — 健康检查

### 6.2 LLM 集成
- 优先使用 `OPENAI_API_KEY`（gpt-4o-mini）
- 未配置时使用本地 Ollama（`http://localhost:11434`，模型 `qwen2.5`）
- 每个 Agent 有独立 system prompt
- 响应通过 `astream` 流式推送

### 6.3 Frontend (React + Vite + Ant Design) ✅ 已实现
```
client/
  src/
    App.jsx             # 主布局
    components/
      Header.jsx        # 状态栏 + Agent 指示灯
      MessageList.jsx   # 虚拟滚动消息区
      ChatMessage.jsx   # 单条消息
      MessageInput.jsx   # 输入框
      AgentStatus.jsx    # 连接状态组件
    hooks/
      useGateway.js     # 订阅后端 WebSocket
    styles/
      global.css        # 全局样式 + CSS 变量
```

### 6.4 Agent Personas
