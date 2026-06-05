#ifndef AUDIO_MODULE_H
#define AUDIO_MODULE_H

#include <Arduino.h>
#include <driver/i2s.h>

// ── I2S Voice Assistant API ─────────────────────────────────────────────
// Full-duplex I2S on I2S_NUM_0:
//   INMP441 mic   -> data_in  (record, 16 kHz)
//   MAX98357A amp -> data_out (playback, 24 kHz — Gemini TTS native rate)
//
// Thread model (see main.cpp):
//   - ALL i2s_read/i2s_write happens in audioTask (Core 0) via audioServiceLoop().
//   - ALL webSocket I/O happens in networkTask (Core 0).
//   - Two FreeRTOS stream buffers bridge the tasks lock-free:
//       uplink   : audioTask (mic)      -> networkTask (sendBIN)
//       downlink : networkTask (WS BIN) -> audioTask (speaker)
// This keeps the non-reentrant WebSocketsClient touched by a single task and
// the I2S driver touched by a single task — no shared-peripheral races.

void initI2S();

// Recording control — called from the WS event handler (networkTask).
// These only flip a flag; the actual clock/mode switch happens in audioServiceLoop.
void   audioStartRecording();
void   audioStopRecording();
bool   audioIsRecording();

// Downlink: enqueue TTS PCM received over WStype_BIN (called from networkTask).
void   audioEnqueueDownlink(const uint8_t* data, size_t len);

// Uplink: drain one chunk of captured mic PCM to stream out (called from networkTask).
// Returns number of bytes copied into `out` (0 if none available).
size_t audioReadUplinkChunk(uint8_t* out, size_t maxLen);

// Drives capture/playback. Call once per audioTask iteration (Core 0).
void   audioServiceLoop();

#endif
