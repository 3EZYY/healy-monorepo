#include <Arduino.h>
#include "network_module.h"

unsigned long previousMillis = 0;
const long interval = 2000;

void setup() {
  Serial.begin(115200);
  
  connectWiFi("dummy_ssid", "dummy_password");
  initWebSocket("dummy_host", 8080, "/ws");
}

void loop() {
  networkLoop();
  
  unsigned long currentMillis = millis();
  
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;
    
    sendTelemetry("{\"message\": \"Hello World\", \"status\": \"online\"}");
  }
}