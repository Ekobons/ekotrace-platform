/** The product mark: an open ring (a carbon cycle) around a node, on the brand's accent tile. */
export function BrandMark({ size = 32, tone = 'lime' }: { size?: number; tone?: 'lime' | 'light' }) {
  const bg = tone === 'lime' ? 'var(--lime)' : '#FFFFFF', fg = 'var(--ink)';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-hidden="true" className="bmark">
      <rect width="32" height="32" rx="9" fill={bg} />
      <path d="M22.6 10.3A8.5 8.5 0 1 0 22.6 21.7" fill="none" stroke={fg} strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.1" fill={fg} />
      <circle cx="23.4" cy="16" r="1.7" fill={fg} opacity=".55" />
    </svg>);
}
