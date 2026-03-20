import { useRef, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { IconCopy, IconCheck, IconQuote, IconMaximize, IconMinimize, IconSun, IconMoon, IconCornerDownLeft } from './Icons';

const AGENT_META = {
  alpha: { name: 'Alpha',  title: '总架构师', color: '#818cf8' },
  beta:  { name: 'Beta',   title: '代码工匠', color: '#34d399' },
  gamma: { name: 'Gamma', title: '质量守门员', color: '#fbbf24' },
  delta: { name: 'Delta', title: '运维大脑', color: '#f472b6' },
};

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

// Detect and parse code blocks from markdown-style text
function parseContent(text) {
  if (!text) return [];

  const parts = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      parts.push({ type: 'text', content: beforeText });
    }
    // Add code block
    parts.push({
      type: 'code',
      language: match[1] || 'text',
      content: match[2].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts;
}

/* Quote bubble for reply reference */
function QuoteBubble({ quotedText, agentName }) {
  return (
    <div className="quote-bubble">
      <div className="quote-bubble-header">
        <IconCornerDownLeft size={12} />
        <span className="quote-bubble-agent">{agentName}</span>
      </div>
      <div className="quote-bubble-content">
        <span className="quote-text">{quotedText}</span>
      </div>
    </div>
  );
}

function CodeBlock({ language, code, codeIndex, onQuote, onFullscreen }) {
  const [copied, setCopied] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleQuote = () => {
    // Clean up code for display (remove extra whitespace, newlines)
    const cleanedCode = code
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join(' ')
      .substring(0, 100);

    const displayText = cleanedCode.length < code.length ? cleanedCode + '...' : cleanedCode;

    onQuote?.({
      codeIndex,
      displayText,
      language
    });
  };

  const toggleTheme = () => {
    setIsDark(!isDark);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    onFullscreen?.(!isFullscreen);
  };

  const theme = isDark ? oneDark : oneLight;
  const codeStyle = {
    margin: 0,
    borderRadius: '0 0 8px 8px',
    fontSize: '13px',
    lineHeight: '1.6',
    background: isDark ? '#282c34' : '#fafafa',
    paddingTop: '16px',
    color: isDark ? '#abb2bf' : '#24292e',
  };

  const CodeContent = () => (
    <SyntaxHighlighter
      language={language}
      style={theme}
      customStyle={codeStyle}
      codeTagProps={{
        style: {
          color: 'inherit',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }
      }}
      showLineNumbers
      wrapLines
    >
      {code}
    </SyntaxHighlighter>
  );

  return (
    <>
      <div className={`code-block-wrapper ${isFullscreen ? 'fullscreen' : ''}`}>
        <div className="code-block-header">
          <span className="code-block-language">{language || 'code'}</span>
          <div className="code-block-actions">
            <button
              className={`code-action-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopy}
              title="复制代码"
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
            <button
              className="code-action-btn"
              onClick={handleQuote}
              title="引用回复"
            >
              <IconCornerDownLeft size={14} />
              <span>引用</span>
            </button>
            <button
              className="code-action-btn"
              onClick={toggleTheme}
              title={isDark ? '切换到浅色' : '切换到深色'}
            >
              {isDark ? <IconSun size={14} /> : <IconMoon size={14} />}
              <span>{isDark ? '浅色' : '深色'}</span>
            </button>
            <button
              className="code-action-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? '退出全屏' : '全屏'}
            >
              {isFullscreen ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
              <span>{isFullscreen ? '退出' : '全屏'}</span>
            </button>
          </div>
        </div>
        <CodeContent />
      </div>

      {/* Fullscreen Overlay */}
      {isFullscreen && (
        <div className="code-fullscreen-overlay" onClick={toggleFullscreen}>
          <div className="code-fullscreen-container" onClick={(e) => e.stopPropagation()}>
            <div className="code-block-header">
              <span className="code-block-language">{language || 'code'}</span>
              <div className="code-block-actions">
                <button
                  className={`code-action-btn ${copied ? 'copied' : ''}`}
                  onClick={handleCopy}
                  title="复制代码"
                >
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
                <button
                  className="code-action-btn"
                  onClick={handleQuote}
                  title="引用回复"
                >
                  <IconCornerDownLeft size={14} />
                  <span>引用</span>
                </button>
                <button
                  className="code-action-btn"
                  onClick={toggleTheme}
                  title={isDark ? '切换到浅色' : '切换到深色'}
                >
                  {isDark ? <IconSun size={14} /> : <IconMoon size={14} />}
                  <span>{isDark ? '浅色' : '深色'}</span>
                </button>
                <button
                  className="code-action-btn"
                  onClick={toggleFullscreen}
                  title="退出全屏"
                >
                  <IconMinimize size={14} />
                  <span>退出</span>
                </button>
              </div>
            </div>
            <div className="code-fullscreen-content">
              <SyntaxHighlighter
                language={language}
                style={theme}
                customStyle={{
                  ...codeStyle,
                  borderRadius: 0,
                  fontSize: '14px',
                  maxHeight: '80vh',
                  overflow: 'auto',
                }}
                codeTagProps={{
                  style: {
                    color: 'inherit',
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }
                }}
                showLineNumbers
                wrapLines
              >
                {code}
              </SyntaxHighlighter>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function WelcomeBanner() {
  return (
    <div className="welcome-banner">
      <h2>欢迎来到 OpenClaw 头脑风暴室</h2>
      <p>
        这里有四位 AI 专家等待您的提问：
        总架构师 Alpha 负责战略设计，
        代码工匠 Beta 追求优雅实现，
        质量守门员 Gamma 把控风险边界，
        运维大脑 Delta 守护系统稳定。
        <br /><br />
        输入消息发起讨论，四位 Agent 将并发回复。
      </p>
    </div>
  );
}

function ChatBubble({ text, agentId, stream = false, messageId, onQuote, onFullscreen }) {
  const parts = parseContent(text);

  return (
    <div className={`message-bubble ${agentId}`}>
      {parts.map((part, index) => {
        if (part.type === 'code') {
          return (
            <CodeBlock
              key={index}
              language={part.language}
              code={part.content}
              codeIndex={`${messageId}-${index}`}
              onQuote={onQuote}
              onFullscreen={onFullscreen}
            />
          );
        }
        return (
          <span key={index} className="message-text-part">
            {part.content}
          </span>
        );
      })}
      {stream && <span className="typing-cursor" />}
    </div>
  );
}

/**
 * UnifiedBubble — single avatar, single bubble.
 * Seamlessly transitions: dots → streaming text, no double rendering.
 */
function UnifiedBubble({ agentId, text, isThinking }) {
  return (
    <div className={`message-bubble ${agentId}`}>
      {isThinking && !text ? (
        <>
          <span className={`thinking-dots ${agentId}`}>
            <span /><span /><span />
          </span>
          <span style={{ marginLeft: 8, fontSize: 13, opacity: 0.7 }}>正在思考...</span>
        </>
      ) : (
        <>
          {text}
          <span className="typing-cursor" />
        </>
      )}
    </div>
  );
}

export default function MessageList({ messages, thinking, streamTexts, selectedTarget, messagesEndRef, onImageClick, onQuote }) {
  const containerRef = useRef(null);

  // ── Historical messages filtered by channel ──────────────────────
  const visible = messages.filter((m) => {
    if (selectedTarget === 'all') return true;
    if (m.type === 'user') return true;
    return m.agentId === selectedTarget;
  });

  // ── Live items: one row per agent — either dots or streaming text ─
  // Build the set of agentIds that are currently "live"
  const liveAgentIds = new Set([
    ...Object.keys(streamTexts),          // agents with streaming text
    ...Object.keys(thinking).filter((a) => !streamTexts[a]), // thinking-only agents
  ]);

  const liveItems = Array.from(liveAgentIds).map((agentId) => ({
    agentId,
    text:      streamTexts[agentId] ?? '',
    isThinking: thinking[agentId] === true && !streamTexts[agentId],
  }));

  const visibleLive = liveItems.filter(
    ({ agentId }) => selectedTarget === 'all' || agentId === selectedTarget
  );

  return (
    <div className="chat-area" ref={containerRef}>
      {visible.length === 0 && visibleLive.length === 0 && (
        <WelcomeBanner />
      )}

      {/* ── Historical messages ───────────────────────────────────── */}
      {visible.map((msg) => {
        const meta = msg.agentId ? AGENT_META[msg.agentId] : null;
        const agentName = msg.type === 'user' ? '你' : (meta?.name || msg.agentId);
        return (
          <div key={msg.id} className={`message-row ${msg.type === 'user' ? 'user' : ''}`}>
            <div className={`message-avatar ${msg.agentId}`}>
              {msg.type === 'user' ? 'U' : meta?.name?.[0] || '?'}
            </div>
            <div className="message-body">
              <div className="message-meta">
                <span className={`message-sender ${msg.agentId}`}>
                  {msg.type === 'user' ? (
                    '你'
                  ) : (
                    <>
                      {meta?.name || msg.agentId}
                      {meta?.title && (
                        <span style={{ fontWeight: 400, color: '#6b7681', marginLeft: 4 }}>
                          — {meta.title}
                        </span>
                      )}
                    </>
                  )}
                </span>
                <span className="message-time">{formatTime(msg.timestamp)}</span>
              </div>
              {/* Image if present */}
              {msg.image && (
                <div>
                  <img src={msg.image} alt="用户上传" className="message-image" onClick={() => onImageClick?.(msg.image)} />
                  {msg.visionDescription && (
                    <div className="message-image-caption">
                      AI 图片理解: {msg.visionDescription}
                    </div>
                  )}
                </div>
              )}
              <ChatBubble
                text={msg.text}
                agentId={msg.agentId}
                messageId={msg.id}
                onQuote={(quoteData) => onQuote?.({ ...quoteData, agentName })}
              />
            </div>
          </div>
        );
      })}

      {/* ── Live: one unified row per agent (no avatar duplication) ─ */}
      {visibleLive.map(({ agentId, text, isThinking }) => {
        const meta = AGENT_META[agentId];
        if (!meta) return null;
        return (
          <div key={`live-${agentId}`} className="message-row">
            <div className={`message-avatar ${agentId}`}>{meta.name[0]}</div>
            <div className="message-body">
              <div className="message-meta">
                <span className={`message-sender ${agentId}`}>
                  {meta.name}
                  {!isThinking && (
                    <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginLeft: 6 }}>
                      {text ? '正在输入...' : '正在思考...'}
                    </span>
                  )}
                </span>
              </div>
              <UnifiedBubble agentId={agentId} text={text} isThinking={isThinking} />
            </div>
          </div>
        );
      })}

      <div ref={messagesEndRef} />
    </div>
  );
}
