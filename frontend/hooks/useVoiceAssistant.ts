// Push-to-Talk voice assistant hook (F-05).
//
// Opens a dedicated viewer WebSocket purely for the PTT control channel:
//   - sends {"event":"start_audio"} / {"event":"stop_audio"}
//   - receives {"event":"voice_state", state, transcript?, reply?} status updates
//
// The audio itself never reaches the browser — the ESP32 captures the mic and
// plays the TTS reply on its own speaker. This hook only drives the UI state
// machine and forwards the press/release commands.

import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceState = 'idle' | 'recording' | 'processing' | 'playing' | 'error'

interface VoiceStateMessage {
  event: 'voice_state'
  state: VoiceState
  transcript?: string
  reply?: string
  message?: string
}

const RECONNECT_DELAY_MS = 4000

function resolveViewerUrl(): string {
  const base = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws'
  return `${base}/viewer`
}

export function useVoiceAssistant() {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [connected, setConnected] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedByUserRef = useRef(false)

  // ── Connection lifecycle ──
  useEffect(() => {
    closedByUserRef.current = false

    const connect = () => {
      let socket: WebSocket
      try {
        socket = new WebSocket(resolveViewerUrl())
      } catch {
        reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
        return
      }
      wsRef.current = socket

      socket.onopen = () => setConnected(true)

      socket.onmessage = (event) => {
        // Backend may newline-coalesce queued text frames; parse each line.
        const lines = String(event.data).split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          let msg: unknown
          try {
            msg = JSON.parse(line)
          } catch {
            continue
          }
          const m = msg as Partial<VoiceStateMessage>
          if (m?.event !== 'voice_state' || !m.state) continue // ignore telemetry

          setVoiceState(m.state)
          if (m.transcript !== undefined) setTranscript(m.transcript)
          if (m.reply !== undefined) setReply(m.reply)
          if (m.state === 'error') setErrorMsg(m.message || 'Voice error')
          if (m.state === 'idle' || m.state === 'recording') setErrorMsg('')
        }
      }

      socket.onclose = () => {
        setConnected(false)
        if (!closedByUserRef.current) {
          reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }

      socket.onerror = () => socket.close()
    }

    connect()

    return () => {
      closedByUserRef.current = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [])

  const send = useCallback((event: 'start_audio' | 'stop_audio') => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify({ event }))
    return true
  }, [])

  // ── Speak arbitrary text on the device (Generate Insight → TTS) ──
  const speak = useCallback((text: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    const trimmed = text.trim()
    if (!trimmed) return false
    ws.send(JSON.stringify({ event: 'speak_text', text: trimmed }))
    setVoiceState('processing') // optimistic; server drives playing → idle
    return true
  }, [])

  // Allow decoupled components (e.g. AIInsightCard) to trigger TTS via a window
  // event, reusing this single WS connection instead of opening another.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string } | undefined
      if (detail?.text) speak(detail.text)
    }
    window.addEventListener('healy-speak', handler)
    return () => window.removeEventListener('healy-speak', handler)
  }, [speak])

  // ── Press / release (called by AIVoiceButton) ──
  const startRecording = useCallback(() => {
    // Guard: only start a fresh turn from idle/error.
    if (voiceState !== 'idle' && voiceState !== 'error') return
    if (send('start_audio')) {
      setTranscript('')
      setReply('')
      setErrorMsg('')
      setVoiceState('recording') // optimistic; server confirms
    }
  }, [voiceState, send])

  const stopRecording = useCallback(() => {
    if (voiceState !== 'recording') return
    send('stop_audio')
    // Server will drive processing → playing → idle.
    setVoiceState('processing')
  }, [voiceState, send])

  return {
    voiceState,
    connected,
    transcript,
    reply,
    errorMsg,
    startRecording,
    stopRecording,
    speak,
  }
}
