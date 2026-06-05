package websocket

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rafif/healy-backend/internal/domain"
	"github.com/rafif/healy-backend/internal/service/voice"
	"github.com/rafif/healy-backend/internal/usecase"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = 54 * time.Second

	// Maximum message size allowed from peer. Raised from 1024 to accommodate
	// 1 KB binary mic frames plus framing headroom (telemetry JSON is tiny).
	maxMessageSize = 8192

	// PCM downlink chunk size streamed to the ESP32 speaker.
	ttsChunkBytes = 2048
)

var (
	newline = []byte{'\n'}
	space   = []byte{' '}
)

// controlEvent is the PTT command/status envelope: {"event":"start_audio"}.
type controlEvent struct {
	Event string `json:"event"`
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	hub *Hub

	// The websocket connection.
	conn *websocket.Conn

	// Buffered channel of outbound TEXT messages (telemetry, system, status).
	send chan []byte

	// Buffered channel of outbound BINARY messages (TTS PCM to the ESP32).
	// Kept separate from `send` because WritePump newline-joins text frames,
	// which would corrupt binary audio.
	sendBinary chan []byte

	// Is this a device client or viewer client
	IsDevice bool
	DeviceID string

	// Usecase for processing incoming telemetry (only used by device clients)
	TelemetryUsecase usecase.TelemetryUsecase

	// Voice assistant pipeline (STT → reason → TTS).
	Voice *voice.Service

	// ── Device-only audio session state (mutex-protected; touched by both the
	// device ReadPump and a viewer's PTT goroutine) ──
	audioMu    sync.Mutex
	audioBuf   bytes.Buffer
	recording  bool
	lastSensor domain.SensorData
}

// ── Audio session helpers (device clients) ──────────────────────────────

func (c *Client) StartRecording() {
	c.audioMu.Lock()
	c.audioBuf.Reset()
	c.recording = true
	c.audioMu.Unlock()
}

func (c *Client) StopRecording() {
	c.audioMu.Lock()
	c.recording = false
	c.audioMu.Unlock()
}

// AppendAudio buffers an incoming binary mic frame, but only while recording.
func (c *Client) AppendAudio(frame []byte) {
	c.audioMu.Lock()
	if c.recording {
		c.audioBuf.Write(frame)
	}
	c.audioMu.Unlock()
}

// DrainAudio returns a copy of the captured PCM and clears the buffer.
func (c *Client) DrainAudio() []byte {
	c.audioMu.Lock()
	defer c.audioMu.Unlock()
	out := make([]byte, c.audioBuf.Len())
	copy(out, c.audioBuf.Bytes())
	c.audioBuf.Reset()
	return out
}

func (c *Client) SetSensor(s domain.SensorData) {
	c.audioMu.Lock()
	c.lastSensor = s
	c.audioMu.Unlock()
}

func (c *Client) GetSensor() domain.SensorData {
	c.audioMu.Lock()
	defer c.audioMu.Unlock()
	return c.lastSensor
}

// ── Safe senders (recover from sends on a closed/full channel) ───────────

func trySendText(ch chan []byte, data []byte) {
	defer func() { _ = recover() }() // channel may be closed on disconnect
	select {
	case ch <- data:
	default: // drop rather than block the caller
	}
}

func (c *Client) sendJSON(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	trySendText(c.send, data)
}

// ── ReadPump ─────────────────────────────────────────────────────────────

func (c *Client) ReadPump() {
	defer func() {
		if c.IsDevice {
			c.hub.UnregisterDevice <- c
		} else {
			c.hub.UnregisterViewer <- c
		}
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	for {
		msgType, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		if c.IsDevice {
			c.handleDeviceMessage(msgType, message)
		} else {
			c.handleViewerMessage(msgType, message)
		}
	}
}

// handleDeviceMessage routes ESP32 traffic: binary = mic PCM, text = telemetry.
func (c *Client) handleDeviceMessage(msgType int, message []byte) {
	if msgType == websocket.BinaryMessage {
		c.AppendAudio(message) // buffered only while a PTT session is active
		return
	}

	// Text → telemetry JSON.
	message = bytes.TrimSpace(bytes.Replace(message, newline, space, -1))

	if c.TelemetryUsecase != nil {
		var payload domain.TelemetryPayload
		if err := json.Unmarshal(message, &payload); err != nil {
			log.Printf("error unmarshaling payload: %v", err)
			return
		}
		payload.DeviceID = c.DeviceID // prevent spoofing

		// Capture latest sensor values for the voice assistant context.
		// Tolerant: also accept the firmware's flat {"temp","bpm","spo2"} shape.
		c.SetSensor(extractSensor(message, payload.Sensor))

		if err := c.TelemetryUsecase.ProcessIncoming(context.Background(), payload); err != nil {
			log.Printf("error processing payload: %v", err)
		}
	}
}

// handleViewerMessage processes PTT control commands from the frontend.
func (c *Client) handleViewerMessage(msgType int, message []byte) {
	if msgType != websocket.TextMessage {
		return
	}
	var ev controlEvent
	if err := json.Unmarshal(message, &ev); err != nil {
		return // not a control event; viewers send nothing else
	}

	switch ev.Event {
	case "start_audio":
		dev := c.hub.CurrentDevice()
		if dev == nil {
			c.sendJSON(map[string]string{"event": "voice_state", "state": "error", "message": "device offline"})
			return
		}
		dev.StartRecording()
		trySendText(dev.send, []byte(`{"event":"start_audio"}`)) // ESP32 mic ON
		c.sendJSON(map[string]string{"event": "voice_state", "state": "recording"})

	case "stop_audio":
		dev := c.hub.CurrentDevice()
		if dev == nil {
			c.sendJSON(map[string]string{"event": "voice_state", "state": "error", "message": "device offline"})
			return
		}
		trySendText(dev.send, []byte(`{"event":"stop_audio"}`)) // ESP32 mic OFF
		dev.StopRecording()
		c.sendJSON(map[string]string{"event": "voice_state", "state": "processing"})
		// Run STT→LLM→TTS off the read loop; status flows back to this viewer.
		go c.processVoiceTurn(dev)
	}
}

// processVoiceTurn runs the full pipeline and streams the reply to the device.
// `c` is the initiating viewer (receives status); `dev` is the ESP32.
func (c *Client) processVoiceTurn(dev *Client) {
	if c.Voice == nil || !c.Voice.Enabled() {
		c.sendJSON(map[string]string{"event": "voice_state", "state": "error", "message": "voice service not configured"})
		c.sendJSON(map[string]string{"event": "voice_state", "state": "idle"})
		return
	}

	pcm := dev.DrainAudio()
	if len(pcm) == 0 {
		c.sendJSON(map[string]string{"event": "voice_state", "state": "error", "message": "no audio captured"})
		c.sendJSON(map[string]string{"event": "voice_state", "state": "idle"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	res, err := c.Voice.Process(ctx, pcm, dev.GetSensor())
	if err != nil {
		log.Printf("voice pipeline error: %v", err)
		c.sendJSON(map[string]string{"event": "voice_state", "state": "error", "message": err.Error()})
		c.sendJSON(map[string]string{"event": "voice_state", "state": "idle"})
		return
	}

	// Tell the viewer we're about to play, with transcript + reply for the UI.
	c.sendJSON(map[string]string{
		"event":      "voice_state",
		"state":      "playing",
		"transcript": res.Transcript,
		"reply":      res.ReplyText,
	})

	// Stream the 24 kHz PCM to the ESP32 speaker in fixed chunks.
	streamPCMToDevice(dev, res.ReplyPCM)

	c.sendJSON(map[string]string{"event": "voice_state", "state": "idle"})
}

// streamPCMToDevice pushes TTS PCM as binary frames to the device WritePump.
func streamPCMToDevice(dev *Client, pcm []byte) {
	defer func() { _ = recover() }() // dev.sendBinary may close mid-stream
	for off := 0; off < len(pcm); off += ttsChunkBytes {
		end := off + ttsChunkBytes
		if end > len(pcm) {
			end = len(pcm)
		}
		frame := make([]byte, end-off)
		copy(frame, pcm[off:end])
		dev.sendBinary <- frame // blocks under backpressure (applies flow control)
	}
}

// ── WritePump ──────────────────────────────────────────────────────────────

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued text messages to the current websocket message.
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write(newline)
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case frame, ok := <-c.sendBinary:
			if !ok {
				return
			}
			// One binary frame per WS message — never coalesced (would corrupt PCM).
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// extractSensor returns nested telemetry sensor values, falling back to the
// firmware's flat {"temp","bpm","spo2"} payload when the nested form is empty.
func extractSensor(raw []byte, nested domain.SensorData) domain.SensorData {
	if nested.Temperature != 0 || nested.BPM != 0 || nested.SpO2 != 0 {
		return nested
	}
	var flat struct {
		Temp *float64 `json:"temp"`
		BPM  *int     `json:"bpm"`
		SpO2 *int     `json:"spo2"`
	}
	if err := json.Unmarshal(raw, &flat); err != nil {
		return nested
	}
	out := nested
	if flat.Temp != nil {
		out.Temperature = *flat.Temp
	}
	if flat.BPM != nil {
		out.BPM = *flat.BPM
	}
	if flat.SpO2 != nil {
		out.SpO2 = *flat.SpO2
	}
	return out
}
