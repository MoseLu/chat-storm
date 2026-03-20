import { useState, useEffect, useRef, useCallback } from 'react';
import { Input, Spin } from 'antd';
import AgentStatus from './components/AgentStatus.jsx';
import MessageList from './components/MessageList.jsx';
import {
  IconWarning, IconLogo, IconSend, IconImage, IconX,
  IconMic, IconMicOff,
} from './components/Icons.jsx';

const { TextArea } = Input;

const AGENTS = [
  { id: 'alpha', label: 'Alpha — 总架构师', color: '#818cf8' },
  { id: 'beta',  label: 'Beta — 代码工匠',  color: '#34d399' },
  { id: 'gamma', label: 'Gamma — 质量守门员', color: '#fbbf24' },
  { id: 'delta', label: 'Delta — 运维大脑',  color: '#f472b6' },
];

const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export default function App() {
  const [ws, setWs] = useState(null);
  const [connected, setConnected] = useState(false);
  const [agentStatuses, setAgentStatuses] = useState({
    alpha: 'disconnected', beta: 'disconnected',
    gamma: 'disconnected', delta: 'disconnected',
  });
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState({});
  const [streamTexts, setStreamTexts] = useState({});
  // Track committed message IDs to prevent duplicates
  const seenMsgIds = useRef(new Set());
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [imageData, setImageData] = useState(null); // { url: dataURL, name: string }
  const [fullscreenImage, setFullscreenImage] = useState(null); // URL for fullscreen viewer
  // Voice recording
  const [voiceStatus, setVoiceStatus] = useState('idle'); // idle | recording | processing
  const [voiceTranscript, setVoiceTranscript] = useState('');
  // Quote/Reply
  const [quote, setQuote] = useState(null); // { text, fullCode, language, agentName }
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const imageInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectDelay = useRef(1000);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, streamTexts, scrollToBottom]);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!fullscreenImage) return;
    const handler = (e) => { if (e.key === 'Escape') setFullscreenImage(null); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fullscreenImage]);

  // WebSocket connection
  const connectWS = useCallback(() => {
    try {
      const socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        setConnected(true);
        setWs(socket);
        reconnectDelay.current = 1000;
        console.log('[App] WS connected');
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleWSMessage(msg);
        } catch (e) {
          console.error('[App] WS parse error:', e);
        }
      };

      socket.onclose = () => {
        setConnected(false);
        setWs(null);
        console.log('[App] WS disconnected, reconnecting in', reconnectDelay.current);
        reconnectTimer.current = setTimeout(connectWS, reconnectDelay.current);
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 15000);
      };

      socket.onerror = (err) => {
        console.error('[App] WS error:', err);
        socket.close();
      };
    } catch (err) {
      console.error('[App] WS connect error:', err);
      reconnectTimer.current = setTimeout(connectWS, reconnectDelay.current);
      reconnectDelay.current = Math.min(reconnectDelay.current * 2, 15000);
    }
  }, []);

  const handleWSMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'init':
        setAgentStatuses(msg.statuses || {});
        setMessages(msg.messages || []);
        break;

      case 'agent_status':
        setAgentStatuses((prev) => ({ ...prev, [msg.agentId]: msg.status }));
        break;

      case 'message':
        // Backend persists user + AI messages to history.
        // Skip if we already have this ID (avoids duplicates from reconnect echo).
        if (msg.message.id && seenMsgIds.current.has(msg.message.id)) break;
        if (msg.message.id) seenMsgIds.current.add(msg.message.id);
        setMessages((prev) => [...prev, msg.message]);
        break;

      case 'ai_thinking':
        // Show thinking dots immediately when the agent starts thinking
        setThinking((prev) => ({ ...prev, [msg.agentId]: true }));
        break;

      case 'ai_event': {
        const { event } = msg;
        if (event.type === 'delta') {
          // Clear thinking state, start showing streamed text
          setThinking((prev) => { const next = {...prev}; delete next[event.agentId]; return next; });
          setStreamTexts((prev) => ({ ...prev, [event.agentId]: event.text }));
        } else if (event.type === 'final') {
          // Message already added via `message` event from backend — just clear live state
          setThinking((prev) => { const next = {...prev}; delete next[event.agentId]; return next; });
          setStreamTexts((prev) => {
            const next = { ...prev };
            delete next[event.agentId];
            return next;
          });
        } else if (event.type === 'error') {
          setThinking((prev) => { const next = {...prev}; delete next[event.agentId]; return next; });
          setStreamTexts((prev) => {
            const next = { ...prev };
            delete next[event.agentId];
            return next;
          });
        }
        break;
      }
    }
  }, []);

  useEffect(() => {
    connectWS();
    return () => {
      clearTimeout(reconnectTimer.current);
      ws?.close();
    };
  }, []);

  const handleSend = useCallback(() => {
    const text = String(inputValue || '').trim();
    if (!text || sending) return;

    setSending(true);
    setInputValue('');
    setQuote(null);

    if (ws && ws.readyState === WebSocket.OPEN) {
      if (imageData) {
        ws.send(JSON.stringify({ type: 'send_with_image', target: 'all', message: text, image: imageData.url, quote }));
        setImageData(null);
      } else {
        ws.send(JSON.stringify({ type: 'send', target: 'all', message: text, quote }));
      }
    }

    setTimeout(() => setSending(false), 500);
  }, [ws, inputValue, sending, imageData, quote]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setFullscreenImage(null);
      setQuote(null);
    }
  }, [handleSend]);

  const handleImageSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImageData({ url: ev.target.result, name: file.name });
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, []);

  const handleImageRemove = useCallback(() => {
    setImageData(null);
  }, []);

  // ── Voice recording ────────────────────────────────────────
  const startVoiceRecording = useCallback(async () => {
    if (voiceStatus !== 'idle') return;
    // Try Web Speech API first (no quota, no latency)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recog = new SpeechRecognition();
      recog.lang = 'zh-CN';
      recog.continuous = true;
      recog.interimResults = true;
      let finalTranscript = '';
      recog.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += t;
          } else {
            interim += t;
          }
        }
        setVoiceTranscript(finalTranscript + interim);
      };
      recog.onerror = (e) => {
        console.warn('[Voice] Web Speech API error:', e.error);
        if (e.error === 'no-speech' || e.error === 'audio-capture') {
          // Fall back to server-side ASR
          fallbackToServerASR();
        }
        setVoiceStatus('idle');
      };
      recog.onend = () => {
        if (voiceStatus === 'recording') {
          // User stopped manually — use accumulated transcript
          if (finalTranscript || voiceTranscript) {
            setInputValue((prev) => (prev ? prev + ' ' + (finalTranscript || voiceTranscript) : finalTranscript || voiceTranscript));
          }
          setVoiceStatus('idle');
          setVoiceTranscript('');
        }
      };
      recog.start();
      setVoiceStatus('recording');
      mediaRecorderRef.current = recog; // store for stop
      return;
    }
    // No Web Speech API — go directly to server ASR
    fallbackToServerASR();
  }, [voiceStatus, voiceTranscript]);

  const fallbackToServerASR = useCallback(async () => {
    setVoiceStatus('processing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const form = new FormData();
        form.append('file', blob, 'voice.webm');
        try {
          const res = await fetch('http://localhost:3001/api/asr', { method: 'POST', body: form });
          if (res.ok) {
            const data = await res.json();
            setInputValue((prev) => (prev ? prev + ' ' + data.text : data.text));
          } else {
            console.error('[Voice] ASR failed:', res.status, await res.text());
          }
        } catch (err) {
          console.error('[Voice] ASR fetch error:', err);
        }
        setVoiceStatus('idle');
        setVoiceTranscript('');
      };
      recorder.start();
      setVoiceStatus('recording');
      mediaRecorderRef.current = recorder;
      // Auto-stop after 30s
      setTimeout(() => stopVoiceRecording(), 30000);
    } catch (err) {
      console.error('[Voice] Mic access denied:', err);
      setVoiceStatus('idle');
    }
  }, []);

  const stopVoiceRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (mr instanceof MediaRecorder) {
      mr.stop();
    } else {
      // Web Speech API — stop recognition
      try { mr.stop(); } catch (_) {}
      const t = voiceTranscript;
      if (t) setInputValue((prev) => (prev ? prev + ' ' + t : t));
      setVoiceStatus('idle');
      setVoiceTranscript('');
    }
  }, [voiceTranscript]);

  const handleVoiceToggle = useCallback(() => {
    if (voiceStatus === 'idle') startVoiceRecording();
    else stopVoiceRecording();
  }, [voiceStatus, startVoiceRecording, stopVoiceRecording]);

  const allDisconnected = Object.values(agentStatuses).every((s) => s !== 'connected');

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="header-logo">
            <div className="logo-icon"><IconLogo /></div>
            <div>
              <div className="logo-text">OpenClaw</div>
              <div className="logo-sub">头脑风暴室</div>
            </div>
          </div>
          <div className="header-divider" />
          <div className="agent-status-bar">
            {AGENTS.map((agent) => (
              <AgentStatus
                key={agent.id}
                agentId={agent.id}
                status={agentStatuses[agent.id] || 'disconnected'}
                color={agent.color}
              />
            ))}
          </div>
        </div>
        <div className="header-right">
          {!connected && (
            <span style={{ fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Spin size="small" /> 重连中...
            </span>
          )}
          {allDisconnected && connected && (
            <span style={{ fontSize: 12, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconWarning size={13} /> 所有网关离线
            </span>
          )}
        </div>
      </header>

      {/* Messages */}
      <MessageList
        messages={messages}
        thinking={thinking}
        streamTexts={streamTexts}
        selectedTarget="all"
        messagesEndRef={messagesEndRef}
        onImageClick={(url) => setFullscreenImage(url)}
        onQuote={(quote) => setQuote(quote)}
      />

      {/* Fullscreen image viewer */}
      {fullscreenImage && (
        <div className="image-fullscreen-overlay" onClick={() => setFullscreenImage(null)}>
          <img
            src={fullscreenImage}
            alt="全屏预览"
            className="image-fullscreen-content"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="image-fullscreen-close"
            onClick={() => setFullscreenImage(null)}
            title="关闭"
          >
            <IconX size={20} />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="input-area">
        {/* Hidden file input for image upload */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          style={{ display: 'none' }}
        />

        {/* Main container with border */}
        <div className="input-container">
          {/* Quote pill — shown when quoting code */}
          {quote && (
            <div className="quote-pill">
              <span className="quote-pill-icon"><IconCornerDownLeft size={11} /></span>
              <span className="quote-pill-text">{quote.displayText}</span>
              <button
                className="quote-pill-close"
                onClick={() => setQuote(null)}
                title="取消引用"
              >
                <IconX size={10} />
              </button>
            </div>
          )}

          {/* Image card — shown when image attached */}
          {imageData && (
            <div className="image-card">
              <div className="image-card-content">
                <img src={imageData.url} alt="Preview" className="image-card-thumb" onClick={() => setFullscreenImage(imageData.url)} />
                <span className="image-card-name">{imageData.name}</span>
              </div>
              <button
                className="image-card-remove"
                onClick={handleImageRemove}
                title="移除图片"
              >
                <IconX size={12} />
              </button>
            </div>
          )}

          {/* Textarea */}
          <TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              voiceStatus === 'recording' ? '正在聆听...' :
              voiceStatus === 'processing' ? '识别中...' :
              imageData ? '描述一下这张图片...' : '向所有 Agent 发起广播讨论...'
            }
            autoSize={false}
            disabled={!connected}
            showCount={false}
            className="input-textarea"
          />

          {/* Bottom toolbar */}
          <div className="input-toolbar">
            {/* Left: upload + more tools */}
            <div className="toolbar-left">
              <button
                className="toolbar-btn"
                onClick={() => imageInputRef.current?.click()}
                disabled={!connected}
                title="上传图片"
              >
                <IconImage size={16} />
              </button>
            </div>

            {/* Right: mic + send */}
            <div className="toolbar-right">
              <button
                className={`toolbar-btn mic-btn ${voiceStatus === 'recording' ? 'recording' : ''} ${voiceStatus === 'processing' ? 'processing' : ''}`}
                onClick={handleVoiceToggle}
                disabled={!connected || voiceStatus === 'processing'}
                title={voiceStatus === 'idle' ? '开始语音输入' : '停止录音'}
              >
                {voiceStatus === 'recording' ? (
                  <IconMicOff size={16} />
                ) : voiceStatus === 'processing' ? (
                  <IconMic size={16} />
                ) : (
                  <IconMic size={16} />
                )}
              </button>
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={(!String(inputValue || '').trim() && !imageData) || !connected || sending}
                title="发送 (Enter)"
              >
                <IconSend size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
