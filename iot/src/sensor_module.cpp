#include "sensor_module.h"
#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "spo2_algorithm.h"

static Adafruit_MLX90614 mlx;
static MAX30105 particleSensor;

static bool max30102Ok = false;

// --- BPM filtering ---
// Window enlarged 4 -> 9 and we take the MEDIAN, not the mean. On clone sensors
// checkForBeat misfires symmetrically (double-trigger => ~2x BPM, missed peak => ~0.5x BPM).
// A median rejects those outliers outright; a mean would average them in.
static const byte RATE_SIZE = 9;
static byte  rates[RATE_SIZE];   // circular buffer of last RATE_SIZE in-range BPM readings
static byte  rateSpot   = 0;     // next write index (unbounded; mod RATE_SIZE on access)
static byte  validBeats = 0;     // how many slots in rates[] hold real data (capped at RATE_SIZE)
static long  lastBeat   = 0;     // millis() timestamp of last confirmed beat
static float emaBPM     = 0.0f;  // exponential moving average over the median, for smooth display

// Physiological range for a resting/active adult. Tighter than [20,255] so obvious
// misfires never even enter the median window.
static const float BPM_MIN = 40.0f;
static const float BPM_MAX = 180.0f;

// Reject a new beat if it deviates more than this from the established average —
// a hard guard against the double/half-beat artifact once we have a stable baseline.
static const float BPM_OUTLIER_DELTA = 25.0f;

// Need this many in-range beats before showing anything, so the median is meaningful.
static const byte  MIN_BEATS_FOR_DISPLAY = 5;

// Median of the currently-filled slots in rates[]. Copies, insertion-sorts (n<=9), returns middle.
static int medianBPM() {
  byte tmp[RATE_SIZE];
  byte n = validBeats;
  for (byte i = 0; i < n; i++) tmp[i] = rates[i];
  for (byte i = 1; i < n; i++) {
    byte key = tmp[i];
    int  j = i - 1;
    while (j >= 0 && tmp[j] > key) { tmp[j + 1] = tmp[j]; j--; }
    tmp[j + 1] = key;
  }
  return tmp[n / 2];
}

// --- SpO2 batch buffers ---
static uint32_t irBuffer[100];
static uint32_t redBuffer[100];
static int      bufferIndex = 0;
static int32_t  spo2;
static int8_t   validSPO2;
static int32_t  heartRate;
static int8_t   validHeartRate;

// --- Outputs ---
static int currentBPM  = 0;
static int currentSpO2 = 0;

// --- Timing ---
static unsigned long lastFingerSeen    = 0;
static unsigned long lastNoFingerLog   = 0;
static unsigned long fingerContactTime = 0;  // millis() when finger was first placed after a reset
static unsigned long noFingerSince     = 0;  // debounce: when below-threshold streak started
static unsigned long lastIrLog         = 0;  // throttle for periodic IR value diagnostic

// Reset all beat-detection and SpO2 state to a clean slate.
// Sets lastBeat = millis() so the first post-reset beat delta is measured
// from now, preventing a stale zero from producing a bogus BPM reading.
static void resetBeatState() {
  currentBPM        = 0;
  currentSpO2       = 0;
  bufferIndex       = 0;
  rateSpot          = 0;
  validBeats        = 0;
  fingerContactTime = 0;
  noFingerSince     = 0;
  emaBPM            = 0.0f;
  lastBeat          = millis();
  memset(rates, 0, sizeof(rates));
}

void initSensors() {
  // Wire.begin() + Wire.setClock() are owned by setup() in main.cpp.
  // particleSensor.begin() calls them internally — passing I2C_SPEED_STANDARD
  // keeps the bus at 100kHz so initDisplay() afterwards sees a stable bus.
  mlx.begin();

  if (particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
    max30102Ok = true;
    // ledMode=2 (Red+IR), sampleRate=400, sampleAverage=4 → 100 eff. samples/sec
    // Power 0x1F (31/255): lower than 0x5A to reduce saturation on clone sensors.
    // High LED power buries the AC pulse-wave in a flat saturated DC signal,
    // which is why checkForBeat never fires on clones at 0x5A.
    particleSensor.setup(0x1F, 4, 2, 400, 411, 4096);
    particleSensor.setPulseAmplitudeRed(0x1F);
    particleSensor.setPulseAmplitudeIR(0x1F);
    particleSensor.setPulseAmplitudeGreen(0);
    Serial.println("MAX30102 init OK");
  } else {
    max30102Ok = false;
    Serial.println("MAX30102 not found — BPM/SpO2 disabled. OLED and temperature continue.");
  }
}

void updateSensors() {
  if (!max30102Ok) return;

  particleSensor.check();

  while (particleSensor.available()) {
    uint32_t redData = particleSensor.getFIFORed();
    uint32_t irData  = particleSensor.getFIFOIR();
    particleSensor.nextSample();

    // 0x3FFFF = ADC pegged at max — sensor disconnected or unpowered; discard silently.
    if (irData == 0x3FFFF || redData == 0x3FFFF) {
      resetBeatState();
      continue;
    }

    // --- Finger detection gate ---
    // Threshold 7000 (not 50000): clone MAX30102 modules commonly output IR values
    // in the 7000–50000 range with a finger, far below the original sensor's range.
    if (irData < 7000) {
      // Debounce: don't reset immediately on a single below-threshold sample.
      // One noisy sample below 7000 would erase all accumulated validBeats.
      // Only declare "No Finger" after 500ms of sustained below-threshold readings.
      if (noFingerSince == 0) noFingerSince = millis();

      if (millis() - noFingerSince >= 500) {
        if (millis() - lastNoFingerLog >= 1000) {
          Serial.println("No Finger");
          lastNoFingerLog = millis();
        }
        resetBeatState();
      }
      continue;
    }

    // Finger confirmed — clear debounce, record contact time.
    noFingerSince  = 0;
    lastFingerSeen = millis();
    if (fingerContactTime == 0) fingerContactTime = millis();  // latch first-touch timestamp

    // Periodic diagnostic: print live IR value so we can confirm signal quality.
    if (millis() - lastIrLog >= 2000) {
      Serial.printf("[IR] irData=%u  validBeats=%d  bufIdx=%d\n", irData, validBeats, bufferIndex);
      lastIrLog = millis();
    }

    // --- BPM via checkForBeat -> range filter -> outlier reject -> median -> EMA ---
    // Feed raw irData directly so checkForBeat's internal DC filter tracks the
    // live sample stream, not a buffered copy from a previous iteration.
    if (checkForBeat(irData)) {
      long now   = millis();
      long delta = now - lastBeat;
      lastBeat   = now;

      float bpm = 60.0f / (delta / 1000.0f);

      // Debug: raw delta + BPM BEFORE any filtering, to confirm peaks are detected.
      Serial.printf("[BEAT] delta=%ldms  raw_bpm=%.1f  IR=%u\n", delta, bpm, irData);

      // Stage 1 — physiological range gate. Drop anything outside [40,180].
      if (bpm < BPM_MIN || bpm > BPM_MAX) {
        Serial.printf("[BEAT] rejected — %.1f out of range [%.0f,%.0f]\n", bpm, BPM_MIN, BPM_MAX);
      }
      // Stage 2 — outlier gate, referenced against the MEDIAN (robust), not the EMA (laggy),
      // and only ARMED once the window holds enough samples that the median is trustworthy.
      // Critically, the median baseline is built WITHOUT this gate during warm-up, so a misfire
      // in the first beat cannot freeze us at the wrong value (the median averages it out).
      else if (validBeats >= MIN_BEATS_FOR_DISPLAY &&
               fabsf(bpm - (float)medianBPM()) > BPM_OUTLIER_DELTA) {
        Serial.printf("[BEAT] rejected outlier — %.1f vs median %d (>%.0f)\n",
                      bpm, medianBPM(), BPM_OUTLIER_DELTA);
      }
      else {
        // Accept: push into circular buffer.
        rates[rateSpot % RATE_SIZE] = (byte)bpm;
        rateSpot++;
        if (validBeats < RATE_SIZE) validBeats++;

        // Stage 3 — median over the window kills any residual asymmetric outliers.
        int med = medianBPM();

        // Stage 4 — EMA over the median for a smooth, non-jumpy display value.
        // Hold off until the window is mature, then SEED the EMA straight from the
        // (already-correct) median so the first shown value is right — no slow
        // drift down from an early misfire. Afterwards, weight 80% old / 20% new.
        if (validBeats >= MIN_BEATS_FOR_DISPLAY) {
          if (emaBPM <= 0.0f) emaBPM = med;
          else                emaBPM = 0.8f * emaBPM + 0.2f * med;
          currentBPM = (int)(emaBPM + 0.5f);  // round to nearest
        }

        Serial.printf("[BPM]  validBeats=%d  median=%d  ema=%.1f  shown=%d\n",
                      validBeats, med, emaBPM, currentBPM);
      }
    }

    // --- SpO2: accumulate 100-sample batch then run Maxim algorithm ---
    // Constraint 3: this path is independent of the BPM path above — a stalled
    // SpO2 buffer cannot block beat detection. Added log when batch fires.
    if (bufferIndex < 100) {
      redBuffer[bufferIndex] = redData;
      irBuffer[bufferIndex]  = irData;
      bufferIndex++;
    }

    if (bufferIndex == 100) {
      Serial.printf("[SPO2] Running Maxim algorithm on 100 samples...\n");
      maxim_heart_rate_and_oxygen_saturation(irBuffer, 100, redBuffer,
                                             &spo2, &validSPO2,
                                             &heartRate, &validHeartRate);
      // -999 from Maxim means insufficient data — only accept when both flags
      // are confirmed and value is physiologically plausible (70–100%).
      if (validSPO2 == 1 && spo2 >= 70 && spo2 <= 100) {
        currentSpO2 = (int)spo2;
        Serial.printf("[SPO2] Valid: BPM=%d  SpO2=%d%%\n", currentBPM, currentSpO2);
      } else {
        Serial.printf("[SPO2] Invalid result: spo2=%d  validSPO2=%d\n", (int)spo2, (int)validSPO2);
      }
      // Roll window: keep last 75 samples for the next batch.
      for (byte i = 25; i < 100; i++) {
        redBuffer[i - 25] = redBuffer[i];
        irBuffer[i - 25]  = irBuffer[i];
      }
      bufferIndex = 75;
    }
  }

  // Safety net: if the FIFO stopped delivering valid finger samples for > 2s,
  // ensure outputs are zeroed even if the while-loop above never ran.
  if (millis() - lastFingerSeen > 2000) {
    resetBeatState();
  }
}

float getTemperature() { return mlx.readObjectTempC(); }
int   getBPM()         { return currentBPM;  }
int   getSpO2()        { return currentSpO2; }

// True if a valid IR sample (finger present) was seen within the last 2s.
bool isFingerPresent() {
  return lastFingerSeen > 0 && (millis() - lastFingerSeen) <= 2000;
}

// True if a finger has been on the sensor for > 8s but still no displayable reading.
// Signals the user to reposition — pressed too hard, too light, or off-centre.
// Timeout raised 5s -> 8s because the 9-sample median needs more beats to converge.
bool isAdjustNeeded() {
  if (!isFingerPresent() || fingerContactTime == 0) return false;
  if (currentBPM > 0) return false;                        // already showing a reading
  return (millis() - fingerContactTime) > 8000;
}
