#include <Arduino.h>
#include <ArduinoJson.h>
#include "sensor_module.h"
#include "display_module.h"
#include "network_module.h"
#include "audio_module.h"

unsigned long previousMillis = 0;
const long interval = 1000;

void setup() {
  Serial.begin(115200);
  
  // Initialize subsystems
  initSensors();
  initDisplay();
  initI2S();
  
  // WiFi and WebSocket initialization
  connectWiFi("Z Flip3 milik Anang", "11111111");
  initWebSocket("10.35.96.208", 8000, "/ws/device");
}

void loop() {
  // Continuous non-blocking tasks
  networkLoop();
  loopbackTest();
  
  unsigned long currentMillis = millis();
  
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;
    
    // 1) Fetch live sensor readings
    float temp = getTemperature();
    int bpm = getBPM();
    int spo2 = getSpO2();
    
    // 2) Update local OLED display
    updateDisplay(temp, bpm, spo2);
    
    // 3) Create JSON payload
    JsonDocument doc;
    doc["temp"] = temp;
    doc["bpm"] = bpm;
    doc["spo2"] = spo2;
    doc["status"] = "online";
    
    // 4) Serialize and send telemetry via WebSocket
    String jsonString;
    serializeJson(doc, jsonString);
    sendTelemetry(jsonString);
  }
}