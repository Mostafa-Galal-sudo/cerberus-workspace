import React from 'react';

interface MarkProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  glow?: boolean;
}

/**
 * CERBERUS Six-Headed Guardian Crest
 * Derived directly from the official graphite/charcoal master artwork (cerberus.jpeg).
 * Monochromatic Gothic × Dark Engraved Metal × Mythological Security.
 */
export function CerberusMark({ size = 36, glow = true, className = '', ...props }: MarkProps) {
  const filterId = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="CERBERUS Six-Headed Guardian Crest"
      className={`cerberus-mark ${glow ? 'has-glow' : ''} ${className}`}
      {...props}
    >
      <defs>
        <linearGradient id={`plate-${filterId}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#384252" />
          <stop offset="50%" stopColor="#1a2029" />
          <stop offset="100%" stopColor="#0b0e13" />
        </linearGradient>
        <radialGradient id={`glow-${filterId}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#cbd5e1" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#06080b" stopOpacity="0" />
        </radialGradient>
        <filter id={`shadow-${filterId}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.95" />
        </filter>
      </defs>

      {/* Atmospheric Chiaroscuro Aura */}
      <circle cx="32" cy="32" r="28" fill={`url(#glow-${filterId})`} />

      {/* Hexagonal Gothic Armor Shield Perimeter */}
      <polygon
        points="32,3 58,18 58,46 32,61 6,46 6,18"
        fill="#080a0d"
        stroke="#27303d"
        strokeWidth="1.5"
      />
      <polygon
        points="32,7 54,20 54,44 32,57 10,44 10,20"
        fill="none"
        stroke="#475569"
        strokeWidth="0.8"
        strokeOpacity="0.6"
        strokeDasharray="4 2"
      />

      <g filter={`url(#shadow-${filterId})`}>
        {/* Head 1: Rear Upper Left */}
        <path
          d="M16 23 L11 12 L18 16 L22 10 L24 19 L19 24 Z"
          fill={`url(#plate-${filterId})`}
          stroke="#94a3b8"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="17" r="1.1" fill="#e2e8f0" />
        <path d="M13 20 L17 22" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />

        {/* Head 2: Rear Upper Right */}
        <path
          d="M48 23 L53 12 L46 16 L42 10 L40 19 L45 24 Z"
          fill={`url(#plate-${filterId})`}
          stroke="#94a3b8"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <circle cx="48" cy="17" r="1.1" fill="#e2e8f0" />
        <path d="M51 20 L47 22" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />

        {/* Head 3: Rear Top Center Alpha */}
        <path
          d="M32 6 L27 15 L30 17 L26 22 L32 24 L38 22 L34 17 L37 15 Z"
          fill={`url(#plate-${filterId})`}
          stroke="#cbd5e1"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <circle cx="30" cy="17" r="1.2" fill="#ffffff" />
        <circle cx="34" cy="17" r="1.2" fill="#ffffff" />
        <path d="M29 21 L32 23 L35 21" stroke="#e2e8f0" strokeWidth="1" fill="none" strokeLinejoin="round" />

        {/* Intaglio neck cables & collar plates */}
        <path d="M22 26 Q32 32 42 26 L40 38 L32 44 L24 38 Z" fill="#12161e" stroke="#334155" strokeWidth="1" />
        {/* Forged iron chains across chest */}
        <path d="M19 31 Q24 35 32 36 Q40 35 45 31" fill="none" stroke="#64748b" strokeWidth="1" strokeDasharray="2,2" />

        {/* Head 4: Front Lower Left Striking Head */}
        <path
          d="M11 36 L7 28 L15 30 L19 35 L16 43 L10 41 Z"
          fill={`url(#plate-${filterId})`}
          stroke="#94a3b8"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="33" r="1.1" fill="#e2e8f0" />
        <path d="M9 37 L14 38" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />

        {/* Head 5: Front Lower Right Striking Head */}
        <path
          d="M53 36 L57 28 L49 30 L45 35 L48 43 L54 41 Z"
          fill={`url(#plate-${filterId})`}
          stroke="#94a3b8"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <circle cx="52" cy="33" r="1.1" fill="#e2e8f0" />
        <path d="M55 37 L50 38" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />

        {/* Head 6: Front Lower Center Sentinel */}
        <path
          d="M32 25 L25 33 L28 43 L32 51 L36 43 L39 33 Z"
          fill={`url(#plate-${filterId})`}
          stroke="#f8fafc"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M28 36 L32 40 L36 36" fill="#080a0e" stroke="#cbd5e1" strokeWidth="1" />
        <circle cx="28.5" cy="33" r="1.3" fill="#ffffff" />
        <circle cx="35.5" cy="33" r="1.3" fill="#ffffff" />
        <path d="M30 43 L32 47 L34 43" fill="none" stroke="#cbd5e1" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M29 40 L35 40" stroke="#f1f5f9" strokeWidth="1.2" strokeLinecap="round" />
      </g>

      {/* Sentinel Core Keystones */}
      <polygon points="32,54 34,57 32,60 30,57" fill="#cbd5e1" stroke="#334155" strokeWidth="0.5" />
    </svg>
  );
}

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSubtitle?: boolean;
  className?: string;
}

export function CerberusLogo({ size = 'md', showSubtitle = true, className = '' }: LogoProps) {
  const markSizes = { sm: 28, md: 36, lg: 46, xl: 64 };
  const markSize = markSizes[size];

  return (
    <div className={`cerberus-brand-lockup cerberus-brand-${size} ${className}`}>
      <CerberusMark size={markSize} />
      <div className="brand-text">
        <span className="brand-title">CERBERUS</span>
        {showSubtitle && <span className="brand-subtitle">SENTINEL WORKSPACE</span>}
      </div>
    </div>
  );
}

export function CerberusSentinelStatus({ className = '' }: { className?: string }) {
  return (
    <div className={`cerberus-sentinel-status ${className}`}>
      <span className="status-optic">
        <i className="optic-dot" />
        <i className="optic-ping" />
      </span>
      <div className="status-text">
        <strong>SENTINEL VIGILANT</strong>
        <small>Evidence-gated operations</small>
      </div>
    </div>
  );
}
