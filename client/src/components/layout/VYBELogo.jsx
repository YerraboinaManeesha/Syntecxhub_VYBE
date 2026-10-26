import { useId } from 'react';

/**
 * VYBE logo: a chat bubble whose interior carries an abstract "V".
 * `size` controls the icon; set `showWordmark={false}` for favicon-like uses.
 */
export default function VYBELogo({ size = 32, showWordmark = true, className = '' }) {
  const gradientId = useId();

  return (
    <span className={`vybe-logo ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3 }}>
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={showWordmark ? undefined : 'VYBE'} aria-hidden={showWordmark}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#F9A8D4" />
            <stop offset="1" stopColor="#E75480" />
          </linearGradient>
        </defs>
        <path
          d="M8 6h32a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H26l-9 7v-7H8a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z"
          fill={`url(#${gradientId})`}
        />
        <path d="M14 15l10 13 10-13" fill="none" stroke="#1C0A1A" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {showWordmark && (
        <span
          style={{
            fontSize: size * 0.62,
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: 'var(--color-text)',
            lineHeight: 1,
          }}
        >
          VYBE
        </span>
      )}
    </span>
  );
}
