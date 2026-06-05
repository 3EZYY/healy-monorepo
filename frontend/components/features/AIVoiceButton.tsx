'use client'

// F-05 — Push-to-Talk AI Voice Assistant button.
//
// Press & hold to record (onMouseDown/onTouchStart -> start_audio),
// release to send (onMouseUp/onTouchEnd -> stop_audio). The ESP32 captures the
// mic and plays the spoken reply; this widget only reflects the 4 PTT states.

import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Loader2, Volume2, MicOff } from 'lucide-react'
import { useVoiceAssistant, type VoiceState } from '@/hooks/useVoiceAssistant'

// Per-state visual config.
const STATE_STYLES: Record<VoiceState, { ring: string; bg: string; label: string }> = {
  idle:       { ring: 'ring-healy-ai-accent/30', bg: 'bg-healy-ai-accent',  label: 'Hold to talk' },
  recording:  { ring: 'ring-healy-critical/40',  bg: 'bg-healy-critical',   label: 'Listening…' },
  processing: { ring: 'ring-healy-warning/40',   bg: 'bg-healy-warning',    label: 'Thinking…' },
  playing:    { ring: 'ring-healy-sage/40',      bg: 'bg-healy-sage',       label: 'Speaking…' },
  error:      { ring: 'ring-healy-critical/40',  bg: 'bg-healy-critical',   label: 'Error' },
}

// Animated equalizer bars for the "playing" state.
function PlayingWaves() {
  return (
    <div className="flex items-center gap-[3px] h-6">
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-white"
          animate={{ height: ['30%', '100%', '30%'] }}
          transition={{ duration: 0.7, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
        />
      ))}
    </div>
  )
}

export function AIVoiceButton() {
  const {
    voiceState, connected, transcript, reply, errorMsg,
    startRecording, stopRecording,
  } = useVoiceAssistant()

  const disabled = !connected || voiceState === 'processing' || voiceState === 'playing'
  const style = STATE_STYLES[voiceState]

  // Release also fires on pointer-leave so dragging off the button cancels cleanly.
  const handlePress = () => { if (connected) startRecording() }
  const handleRelease = () => { if (voiceState === 'recording') stopRecording() }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Caption bubble */}
      <AnimatePresence>
        {(transcript || reply || errorMsg || voiceState !== 'idle') && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            className="max-w-xs glass-card px-4 py-3 shadow-lg"
          >
            <p className="text-[11px] font-mono uppercase tracking-wide text-healy-slate mb-1">
              {connected ? style.label : 'Device offline'}
            </p>
            {errorMsg && <p className="text-xs text-healy-critical font-body">{errorMsg}</p>}
            {transcript && (
              <p className="text-xs text-healy-graphite font-body">
                <span className="text-healy-slate">You:</span> {transcript}
              </p>
            )}
            {reply && (
              <p className="text-xs text-healy-graphite font-body mt-1">
                <span className="text-healy-ai-accent font-semibold">HEALY:</span> {reply}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The button */}
      <motion.button
        type="button"
        aria-label="Push to talk to HEALY assistant"
        disabled={disabled}
        onMouseDown={handlePress}
        onMouseUp={handleRelease}
        onMouseLeave={handleRelease}
        onTouchStart={(e) => { e.preventDefault(); handlePress() }}
        onTouchEnd={(e) => { e.preventDefault(); handleRelease() }}
        animate={voiceState === 'recording' ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={voiceState === 'recording'
          ? { duration: 1, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.2 }}
        className={`
          relative w-16 h-16 rounded-full flex items-center justify-center
          text-white shadow-glow ring-4 ${style.ring} ${style.bg}
          transition-colors duration-200
          ${disabled && !connected ? 'opacity-40 cursor-not-allowed' : ''}
          ${disabled && connected ? 'cursor-wait' : 'cursor-pointer'}
          select-none touch-none
        `}
      >
        {/* Pulsating halo while recording */}
        {voiceState === 'recording' && (
          <motion.span
            className="absolute inset-0 rounded-full bg-healy-critical"
            animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
          />
        )}

        <span className="relative z-10">
          {!connected && <MicOff className="w-6 h-6" />}
          {connected && voiceState === 'idle' && <Mic className="w-6 h-6" />}
          {connected && voiceState === 'recording' && <Mic className="w-6 h-6" />}
          {connected && voiceState === 'processing' && <Loader2 className="w-6 h-6 animate-spin" />}
          {connected && voiceState === 'playing' && <PlayingWaves />}
          {connected && voiceState === 'error' && <Volume2 className="w-6 h-6" />}
        </span>
      </motion.button>
    </div>
  )
}

export default AIVoiceButton
