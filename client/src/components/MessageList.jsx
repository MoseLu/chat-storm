import { useRef, useState, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { IconCopy, IconCheck, IconQuote, IconMaximize, IconMinimize, IconCornerDownLeft } from './Icons';

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

/* ── Fullscreen Portal ──────────────────────────────────────────────────── */
function FullscreenCodeModal({ language, code, onClose }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-fullscreen-overlay" onClick={onClose}>
      <div className="code-fullscreen-container" onClick={(e) => e.stopPropagation()}>
        <div className="code-block-header">
          <div className="code-block-header-left">
            <span className="code-block-dot red" />
            <span className="code-block-dot yellow" />
            <span className="code-block-dot green" />
            <span className="code-block-language">{language || 'plaintext'}</span>
          </div>
          <div className="code-block-actions">
            <button className={`code-action-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
            <button className="code-action-btn" onClick={onClose}>
              <IconMinimize size={14} />
              <span>退出</span>
            </button>
          </div>
        </div>
        <div className="code-fullscreen-content">
          <SyntaxHighlighter
            language={language || 'plaintext'}
            style={oneDark}
            showLineNumbers
            customStyle={{
              margin: 0, borderRadius: 0, fontSize: '14px',
              background: '#1e1e2e', maxHeight: '80vh', overflow: 'auto',
            }}
            codeTagProps={{ style: { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    </div>
  );
}

/* ── CodeBlock — matches Doubao/Claude style ────────────────────────────── */
const CodeBlock = memo(function CodeBlock({ language, code, onQuote }) {
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const handleQuote = useCallback(() => {
    const cleanedCode = code.split('\n').map(l => l.trim()).filter(Boolean).join(' ').substring(0, 100);
    onQuote?.({ displayText: cleanedCode + (cleanedCode.length < code.length ? '...' : ''), language });
  }, [code, language, onQuote]);

  const lineCount = code.split('\n').length;
  const lang = language || 'plaintext';

  return (
    <>
      <div className="code-block-wrapper">
        {/* Header bar */}
        <div className="code-block-header">
          <div className="code-block-header-left">
            <span className="code-block-dot red" />
            <span className="code-block-dot yellow" />
            <span className="code-block-dot green" />
            <span className="code-block-language">{lang}</span>
            <span className="code-block-lines">{lineCount} 行</span>
          </div>
          <div className="code-block-actions">
            <button className="code-action-btn" onClick={() => setCollapsed(v => !v)} title={collapsed ? '展开' : '折叠'}>
              <span>{collapsed ? '▶ 展开' : '▼ 折叠'}</span>
            </button>
            {onQuote && (
              <button className="code-action-btn" onClick={handleQuote} title="引用回复">
                <IconCornerDownLeft size={14} />
                <span>引用</span>
              </button>
            )}
            <button className="code-action-btn" onClick={() => setFullscreen(true)} title="全屏">
              <IconMaximize size={14} />
              <span>全屏</span>
            </button>
            <button className={`code-action-btn ${copied ? 'copied' : ''}`} onClick={handleCopy} title="复制代码">
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
          </div>
        </div>
        {/* Code body */}
        {!collapsed && (
          <SyntaxHighlighter
            language={lang}
            style={oneDark}
            showLineNumbers
            customStyle={{
              margin: 0,
              borderRadius: '0 0 8px 8px',
              fontSize: '13px',
              lineHeight: '1.65',
              background: '#1e1e2e',
              padding: '16px 16px 16px 0',
              maxHeight: '520px',
              overflowY: 'auto',
            }}
            lineNumberStyle={{
              minWidth: '2.5em',
              paddingRight: '1em',
              color: '#4b5263',
              fontSize: '12px',
              userSelect: 'none',
            }}
            codeTagProps={{ style: { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } }}
            wrapLongLines={false}
          >
            {code}
          </SyntaxHighlighter>
        )}
        {collapsed && (
          <div className="code-collapsed-placeholder" onClick={() => setCollapsed(false)}>
            点击展开 ({lineCount} 行)
          </div>
        )}
      </div>

      {fullscreen && (
        <FullscreenCodeModal language={lang} code={code} onClose={() => setFullscreen(false)} />
      )}
    </>
  );
});

/* ── Inline Code ─────────────────────────────────────────────────────────── */
function InlineCode({ children }) {
  return <code className="inline-code">{children}</code>;
}

/* ── MarkdownContent — full GFM markdown rendering ─────────────────────── */
function MarkdownContent({ text, onQuote, stream = false }) {
  const components = {
    // Code blocks
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : '';
      const code = String(children).replace(/\n$/, '');

      if (!inline && (match || code.includes('\n'))) {
        return <CodeBlock language={lang} code={code} onQuote={onQuote} />;
      }
      return <InlineCode>{code}</InlineCode>;
    },
    // Paragraphs — tighten spacing in bubbles
    p({ children }) {
      return <p className="md-p">{children}</p>;
    },
    // Headings
    h1({ children }) { return <h1 className="md-h1">{children}</h1>; },
    h2({ children }) { return <h2 className="md-h2">{children}</h2>; },
    h3({ children }) { return <h3 className="md-h3">{children}</h3>; },
    // Lists
    ul({ children }) { return <ul className="md-ul">{children}</ul>; },
    ol({ children }) { return <ol className="md-ol">{children}</ol>; },
    li({ children }) { return <li className="md-li">{children}</li>; },
    // Blockquote
    blockquote({ children }) { return <blockquote className="md-blockquote">{children}</blockquote>; },
    // Table (GFM)
    table({ children }) { return <div className="md-table-wrap"><table className="md-table">{children}</table></div>; },
    thead({ children }) { return <thead>{children}</thead>; },
    tbody({ children }) { return <tbody>{children}</tbody>; },
    tr({ children }) { return <tr>{children}</tr>; },
    th({ children }) { return <th className="md-th">{children}</th>; },
    td({ children }) { return <td className="md-td">{children}</td>; },
    // Horizontal rule
    hr() { return <hr className="md-hr" />; },
    // Links — open in new tab safely
    a({ href, children }) {
      return <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">{children}</a>;
    },
    // Strong / em
    strong({ children }) { return <strong className="md-strong">{children}</strong>; },
    em({ children }) { return <em className="md-em">{children}</em>; },
  };

  return (
    <div className={`md-content ${stream ? 'streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text || ''}
      </ReactMarkdown>
      {stream && <span className="typing-cursor" />}
    </div>
  );
}

/* ── Quote bubble ────────────────────────────────────────────────────────── */
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

/* ── Welcome Banner ──────────────────────────────────────────────────────── */
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

/* ── UnifiedBubble — thinking dots → streaming markdown ─────────────────── */
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
        <MarkdownContent text={text} stream />
      )}
    </div>
  );
}

/* ── MessageList (main export) ───────────────────────────────────────────── */
export default function MessageList({ messages, thinking, streamTexts, selectedTarget, messagesEndRef, onImageClick, onQuote }) {
  const containerRef = useRef(null);

  const visible = messages.filter((m) => {
    if (selectedTarget === 'all') return true;
    if (m.type === 'user') return true;
    return m.agentId === selectedTarget;
  });

  const liveAgentIds = new Set([
    ...Object.keys(streamTexts),
    ...Object.keys(thinking).filter((a) => !streamTexts[a]),
  ]);

  const liveItems = Array.from(liveAgentIds).map((agentId) => ({
    agentId,
    text:       streamTexts[agentId] ?? '',
    isThinking: thinking[agentId] === true && !streamTexts[agentId],
  }));

  const visibleLive = liveItems.filter(
    ({ agentId }) => selectedTarget === 'all' || agentId === selectedTarget
  );

  return (
    <div className="chat-area" ref={containerRef}>
      {visible.length === 0 && visibleLive.length === 0 && <WelcomeBanner />}

      {/* ── Historical messages ──────────────────────────────────── */}
      {visible.map((msg) => {
        const meta    = msg.agentId ? AGENT_META[msg.agentId] : null;
        const agentName = msg.type === 'user' ? '你' : (meta?.name || msg.agentId);

        return (
          <div key={msg.id} className={`message-row ${msg.type === 'user' ? 'user' : ''}`}>
            <div className={`message-avatar ${msg.agentId}`}>
              {msg.type === 'user' ? 'U' : meta?.name?.[0] || '?'}
            </div>
            <div className="message-body">
              <div className="message-meta">
                <span className={`message-sender ${msg.agentId}`}>
                  {msg.type === 'user' ? '你' : (
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

              {msg.image && (
                <div>
                  <img src={msg.image} alt="用户上传" className="message-image" onClick={() => onImageClick?.(msg.image)} />
                  {msg.visionDescription && (
                    <div className="message-image-caption">AI 图片理解: {msg.visionDescription}</div>
                  )}
                </div>
              )}

              <div className={`message-bubble ${msg.agentId}`}>
                {msg.quote && (
                  <QuoteBubble quotedText={msg.quote.displayText} agentName={msg.quote.agentName || '?'} />
                )}
                <MarkdownContent
                  text={msg.text}
                  onQuote={(q) => onQuote?.({ ...q, agentName })}
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Live items ───────────────────────────────────────────── */}
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
