/**
 * OpenClaw Icons — minimal, refined, no emoji
 * All SVG, consistent stroke/fill style
 */

/* ── Logo Mark ──────────────────────────────────────────────── */
export function IconLogo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" aria-label="OpenClaw">
      {/* Claw-like chevron mark */}
      <path
        d="M7 22 L15 8 L23 22"
        stroke="#58a6ff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M10.5 18 L15 10.5 L19.5 18"
        stroke="#58a6ff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}

/* ── Agent Initial Icons — just the letter, colored ─────────── */
export function IconAlpha({ size = 13, color = '#818cf8' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Alpha">
      <text
        x="12" y="17"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="'JetBrains Mono', monospace"
        fill={color}
      >A</text>
    </svg>
  );
}

export function IconBeta({ size = 13, color = '#34d399' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Beta">
      <text
        x="12" y="17"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="'JetBrains Mono', monospace"
        fill={color}
      >B</text>
    </svg>
  );
}

export function IconGamma({ size = 13, color = '#fbbf24' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Gamma">
      <text
        x="12" y="17"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="'JetBrains Mono', monospace"
        fill={color}
      >G</text>
    </svg>
  );
}

export function IconDelta({ size = 13, color = '#f472b6' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Delta">
      <text
        x="12" y="17"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="'JetBrains Mono', monospace"
        fill={color}
      >D</text>
    </svg>
  );
}

/* ── Status ─────────────────────────────────────────────────── */
export function IconWarning({ size = 14, color = '#f85149' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Warning">
      <circle cx="12" cy="12" r="10" fill={color} opacity="0.15" />
      <path
        d="M12 7v5M12 16.5v.5"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Send Arrow ────────────────────────────────────────────── */
export function IconSend({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Send">
      <path
        d="M12 5v14M12 5L6 11M12 5l6 6"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Image Upload ─────────────────────────────────────────── */
export function IconImage({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Upload image">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke={color} strokeWidth="1.8" />
      <circle cx="8.5" cy="8.5" r="1.5" fill={color} />
      <polyline
        points="21 15 16 10 5 21"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Close / Remove ──────────────────────────────────────── */
export function IconX({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Remove">
      <path
        d="M18 6L6 18M6 6l12 12"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Microphone ─────────────────────────────────────────── */
export function IconMic({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Voice input">
      <rect x="9" y="2" width="6" height="11" rx="3" stroke={color} strokeWidth="1.8" />
      <path
        d="M5 11c0 3.866 3.134 7 7 7s7-3.134 7-7"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <line x1="12" y1="18" x2="12" y2="22" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="9" y1="22" x2="15" y2="22" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ── Microphone Off ─────────────────────────────────────── */
export function IconMicOff({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Voice input off">
      <line x1="2" y1="2" x2="22" y2="22" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <rect x="9" y="2" width="6" height="11" rx="3" stroke={color} strokeWidth="1.8" />
      <path
        d="M5 11c0 3.866 3.134 7 7 7s7-3.134 7-7"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <line x1="12" y1="18" x2="12" y2="22" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="9" y1="22" x2="15" y2="22" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ── Copy ───────────────────────────────────────────────── */
export function IconCopy({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Copy">
      <rect x="9" y="9" width="13" height="13" rx="2" stroke={color} strokeWidth="1.8" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ── Check ──────────────────────────────────────────────── */
export function IconCheck({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Check">
      <path d="M20 6L9 17l-5-5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Quote/Reference ─────────────────────────────────────── */
export function IconQuote({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Quote">
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ── Corner Down Left (Reply) ───────────────────────────── */
export function IconCornerDownLeft({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Reply">
      <polyline points="9 17 4 12 9 7" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ── Maximize/Fullscreen ─────────────────────────────────── */
export function IconMaximize({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Fullscreen">
      <polyline points="15 3 21 3 21 9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="9 21 3 21 3 15" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="21" y1="3" x2="14" y2="10" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="3" y1="21" x2="10" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

/* ── Minimize/Exit Fullscreen ─────────────────────────────── */
export function IconMinimize({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Exit fullscreen">
      <polyline points="4 14 10 14 10 20" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="20 10 14 10 14 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="10" y1="14" x2="3" y2="21" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="21" y1="3" x2="14" y2="10" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

/* ── Sun (Light mode) ─────────────────────────────────────── */
export function IconSun({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Light mode">
      <circle cx="12" cy="12" r="5" stroke={color} strokeWidth="2"/>
      <line x1="12" y1="1" x2="12" y2="3" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="12" y1="21" x2="12" y2="23" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="1" y1="12" x2="3" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="21" y1="12" x2="23" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

/* ── Moon (Dark mode) ─────────────────────────────────────── */
export function IconMoon({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Dark mode">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
