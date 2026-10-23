interface ToggleProps { label: string; checked: boolean; onChange: () => void }

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return <button className="toggle-row" type="button" role="switch" aria-checked={checked} onClick={onChange}>
    <span>{label}</span><span className={`toggle ${checked ? 'is-on' : ''}`} aria-hidden="true"><span /></span>
  </button>
}
