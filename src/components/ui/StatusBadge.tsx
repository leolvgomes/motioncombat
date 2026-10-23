export function StatusBadge({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return <span className={`status-badge ${active ? 'is-active' : ''}`}><span className="status-dot" />{children}</span>
}
