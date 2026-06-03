#include "network_module.h"
#include <WiFi.h>
#include <WebSocketsClient.h>

WebSocketsClient webSocket;
const char* currentSsid;
const char* currentPassword;

bool isWsConnected = false;

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      if (isWsConnected) {
        Serial.println("[WSc] Disconnected!");
        isWsConnected = false;
      }
      break;
    case WStype_CONNECTED:
      Serial.printf("[WSc] Connected to url: %s\n", payload);
      isWsConnected = true;
      break;
    case WStype_TEXT:
      Serial.printf("[WSc] get text: %s\n", payload);
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
  
  // Initial blocking wait is okay for setup, but let's avoid infinite loops.
  // We'll limit it to 10 seconds.
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

void sendTelemetry(String jsonPayload) {
  webSocket.sendTXT(jsonPayload);
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
