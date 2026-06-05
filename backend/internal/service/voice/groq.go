package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
)

const groqTranscribeURL = "https://api.groq.com/openai/v1/audio/transcriptions"

// groqTranscriptionResponse is the OpenAI-compatible Whisper response shape.
type groqTranscriptionResponse struct {
	Text  string `json:"text"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// transcribe sends the captured PCM (wrapped as WAV) to Groq Whisper STT.
// Model: whisper-large-v3, multipart/form-data, language hint "id" (Indonesian).
func (s *Service) transcribe(ctx context.Context, pcm []byte) (string, error) {
	wav := pcmToWAV(pcm)

	var body bytes.Buffer
	w := multipart.NewWriter(&body)

	// audio file part
	filePart, err := w.CreateFormFile("file", "speech.wav")
	if err != nil {
		return "", fmt.Errorf("create form file: %w", err)
	}
	if _, err := filePart.Write(wav); err != nil {
		return "", fmt.Errorf("write wav: %w", err)
	}

	// fields
	_ = w.WriteField("model", "whisper-large-v3")
	_ = w.WriteField("language", "id")              // bias toward Indonesian
	_ = w.WriteField("response_format", "json")
	_ = w.WriteField("temperature", "0")
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("close multipart: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, groqTranscribeURL, &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.groqKey)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("groq request: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("groq status %d: %s", resp.StatusCode, string(raw))
	}

	var parsed groqTranscriptionResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("decode groq response: %w (body=%s)", err, string(raw))
	}
	if parsed.Error != nil {
		return "", fmt.Errorf("groq error: %s", parsed.Error.Message)
	}
	return parsed.Text, nil
}
