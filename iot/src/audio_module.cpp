#include "audio_module.h"
#include <freertos/FreeRTOS.h>
#include <freertos/stream_buffer.h>

// ── Pin map (shared BCLK/WS for full-duplex) ────────────────────────────
#define I2S_WS    25   // LRCLK / word select  (mic + amp share)
#define I2S_BCLK  26   // bit clock            (mic + amp share)
#define I2S_DOUT  23   // -> MAX98357A DIN     (speaker data out)
#define I2S_DIN   32   // <- INMP441  SD/DOUT  (mic data in)

// ── Sample rates ────────────────────────────────────────────────────────
#define RATE_RECORD    16000   // INMP441 capture -> Groq Whisper expects 16 kHz
#define RATE_PLAYBACK  24000   // Gemini TTS emits 24 kHz PCM 16-bit mono

#define MIC_CHUNK_BYTES   1024 // bytes read per i2s_read (512 samples @16-bit)
#define SPK_CHUNK_BYTES   1024 // bytes written per i2s_write

// ── Stream buffers bridging audioTask <-> networkTask ───────────────────
static StreamBufferHandle_t uplinkSB   = nullptr;  // mic  -> network
static StreamBufferHandle_t downlinkSB = nullptr;  // network -> speaker

// ── State ───────────────────────────────────────────────────────────────
static volatile bool recording = false;

enum AudioMode { MODE_NONE, MODE_RECORD, MODE_PLAYBACK };
static AudioMode currentMode = MODE_NONE;

// Switch the shared I2S clock between record (16k) and playback (24k).
// Called ONLY from audioTask (inside audioServiceLoop) to keep I2S single-owner.
static void setMode(AudioMode mode) {
  if (mode == currentMode) return;
  uint32_t rate = (mode == MODE_PLAYBACK) ? RATE_PLAYBACK : RATE_RECORD;
  i2s_set_clk(I2S_NUM_0, rate, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO);
  currentMode = mode;
}

void initI2S() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX | I2S_MODE_RX),
    .sample_rate = RATE_RECORD,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,  // mono: INMP441 L/R pin -> GND
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 256,
    .use_apll = false,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_BCLK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_DOUT,
    .data_in_num = I2S_DIN
  };

  i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pin_config);
  currentMode = MODE_RECORD;

  // 16 KB downlink: ~0.34s of 24 kHz audio buffered — smooths WS jitter.
  // 8 KB uplink: holds mic backlog while networkTask drains it to sendBIN.
  downlinkSB = xStreamBufferCreate(16384, 1);
  uplinkSB   = xStreamBufferCreate(8192, MIC_CHUNK_BYTES);
}

void audioStartRecording() { recording = true;  }
void audioStopRecording()  { recording = false; }
bool audioIsRecording()    { return recording;  }

void audioEnqueueDownlink(const uint8_t* data, size_t len) {
  if (!downlinkSB || len == 0) return;
  // Non-blocking: if the buffer is momentarily full, drop the overflow rather
  // than block networkTask (and thus webSocket.loop / WDT).
  xStreamBufferSend(downlinkSB, data, len, 0);
}

size_t audioReadUplinkChunk(uint8_t* out, size_t maxLen) {
  if (!uplinkSB) return 0;
  return xStreamBufferReceive(uplinkSB, out, maxLen, 0);  // non-blocking
}

void audioServiceLoop() {
  if (recording) {
    // ── Capture path: mic -> uplink stream buffer ──
    setMode(MODE_RECORD);

    // Drain any stale TTS still queued so it can't play after a new PTT press.
    if (downlinkSB && !xStreamBufferIsEmpty(downlinkSB)) {
      xStreamBufferReset(downlinkSB);
    }

    uint8_t buf[MIC_CHUNK_BYTES];
    size_t  bytesRead = 0;
    // Short timeout (not portMAX_DELAY) so the loop stays responsive.
    i2s_read(I2S_NUM_0, buf, sizeof(buf), &bytesRead, pdMS_TO_TICKS(20));
    if (bytesRead > 0) {
      xStreamBufferSend(uplinkSB, buf, bytesRead, 0);
    }
    return;
  }

  // ── Playback path: downlink stream buffer -> speaker ──
  if (downlinkSB && !xStreamBufferIsEmpty(downlinkSB)) {
    setMode(MODE_PLAYBACK);

    uint8_t buf[SPK_CHUNK_BYTES];
    size_t  n = xStreamBufferReceive(downlinkSB, buf, sizeof(buf), pdMS_TO_TICKS(20));
    if (n > 0) {
      size_t bytesWritten = 0;
      i2s_write(I2S_NUM_0, buf, n, &bytesWritten, pdMS_TO_TICKS(100));
    }
  }
  // else: idle — nothing to capture or play; audioTask vTaskDelay yields.
}
