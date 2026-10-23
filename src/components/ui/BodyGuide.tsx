export function BodyGuide({ subtle = false }: { subtle?: boolean }) {
  return <svg className={`body-guide ${subtle ? 'is-subtle' : ''}`} viewBox="0 0 360 390" fill="none" aria-hidden="true">
    <defs><linearGradient id="body-gradient" x1="180" y1="20" x2="180" y2="390" gradientUnits="userSpaceOnUse"><stop stopColor="#a7d2d8" stopOpacity=".48" /><stop offset="1" stopColor="#6f979d" stopOpacity=".04" /></linearGradient></defs>
    <path d="M151 99c-11-9-17-23-17-39 0-29 18-48 46-48s46 19 46 48c0 16-6 30-17 39l-4 22 42 16c14 5 25 17 30 32l26 83-29 12-29-70-10 93 18 102H107l18-102-10-93-29 70-29-12 26-83c5-15 16-27 30-32l42-16-4-22Z" fill="url(#body-gradient)" stroke="#87afb5" strokeOpacity=".2" />
    <path d="m153 119 27 21 27-21m-92 75 21-41 44 15 44-15 21 41m-109-41 8 132 36 20 36-20 8-132m-80 132h72m-36-117v137" stroke="#87afb5" strokeOpacity=".12" />
    <path d="M180 0v390M0 168h360M0 286h360" stroke="#73959d" strokeOpacity=".09" strokeDasharray="3 8" />
    <path d="M53 42V24h18m218 0h18v18M53 322v18h18m218 0h18v-18" stroke="#ff824e" strokeOpacity=".55" strokeWidth="1.5" />
  </svg>
}
