// src/components/features/AIChatPanel.tsx — NEW v4.0.0
'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Bot, Send, Loader2, Trash2, AlertTriangle, Mic, MicOff
} from 'lucide-react'
import { ChatMessage, ChatContext } from '@/types/chat'
import { callGroqSTT, getStoredGroqKey } from '@/lib/groq-client'

interface AIChatPanelProps {
  isOpen:       boolean
  onClose:      () => void
  messages:     ChatMessage[]
  isLoading:    boolean
  inputValue:   string
  onInputChange:(value: string) => void
  onSend:       (input: string) => void
  onClear:      () => void
  context:      ChatContext | null  // Data sensor saat ini
}

export function AIChatPanel({
  isOpen, onClose, messages, isLoading,
  inputValue, onInputChange, onSend, onClear, context
}: AIChatPanelProps) {
  const messagesEndRef      = useRef<HTMLDivElement>(null)
  const mediaRecorderRef    = useRef<MediaRecorder | null>(null)
  const audioChunksRef      = useRef<Blob[]>([])
  const lastSpokenIdRef     = useRef<string | null>(null)
  const [isRecording, setIsRecording]       = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [micError, setMicError]             = useState<string | null>(null)

  // Auto-scroll ke pesan terbaru
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-bacakan setiap pesan AI yang selesai streaming via Web Speech API.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const lastAI = [...messages].reverse().find(m => m.role === 'assistant' && !m.isError)
    if (!lastAI || lastAI.isStreaming || !lastAI.content.trim()) return
    if (lastAI.id === lastSpokenIdRef.current) return

    lastSpokenIdRef.current = lastAI.id
    window.speechSynthesis.cancel()

    const utter = new SpeechSynthesisUtterance(lastAI.content)
    utter.lang  = 'id-ID'
    utter.rate  = 1.05
    utter.pitch = 1.0
    window.speechSynthesis.speak(utter)
  }, [messages])

  // Hentikan speech saat panel ditutup.
  useEffect(() => {
    if (!isOpen && typeof window !== 'undefined') window.speechSynthesis?.cancel()
  }, [isOpen])

  const handleSend = () => {
    if (!inputValue.trim() || isLoading) return
    onSend(inputValue)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  const startRecording = async () => {
    setMicError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg'
      const mr = new MediaRecorder(stream, { mimeType })
      audioChunksRef.current = []

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        if (blob.size < 1000) return // terlalu pendek, skip

        setIsTranscribing(true)
        try {
          const apiKey = getStoredGroqKey()
          if (!apiKey) throw new Error('Groq API Key belum diisi di sidebar')
          const text = await callGroqSTT(blob, apiKey)
          if (text) {
            onInputChange(text)
            // Auto-submit setelah transkripsi
            onSend(text)
          }
        } catch (err) {
          setMicError(err instanceof Error ? err.message : 'Transkripsi gagal')
        } finally {
          setIsTranscribing(false)
        }
      }

      mr.start()
      mediaRecorderRef.current = mr
      setIsRecording(true)
    } catch (err) {
      setMicError('Akses mikrofon ditolak atau tidak tersedia')
      console.error('Mic error:', err)
    }
  }

  const handleMicClick = () => {
    if (isRecording) stopRecording()
    else startRecording()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
          />

          {/* Sliding Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-96 max-w-full
                       bg-healy-surface border-l border-healy-border
                       shadow-2xl z-50 flex flex-col"
          >
            {/* Header Panel */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-healy-border">
              <div className="flex items-center gap-2">
                <Bot size={18} className="text-healy-ai-accent" />
                <span className="font-display font-semibold text-sm text-healy-graphite">
                  HEALY AI Chat
                </span>
                <span className="text-xs bg-healy-ai-accent/15 text-healy-ai-accent
                                 px-2 py-0.5 rounded-full font-mono">
                  Groq
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={onClear}
                  title="Hapus riwayat chat"
                  className="p-1.5 rounded-lg text-healy-slate hover:text-healy-critical
                             hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-healy-slate hover:text-healy-graphite
                             hover:bg-healy-bg-alt transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Context Badge — tampilkan data sensor aktif */}
            {context && (
              <div className="px-4 py-2 bg-healy-bg-alt border-b border-healy-border">
                <p className="text-xs text-healy-slate font-mono">
                  Konteks: {context.temperature}°C · {context.bpm} bpm · SpO2 {context.spo2}%
                  <span className={`ml-2 font-semibold ${
                    context.overallStatus === 'CRITICAL' ? 'text-healy-critical' :
                    context.overallStatus === 'WARNING'  ? 'text-healy-warning'  :
                    'text-healy-sage'
                  }`}>
                    [{context.overallStatus}]
                  </span>
                </p>
              </div>
            )}

            {!context && (
              <div className="px-4 py-2 bg-healy-bg-alt border-b border-healy-border flex items-center gap-2">
                <AlertTriangle size={12} className="text-healy-warning" />
                <p className="text-xs text-healy-slate">
                  Perangkat offline — AI menjawab tanpa data real-time
                </p>
              </div>
            )}

            {/* Message List */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="text-center py-8 space-y-2">
                  <Bot size={32} className="mx-auto text-healy-ai-accent opacity-50" />
                  <p className="text-xs text-healy-slate">
                    Tanyakan kondisi kesehatan pasien, interpretasi data, atau rekomendasi tindakan.
                  </p>
                </div>
              )}

              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-healy-sage text-white rounded-br-sm'
                      : msg.isError
                        ? 'bg-red-50 dark:bg-red-950 text-healy-critical border border-healy-critical/20 rounded-bl-sm'
                        : 'bg-healy-bg-alt text-healy-graphite border border-healy-border rounded-bl-sm'
                  }`}>
                    <p className="font-body whitespace-pre-wrap">{msg.content}</p>
                    {msg.isStreaming && (
                      <span className="inline-block w-1 h-3 bg-healy-ai-accent ml-0.5 animate-pulse" />
                    )}
                  </div>
                </div>
              ))}

              {isLoading && messages[messages.length - 1]?.content === '' && (
                <div className="flex justify-start">
                  <div className="bg-healy-bg-alt border border-healy-border rounded-2xl
                                  rounded-bl-sm px-3 py-2">
                    <Loader2 size={14} className="animate-spin text-healy-ai-accent" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="px-4 py-3 border-t border-healy-border">
              {micError && (
                <p className="text-[10px] text-healy-critical mb-1.5 flex items-center gap-1">
                  <AlertTriangle size={10} /> {micError}
                </p>
              )}
              <div className="flex gap-2">
                <textarea
                  value={inputValue}
                  onChange={e => onInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isTranscribing ? 'Sedang mentranskrip...' : isRecording ? 'Merekam... (klik mic untuk berhenti)' : 'Tanya tentang kondisi pasien...'}
                  rows={2}
                  disabled={isRecording || isTranscribing}
                  className="flex-1 text-xs font-body resize-none px-3 py-2 rounded-xl
                             border border-healy-border bg-healy-bg
                             text-healy-graphite placeholder:text-healy-slate
                             focus:outline-none focus:ring-2 focus:ring-healy-ai-accent/30
                             focus:border-healy-ai-accent transition-all
                             disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="flex flex-col gap-1.5 self-end">
                  {/* Mic Button */}
                  <button
                    onClick={handleMicClick}
                    disabled={isLoading || isTranscribing}
                    title={isRecording ? 'Stop rekaman' : 'Mulai rekam suara'}
                    className={`p-2.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                      ${isRecording
                        ? 'bg-healy-critical text-white animate-pulse'
                        : isTranscribing
                          ? 'bg-healy-warning/20 text-healy-warning'
                          : 'bg-healy-bg-alt text-healy-ai-accent border border-healy-border hover:bg-healy-ai-accent/10'
                      }`}
                  >
                    {isTranscribing
                      ? <Loader2 size={16} className="animate-spin" />
                      : isRecording
                        ? <MicOff size={16} />
                        : <Mic size={16} />
                    }
                  </button>
                  {/* Send Button */}
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isLoading || isRecording || isTranscribing}
                    className="p-2.5 rounded-xl bg-healy-ai-accent text-white
                               disabled:opacity-40 disabled:cursor-not-allowed
                               hover:bg-teal-700 transition-colors"
                  >
                    {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
              </div>
              <p className="text-xs text-healy-slate mt-1.5 text-center">
                Enter untuk kirim · Shift+Enter baris baru · Mic untuk suara
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
