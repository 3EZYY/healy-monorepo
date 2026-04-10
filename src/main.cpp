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

  // Initialize sensors (I2C, MLX90614, MAX30105)
  initSensors();
  
  // Initialize OLED display
  initDisplay();
  
  // Initialize WiFi and WebSockets
  connectWiFi("dummy_ssid", "dummy_password");
  initWebSocket("dummy_host", 8080, "/ws");
  
  // Initialize I2S Audio subsystem
  initI2S();
}

void loop() {
  // Continuous non-blocking operations
  networkLoop();
  loopbackTest();
  
  unsigned long currentMillis = millis();
  
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;
    
    // 1) Fetch live readings
    float temp = getTemperature();
    int bpm = getBPM();
    int spo2 = getSpO2();
    
    // 2) Update OLED display
    updateDisplay(temp, bpm, spo2);
    
    // 3) Create JSON payload
    JsonDocument doc;
    doc["bpm"] = bpm;
    doc["spo2"] = spo2;
    doc["temp"] = temp;
    doc["status"] = "online";
    
    // 4) Serialize and send
    String jsonString;
    serializeJson(doc, jsonString);
    sendTelemetry(jsonString);
  }
}