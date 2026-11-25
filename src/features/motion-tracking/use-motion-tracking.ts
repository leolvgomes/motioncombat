import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersWorker, useLabStore } from '../../stores/lab-store'
import type { ProcessedPose } from '../../types/motion'
import { drawPose } from './draw-pose'
import { createPoseBackend } from './pose-backend'
import { TrackingSession } from './tracking-session'
import { publishPose, setPoseAspectRatio } from './pose-stream'
import { useRobotStore } from '../../stores/robot-store'
import { framePacer } from '../robot/frame-pacing'
import { trialRuntime } from '../trials/trial-runtime'
import { combatMotionRuntime } from './combat-motion-runtime'

export function useMotionTracking() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<TrackingSession | null>(null)
  const poseRef = useRef<ProcessedPose | null>(null)
  const [videoSize, setVideoSize] = useState({ width: 1280, height: 720 })
  const running = useLabStore((state) => state.session.status === 'running')
  const robotMode = useRobotStore((state) => state.mode)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const session = new TrackingSession(video, {
      onState: (state) => {
        useLabStore.getState().setSession(state)
        if (state.status !== 'running') {
          combatMotionRuntime.reset()
          trialRuntime.onSessionEnded()
          framePacer.reset()
        }
      },
      onFrame: (frame) => trialRuntime.onFrame(frame),
      onPose: (pose) => {
        poseRef.current = pose
        publishPose(pose)
        combatMotionRuntime.process(pose)
      },
      onMetrics: (metrics) => {
        const store = useLabStore.getState()
        if (store.session.status !== 'running') return
        if (metrics.threaded) framePacer.observe(metrics.latencyMs)
        trialRuntime.onMetrics(metrics)
        const pose = poseRef.current
        store.setDiagnostics(metrics, pose ? {
          confidence: pose.confidence,
          visibleCount: pose.visibleCount,
          upperBodyVisibleCount: pose.upperBodyVisibleCount,
          status: pose.status,
          framing: pose.framing,
          visibility: pose.landmarks.map((point) => point.visibility),
        } : null)
        combatMotionRuntime.publish()
      },
    }, {
      createBackend: () => {
        const { trackingThread, gpu } = useLabStore.getState()
        return createPoseBackend(prefersWorker(trackingThread, gpu))
      },
    })
    sessionRef.current = session
    const unsubscribe = combatMotionRuntime.subscribe((event) => trialRuntime.onGesture(event))
    const updateDimensions = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setPoseAspectRatio(video.videoWidth / video.videoHeight)
        setVideoSize({ width: video.videoWidth, height: video.videoHeight })
      }
    }
    video.addEventListener('loadedmetadata', updateDimensions)
    video.addEventListener('resize', updateDimensions)
    return () => {
      session.stop()
      unsubscribe()
      sessionRef.current = null
      video.removeEventListener('loadedmetadata', updateDimensions)
      video.removeEventListener('resize', updateDimensions)
    }
  }, [])

  useEffect(() => {
    // The explicit demo source never leaves a webcam session capturing in the background.
    if (robotMode === 'demo') sessionRef.current?.stop()
  }, [robotMode])

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !video || !context) return
    if (!running) {
      context.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    let frame = 0
    let drawn: ProcessedPose | null | undefined
    const render = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          drawn = undefined
        }
        const pose = useLabStore.getState().showSkeleton ? poseRef.current : null
        // Poses arrive slower than display frames; repainting an identical overlay is pure cost.
        if (pose !== drawn) {
          drawn = pose
          drawPose(context, pose, canvas.width, canvas.height)
        }
      }
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame)
      context.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [running])

  const start = useCallback(() => {
    useRobotStore.getState().setMode('tracking')
    void sessionRef.current?.start(useLabStore.getState().resolution)
  }, [])
  const stop = useCallback(() => { sessionRef.current?.stop() }, [])

  return { videoRef, canvasRef, videoSize, start, stop }
}
