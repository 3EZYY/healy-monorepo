#include <Arduino.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "sensor_module.h"
#include "display_module.h"
#include "network_module.h"
#include "audio_module.h"

#define TELEMETRY_QUEUE_LEN  5
#define JSON_BUF_SIZE        128

typedef struct {
  char json[JSON_BUF_SIZE];
} TelemetryMsg_t;

static QueueHandle_t telemetryQueue;

// Core 1: non-blocking MAX30102 poll at ~200Hz; display + telemetry queued every 1s
static void sensorDisplayTask(void* pvParameters) {
  TickType_t lastDisplayTick = xTaskGetTickCount();
  const TickType_t displayInterval = pdMS_TO_TICKS(1000);

  for (;;) {
    updateSensors();  // drains MAX30102 FIFO — non-blocking

    if ((xTaskGetTickCount() - lastDisplayTick) >= displayInterval) {
      lastDisplayTick += displayInterval;  // drift-free 1s cadence

      float temp = getTemperature();  // MLX90614 I2C read
      int   bpm  = getBPM();
      int   spo2 = getSpO2();

      updateDisplay(temp, bpm, spo2, isFingerPresent(), isAdjustNeeded());  // SSD1306 I2C update

      TelemetryMsg_t msg;
      JsonDocument doc;
      doc["temp"]   = temp;
      doc["bpm"]    = bpm;
      doc["spo2"]   = spo2;
      doc["status"] = "online";
      serializeJson(doc, msg.json, JSON_BUF_SIZE);
      xQueueSend(telemetryQueue, &msg, 0);  // non-blocking enqueue
    }

    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// Core 0: WiFi guard + webSocket.loop() + telemetry dispatch + mic uplink.
// ALL webSocket I/O lives here so the non-reentrant client has a single owner.
static void networkTask(void* pvParameters) {
  TelemetryMsg_t msg;

  for (;;) {
    networkLoop();  // WiFi guard + webSocket.loop()

    if (xQueueReceive(telemetryQueue, &msg, 0) == pdTRUE) {
      sendTelemetry(msg.json);
    }

    networkAudioPump();  // drain captured mic PCM -> webSocket.sendBIN()

    vTaskDelay(pdMS_TO_TICKS(5));  // tighter loop keeps PTT latency low
  }
}

// Core 0: I2S owner. Captures mic (when recording) or plays TTS downlink.
// ALL i2s_read/i2s_write happens here; stream buffers bridge to networkTask.
static void audioTask(void* pvParameters) {
  for (;;) {
    audioServiceLoop();
    vTaskDelay(pdMS_TO_TICKS(5));  // WDT feed + yield
  }
}

void setup() {
  Serial.begin(115200);

  connectWiFi("ATAR ATAS", "atar1234");
  initWebSocket("10.35.96.208", 8000, "/ws/device");

  Wire.begin(21, 22);
  Wire.setClock(100000);  // Standard Mode (100kHz) — clone OLEDs are unstable at 400kHz

  Serial.println("Scanning I2C bus...");
  int deviceCount = 0;
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();
    if (error == 0) {
      Serial.printf("I2C device found at address 0x%02X\n", address);
      deviceCount++;
    }
  }
  if (deviceCount == 0) {
    Serial.println("No I2C devices found. Check wiring or hardware!");
  }

  initSensors();
  initDisplay();
  initI2S();

  telemetryQueue = xQueueCreate(TELEMETRY_QUEUE_LEN, sizeof(TelemetryMsg_t));
  configASSERT(telemetryQueue);

  xTaskCreatePinnedToCore(sensorDisplayTask, "SensorDisplay", 8192, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(networkTask,       "Network",       8192, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(audioTask,         "Audio",         6144, NULL, 1, NULL, 0);
}

void loop() {
  vTaskDelete(NULL);  // Arduino loop task deleted — all work is in FreeRTOS tasks above
}
