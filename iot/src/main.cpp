#include <Arduino.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include "sensor_module.h"
#include "display_module.h"
#include "network_module.h"
#include "audio_module.h"

unsigned long previousMillis = 0;
const long interval = 1000;

void setup() {
  Serial.begin(115200);
  
  // WiFi and WebSocket initialization
  connectWiFi("iPhone Rafif", "CUKURUKUK");
  initWebSocket("10.35.96.208", 8000, "/ws/device");

  Wire.begin(21, 22);
  
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
  
  // Initialize subsystems
  initSensors();
  initDisplay();
  initI2S();
}

void loop() {
  // Continuous non-blocking tasks
  networkLoop();
  loopbackTest();
  updateSensors();
  
  unsigned long currentMillis = millis();
  
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;
    
    // 1) Fetch live sensor readings
    float temp = getTemperature();
    int bpm = getBPM();
    int spo2 = getSpO2();
    
    // 2) Update local OLED display
    Serial.println("Drawing to OLED...");
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