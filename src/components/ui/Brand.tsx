export function Brand({ compact = false }: { compact?: boolean }) {
  return <a href="#laboratorio" className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="STEEL SYNC — início do laboratório">
    <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M20 3 6 17h12l-6 12L27 13H15Z" /></svg></span>
    <span className="brand-name">STEEL<span>SYNC</span><small>MOTION COMBAT</small></span>
  </a>
}
