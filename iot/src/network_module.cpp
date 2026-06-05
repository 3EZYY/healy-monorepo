#include "network_module.h"
#include "audio_module.h"
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <string.h>

WebSocketsClient webSocket;
const char* currentSsid;
const char* currentPassword;

bool isWsConnected = false;

// PCM uplink: stream mic in 1024-byte binary frames (matches backend buffering).
#define UPLINK_FRAME_BYTES 1024

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      if (isWsConnected) {
        Serial.println("[WSc] Disconnected!");
        isWsConnected = false;
      }
      audioStopRecording();  // fail-safe: never leave the mic streaming
      break;

    case WStype_CONNECTED:
      Serial.printf("[WSc] Connected to url: %s\n", payload);
      isWsConnected = true;
      break;

    case WStype_TEXT:
      // Control channel from backend. Lightweight strstr parse (no JSON alloc
      // in the hot callback). Expected: {"event":"start_audio"|"stop_audio"}.
      if (strstr((const char*)payload, "start_audio")) {
        Serial.println("[PTT] start_audio -> mic ON");
        audioStartRecording();
      } else if (strstr((const char*)payload, "stop_audio")) {
        Serial.println("[PTT] stop_audio -> mic OFF");
        audioStopRecording();
      } else {
        Serial.printf("[WSc] text: %s\n", payload);
      }
      break;

    case WStype_BIN:
      // Downlink TTS PCM (24 kHz, 16-bit mono) — hand off to audioTask for
      // playback. Do NOT call i2s_write here (this runs in networkTask).
      audioEnqueueDownlink(payload, length);
      break;

    case WStype_ERROR:
      Serial.println("[WSc] Error!");
      break;

    default:
      break;
  }
}

unsigned long lastWiFiConnectAttempt = 0;

void connectWiFi(const char* ssid, const char* password) {
  currentSsid = ssid;
  currentPassword = password;

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected.");
  } else {
    Serial.println("\nWiFi connection failed initially. Will retry in background.");
  }
}

void initWebSocket(const char* host, uint16_t port, const char* path) {
  webSocket.begin(host, port, path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void sendTelemetry(const char* jsonPayload) {
  webSocket.sendTXT(jsonPayload);
}

void networkAudioPump() {
  // Only stream while a PTT session is active and the socket is up.
  if (!isWsConnected || !audioIsRecording()) return;

  // Drain whatever the mic captured since last tick, frame by frame.
  // Bounded per call so we never starve webSocket.loop()/telemetry.
  static uint8_t frame[UPLINK_FRAME_BYTES];
  for (int i = 0; i < 4; i++) {  // up to 4 KB per pump cycle
    size_t n = audioReadUplinkChunk(frame, sizeof(frame));
    if (n == 0) break;
    webSocket.sendBIN(frame, n);
  }
}

void networkLoop() {
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long currentMillis = millis();
    if (currentMillis - lastWiFiConnectAttempt >= 10000) {
      Serial.println("WiFi disconnected, reconnecting...");
      WiFi.begin(currentSsid, currentPassword);
      lastWiFiConnectAttempt = currentMillis;
    }
  } else {
    webSocket.loop();
  }
}
