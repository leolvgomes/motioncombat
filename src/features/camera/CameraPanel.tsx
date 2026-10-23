import { useEffect, useRef, useState } from 'react'
import { Camera, Expand, LoaderCircle, LockKeyhole, ScanLine, Video, VideoOff } from 'lucide-react'
import { BodyGuide } from '../../components/ui/BodyGuide'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Toggle } from '../../components/ui/Toggle'
import { useLabStore } from '../../stores/lab-store'
import { useMotionTracking } from '../motion-tracking/use-motion-tracking'

const LOADING_COPY = {
  requesting: ['Aguardando sua permissão', 'Permita o acesso à webcam na janela do navegador.'],
  loading: ['Preparando o rastreamento', 'Carregando o modelo de visão computacional neste dispositivo.'],
  starting: ['Conectando à sua câmera', 'Aguarde as primeiras imagens da webcam.'],
} as const

function elapsedTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function CameraPanel() {
  const panelRef = useRef<HTMLElement>(null)
  const { videoRef, canvasRef, videoSize, start, stop } = useMotionTracking()
  const session = useLabStore((state) => state.session)
  const metrics = useLabStore((state) => state.metrics)
  const pose = useLabStore((state) => state.pose)
  const resolution = useLabStore((state) => state.resolution)
  const showSkeleton = useLabStore((state) => state.showSkeleton)
  const mirrored = useLabStore((state) => state.mirrored)
  const showGuide = useLabStore((state) => state.showGuide)
  const toggleSkeleton = useLabStore((state) => state.toggleSkeleton)
  const toggleMirror = useLabStore((state) => state.toggleMirror)
  const [fullscreenSupported, setFullscreenSupported] = useState(false)
  const [fullscreenError, setFullscreenError] = useState<string | null>(null)
  const running = session.status === 'running'
  const loading = session.status === 'requesting' || session.status === 'loading' || session.status === 'starting'
  const active = running || loading
  const tracking = running && pose?.status === 'tracking'
  const loadingCopy = loading ? LOADING_COPY[session.status as keyof typeof LOADING_COPY] : null

  useEffect(() => {
    setFullscreenSupported(Boolean(document.fullscreenEnabled && panelRef.current?.requestFullscreen))
  }, [])

  const toggleFullscreen = async () => {
    setFullscreenError(null)
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await panelRef.current?.requestFullscreen()
    } catch {
      setFullscreenError('O navegador não permitiu a tela cheia. Você pode continuar no modo de janela.')
    }
  }

  const framingTip = !running
    ? 'Posicione-se de frente, com braços e cintura visíveis.'
    : pose?.framing === 'ready'
      ? 'Enquadramento pronto. Movimente os braços livremente.'
      : pose?.framing === 'too-close'
        ? 'Afaste-se um pouco para manter os braços no enquadramento.'
        : pose?.framing === 'off-center'
          ? 'Mova-se para o centro da imagem.'
          : 'Mantenha ombros, cotovelos e punhos visíveis e boa iluminação.'

  return <section className="camera-panel" ref={panelRef} aria-labelledby="camera-title">
    <div className="panel-heading">
      <div>
        <span className="panel-eyebrow"><Camera size={13} aria-hidden="true" />CAPTURA DE MOVIMENTO</span>
        <h2 className="panel-title" id="camera-title">Sua câmera</h2>
      </div>
      <StatusBadge active={tracking}>{tracking ? 'Rastreamento ativo' : running ? 'Buscando corpo' : loading ? 'Conectando' : 'Rastreamento inativo'}</StatusBadge>
    </div>

    <div className={`camera-stage ${running ? 'is-running' : ''}`}>
      <div className="camera-viewport" style={{ aspectRatio: running ? `${videoSize.width} / ${videoSize.height}` : '16 / 9' }}>
        <video ref={videoRef} className={`camera-video ${mirrored ? 'is-mirrored' : ''}`} muted playsInline aria-label="Imagem ao vivo da sua webcam" style={{ visibility: running ? 'visible' : 'hidden' }} />
        <canvas ref={canvasRef} className={`pose-overlay ${mirrored ? 'is-mirrored' : ''}`} aria-hidden="true" />
        {!running && <div className="stage-grid" aria-hidden="true" />}
        <div className="stage-corner tl" aria-hidden="true" /><div className="stage-corner tr" aria-hidden="true" />
        <div className="stage-corner bl" aria-hidden="true" /><div className="stage-corner br" aria-hidden="true" />
        <div className="stage-ruler" aria-hidden="true"><span>00</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
        <span className="stage-label"><span className={running ? 'status-dot is-active' : 'status-dot'} />{running ? 'LIVE INPUT' : 'CAMERA FEED'}<span>01</span></span>
        <button className="fullscreen-button" type="button" onClick={() => { void toggleFullscreen() }} disabled={!fullscreenSupported} aria-label="Alternar tela cheia da câmera" title={fullscreenSupported ? 'Alternar tela cheia' : 'Tela cheia indisponível neste navegador'}><Expand size={16} aria-hidden="true" /></button>

        {!running && !loading && <div className="camera-offline">
          <BodyGuide />
          <div><span className="offline-icon"><VideoOff size={20} aria-hidden="true" /></span><h3>Câmera desconectada</h3><p>Ative a webcam para conectar seus movimentos.</p></div>
        </div>}
        {loadingCopy && <div className="camera-loading" role="status"><LoaderCircle className="spinning" size={30} aria-hidden="true" /><h3>{loadingCopy[0]}</h3><p>{loadingCopy[1]}</p></div>}
        {running && showGuide && <div className="framing-guide" aria-hidden="true"><span className="framing-guide-label">CINTURA PARA CIMA</span></div>}
        <div className="stage-tip"><ScanLine size={14} aria-hidden="true" /><span>{framingTip}</span></div>
        <span className="stage-resolution">{running && metrics ? metrics.resolution : `${resolution} · 30 FPS ALVO`}</span>
      </div>
    </div>

    {(session.error || fullscreenError) && <div className="camera-error" role="alert">{session.error || fullscreenError}</div>}
    <div className="camera-controls">
      <button className={`camera-primary ${active ? 'is-stop' : ''}`} type="button" onClick={active ? stop : start}>
        {active ? <VideoOff size={18} aria-hidden="true" /> : <Video size={18} aria-hidden="true" />}
        {loading ? 'Cancelar conexão' : running ? 'Desligar câmera' : 'Iniciar câmera'}
      </button>
      <span className="session-clock"><span className={running ? 'status-dot is-active' : 'status-dot'} />{running ? elapsedTime(metrics?.elapsedSeconds ?? 0) : '00:00'}<span>SESSÃO LOCAL</span></span>
      <div className="camera-toggles"><Toggle label="Exibir esqueleto" checked={showSkeleton} onChange={toggleSkeleton} /><Toggle label="Espelhar vídeo" checked={mirrored} onChange={toggleMirror} /></div>
    </div>
    <div className="camera-privacy"><LockKeyhole size={12} aria-hidden="true" /><span>Sua câmera é processada neste dispositivo. Nenhuma imagem é enviada ou gravada.</span></div>
  </section>
}
