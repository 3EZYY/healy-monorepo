package voice

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/rafif/healy-backend/internal/domain"
)

const geminiBase = "https://generativelanguage.googleapis.com/v1beta/models/"

// Models. NOTE: "gemini-3.5-flash" does not exist — see package doc.
const (
	geminiReasonModel = "gemini-2.5-flash"            // text reasoning
	geminiTTSModel    = "gemini-2.5-flash-preview-tts" // native audio output
	geminiTTSVoice    = "Kore"                          // calm, neutral prebuilt voice
)

// ── Gemini REST shapes (subset we use) ──────────────────────────────────

type geminiInline struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"` // base64
}

type geminiPart struct {
	Text       string        `json:"text,omitempty"`
	InlineData *geminiInline `json:"inlineData,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error,omitempty"`
}

// post sends a generateContent request to the given model and returns parsed JSON.
func (s *Service) post(ctx context.Context, model string, payload any) (*geminiResponse, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	url := geminiBase + model + ":generateContent"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	// Header auth works for both AI Studio (AIza…) and express keys; avoids
	// leaking the key into URLs/logs.
	req.Header.Set("x-goog-api-key", s.geminiKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gemini request: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gemini %s status %d: %s", model, resp.StatusCode, string(raw))
	}

	var parsed geminiResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("decode gemini response: %w (body=%s)", err, string(raw))
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("gemini error %d: %s", parsed.Error.Code, parsed.Error.Message)
	}
	return &parsed, nil
}

// reason combines the user's transcript with live telemetry and returns a
// concise Indonesian reply (Stage 2 of the pipeline).
func (s *Service) reason(ctx context.Context, transcript string, t domain.SensorData) (string, error) {
	system := "Kamu adalah HEALY, asisten kesehatan suara berbahasa Indonesia. " +
		"Jawab SINGKAT (maksimal 2 kalimat), ramah, dan jelas untuk diucapkan. " +
		"Gunakan data sensor pasien bila relevan. Jangan memberi diagnosis medis pasti; " +
		"sarankan periksa ke tenaga medis bila ada tanda bahaya."

	context := fmt.Sprintf(
		"Data sensor terkini pasien — Suhu: %.1f°C, Detak jantung: %d bpm, SpO2: %d%%.",
		t.Temperature, t.BPM, t.SpO2,
	)
	userText := context + "\n\nPertanyaan pasien: " + transcript

	payload := map[string]any{
		"systemInstruction": map[string]any{
			"parts": []geminiPart{{Text: system}},
		},
		"contents": []geminiContent{
			{Role: "user", Parts: []geminiPart{{Text: userText}}},
		},
		"generationConfig": map[string]any{
			"temperature":     0.6,
			"maxOutputTokens": 200,
		},
	}

	resp, err := s.post(ctx, geminiReasonModel, payload)
	if err != nil {
		return "", err
	}
	text := firstText(resp)
	if text == "" {
		return "", fmt.Errorf("gemini reasoning returned no text")
	}
	return strings.TrimSpace(text), nil
}

// synthesize converts reply text to speech using Gemini native audio output.
// This is the stage that honors responseModalities:["AUDIO"]. Output is
// base64 PCM, 24 kHz / 16-bit / mono.
func (s *Service) synthesize(ctx context.Context, text string) ([]byte, error) {
	payload := map[string]any{
		"contents": []geminiContent{
			{Parts: []geminiPart{{Text: text}}},
		},
		"generationConfig": map[string]any{
			"responseModalities": []string{"AUDIO"},
			"speechConfig": map[string]any{
				"voiceConfig": map[string]any{
					"prebuiltVoiceConfig": map[string]any{
						"voiceName": geminiTTSVoice,
					},
				},
			},
		},
	}

	resp, err := s.post(ctx, geminiTTSModel, payload)
	if err != nil {
		return nil, err
	}

	b64 := firstInlineData(resp)
	if b64 == "" {
		return nil, fmt.Errorf("gemini tts returned no audio data")
	}
	pcm, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("decode tts base64: %w", err)
	}
	return pcm, nil
}

// firstText extracts the first text part from a Gemini response.
func firstText(r *geminiResponse) string {
	for _, c := range r.Candidates {
		for _, p := range c.Content.Parts {
			if p.Text != "" {
				return p.Text
			}
		}
	}
	return ""
}

// firstInlineData extracts the first inline (audio) data payload.
func firstInlineData(r *geminiResponse) string {
	for _, c := range r.Candidates {
		for _, p := range c.Content.Parts {
			if p.InlineData != nil && p.InlineData.Data != "" {
				return p.InlineData.Data
			}
		}
	}
	return ""
}
