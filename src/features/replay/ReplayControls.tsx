import { ChevronDown, Pause, Play, RotateCcw, X } from 'lucide-react'
import { REPLAY_SPEEDS } from '../../engine/replay/replay'
import type { ReplaySpeed } from '../../engine/replay/replay'
import type { ReplayPlayback } from '../../stores/replay-store'
import { combatAudio } from '../audio/combat-audio'
import { matchRuntime } from '../combat/match-runtime'

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export function ReplayControls({ playback }: { playback: ReplayPlayback }) {
  const { time, duration, playing, speed } = playback
  const ended = !playing && time >= duration - 0.01
  const toggle = () => { combatAudio.unlock(); matchRuntime.toggleReplay() }
  return <div className="replay-controls" role="group" aria-label="Controles do replay">
    <button className="combat-primary-action" type="button" aria-keyshortcuts="P" onClick={toggle}>
      {playing ? <Pause size={14} aria-hidden="true" /> : ended ? <RotateCcw size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
      {playing ? 'Pausar' : ended ? 'Rever' : 'Reproduzir'}
    </button>
    <label className="replay-timeline"><span className="sr-only">Posição do replay</span>
      <input type="range" min={0} max={Math.max(0.1, duration)} step={0.1} value={Math.min(time, duration)}
        aria-valuetext={`${clock(time)} de ${clock(duration)}`} onChange={(event) => matchRuntime.seekReplay(event.target.valueAsNumber)} />
      <output aria-hidden="true">{clock(time)} / {clock(duration)}</output>
    </label>
    <label className="combat-quality-label" htmlFor="replay-speed">Velocidade</label>
    <div className="combat-quality-select"><select id="replay-speed" value={speed} onChange={(event) => matchRuntime.setReplaySpeed(Number(event.target.value) as ReplaySpeed)}>
      {REPLAY_SPEEDS.map((value) => <option key={value} value={value}>{String(value).replace('.', ',')}×</option>)}
    </select><ChevronDown size={13} aria-hidden="true" /></div>
    <button className="combat-secondary-action is-subtle" type="button" onClick={() => matchRuntime.stopReplay()}><X size={14} aria-hidden="true" />Sair do replay</button>
  </div>
}
