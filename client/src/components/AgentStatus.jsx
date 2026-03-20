const AGENT_NAMES = {
  alpha: '总架构师',
  beta:  '代码工匠',
  gamma: '质量守门员',
  delta: '运维大脑',
};

export default function AgentStatus({ agentId, status, color }) {
  return (
    <div className="agent-status-pill">
      <span className={`status-dot ${status}`} />
      <span className={`agent-pill-name ${agentId}`}>
        {agentId.toUpperCase()}
      </span>
      <span className="agent-pill-title">{AGENT_NAMES[agentId]}</span>
    </div>
  );
}
