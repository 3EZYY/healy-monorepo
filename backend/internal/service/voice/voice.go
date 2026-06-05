// Package voice implements the HEALY 2-way AI voice assistant pipeline:
//
//	mic PCM (16k) ──> Groq Whisper (STT) ──> Gemini 2.5-flash (reason)
//	                                              │
//	         speaker PCM (24k) <── Gemini TTS (synthesize) <┘
//
// ── HONEST DESIGN NOTE ──────────────────────────────────────────────────
// The brief asked for "Gemini 3.5 Flash" doing reasoning + native audio in a
// single REST call. That model name does not exist, and on the *REST* API a
// single generateContent call with responseModalities:["AUDIO"] only works on
// the TTS-only models (gemini-2.5-flash-preview-tts) — those vocalize text but
// do not reason. True single-shot "native audio dialog" is the Live API (a
// bidirectional WebSocket, preview-only, tighter free quota).
//
// So this implementation uses the robust free-tier REST path: a 2-stage
// pipeline (reason with gemini-2.5-flash → speak with gemini-2.5-flash-preview-tts),
// hidden behind one Service.Process() call. responseModalities:["AUDIO"] is
// honored in the TTS stage. See gemini.go.
package voice

import (
	"context"
	"encoding/binary"
	"fmt"
	"net/http"
	"time"

	"github.com/rafif/healy-backend/internal/domain"
)

// Service orchestrates STT → reasoning → TTS.
type Service struct {
	groqKey    string
	geminiKey  string
	httpClient *http.Client
}

// Result is the outcome of one PTT turn.
type Result struct {
	Transcript string // what the user said (Groq)
	ReplyText  string // what HEALY answers, Indonesian (Gemini reason)
	ReplyPCM   []byte // 24 kHz 16-bit mono PCM to stream to the ESP32 (Gemini TTS)
}

// NewService wires API keys. A generous timeout covers the full STT+LLM+TTS turn.
func NewService(groqKey, geminiKey string) *Service {
	return &Service{
		groqKey:   groqKey,
		geminiKey: geminiKey,
		// Whisper + 2 Gemini calls can take several seconds on free tier.
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
}

// Enabled reports whether both upstream keys are configured.
func (s *Service) Enabled() bool {
	return s.groqKey != "" && s.geminiKey != ""
}

// Process runs the full turn for a captured PCM utterance plus live telemetry.
func (s *Service) Process(ctx context.Context, pcm []byte, telemetry domain.SensorData) (*Result, error) {
	if !s.Enabled() {
		return nil, fmt.Errorf("voice service disabled: missing GROQ_API_KEY or GEMINI_API_KEY")
	}
	if len(pcm) == 0 {
		return nil, fmt.Errorf("empty audio buffer")
	}

	// 1) STT — wrap raw PCM in a WAV container, send to Groq Whisper.
	transcript, err := s.transcribe(ctx, pcm)
	if err != nil {
		return nil, fmt.Errorf("stt: %w", err)
	}
	if transcript == "" {
		return nil, fmt.Errorf("stt produced empty transcript")
	}

	// 2) Reason — combine transcript + telemetry, get a concise Indonesian reply.
	replyText, err := s.reason(ctx, transcript, telemetry)
	if err != nil {
		return nil, fmt.Errorf("reason: %w", err)
	}

	// 3) TTS — Gemini native audio output (responseModalities: ["AUDIO"]).
	replyPCM, err := s.synthesize(ctx, replyText)
	if err != nil {
		return nil, fmt.Errorf("tts: %w", err)
	}

	return &Result{Transcript: transcript, ReplyText: replyText, ReplyPCM: replyPCM}, nil
}

// wavHeader builds the canonical 44-byte PCM WAV header.
// Groq Whisper needs a real container; the ESP32 streams headerless raw PCM.
func wavHeader(pcmLen, sampleRate, bitsPerSample, channels int) []byte {
	byteRate := sampleRate * channels * bitsPerSample / 8
	blockAlign := channels * bitsPerSample / 8
	dataLen := pcmLen
	riffLen := 36 + dataLen

	h := make([]byte, 44)
	copy(h[0:4], []byte("RIFF"))
	binary.LittleEndian.PutUint32(h[4:8], uint32(riffLen))
	copy(h[8:12], []byte("WAVE"))
	copy(h[12:16], []byte("fmt "))
	binary.LittleEndian.PutUint32(h[16:20], 16) // PCM fmt chunk size
	binary.LittleEndian.PutUint16(h[20:22], 1)  // audio format = PCM
	binary.LittleEndian.PutUint16(h[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(h[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(h[28:32], uint32(byteRate))
	binary.LittleEndian.PutUint16(h[32:34], uint16(blockAlign))
	binary.LittleEndian.PutUint16(h[34:36], uint16(bitsPerSample))
	copy(h[36:40], []byte("data"))
	binary.LittleEndian.PutUint32(h[40:44], uint32(dataLen))
	return h
}

// pcmToWAV prepends a 16 kHz / 16-bit / mono header to raw mic PCM.
func pcmToWAV(pcm []byte) []byte {
	header := wavHeader(len(pcm), 16000, 16, 1)
	out := make([]byte, 0, len(header)+len(pcm))
	out = append(out, header...)
	out = append(out, pcm...)
	return out
}
