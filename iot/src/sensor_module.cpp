#include "sensor_module.h"
#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include "MAX30105.h"
#include "heartRate.h"

#include "spo2_algorithm.h"

Adafruit_MLX90614 mlx;
MAX30105 particleSensor;

const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute;
int beatAvg;

int currentBPM = 0;
int currentSpO2 = 0;

uint32_t irBuffer[100]; 
uint32_t redBuffer[100];
int bufferIndex = 0;
int32_t spo2;
int8_t validSPO2;
int32_t heartRate;
int8_t validHeartRate;

unsigned long lastFingerSeen = 0;
int warmupCounter = 0;

void initSensors() {
  Wire.begin(21, 22);
  Wire.setClock(400000); // Set I2C speed to Fast Mode (400kHz)
  mlx.begin();
  
  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    // ledMode = 2 (Red + IR) for SpO2
    // setup(powerLevel, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange)
    particleSensor.setup(0x5A, 4, 2, 400, 411, 4096);
    particleSensor.setPulseAmplitudeRed(0x5A); // 90 decimal
    particleSensor.setPulseAmplitudeIR(0x5A);
    particleSensor.setPulseAmplitudeGreen(0);
  } else {
    Serial.println("MAX30105 was not found. Please check wiring/power.");
  }
}

void updateSensors() {
  particleSensor.check(); // Non-blocking check for new data
  
  while (particleSensor.available()) {
    uint32_t redData = particleSensor.getFIFORed();
    uint32_t irData = particleSensor.getFIFOIR();
    particleSensor.nextSample();
    
    long irValue = particleSensor.getIR();
    Serial.print("IR Value: ");
    Serial.println(irValue);
    
    if (irValue < 50000) {
      Serial.println("Status: NO FINGER");
    } else {
      Serial.println("Status: FINGER DETECTED");
    }
    
    // Finger presence tracking
    if (irData >= 50000) {
      lastFingerSeen = millis();
      if (warmupCounter < 100) warmupCounter++;
    }
    
    // Step 5: Relaxed buffer reset (only if removed for > 1000ms)
    if (millis() - lastFingerSeen > 1000) {
      currentBPM = 0;
      currentSpO2 = 0;
      bufferIndex = 0; // Explicitly flush/reset the rolling buffer
      warmupCounter = 0;
      beatAvg = 0;
      rateSpot = 0;
      continue; // Skip processing until a finger returns
    }
    
    redBuffer[bufferIndex] = redData;
    irBuffer[bufferIndex] = irData;
    
    // Heart rate calculation using checkForBeat
    if (checkForBeat(irBuffer[bufferIndex]) == true) {
      long delta = millis() - lastBeat;
      lastBeat = millis();

      beatsPerMinute = 60 / (delta / 1000.0);
      if (beatsPerMinute < 255 && beatsPerMinute > 20) {
        rates[rateSpot++] = (byte)beatsPerMinute;
        rateSpot %= RATE_SIZE;

        beatAvg = 0;
        for (byte x = 0 ; x < RATE_SIZE ; x++) beatAvg += rates[x];
        beatAvg /= RATE_SIZE;
      }
    }
    
    bufferIndex++;
    
    if (bufferIndex == 100) {
      // Process the Maxim algorithm
      maxim_heart_rate_and_oxygen_saturation(irBuffer, 100, redBuffer, &spo2, &validSPO2, &heartRate, &validHeartRate);
      
      Serial.printf("Raw BPM: %d | Raw SpO2: %d\n", heartRate, spo2);
      
      // Shift the last 75 samples to the beginning
      for (byte i = 25; i < 100; i++) {
        redBuffer[i - 25] = redBuffer[i];
        irBuffer[i - 25] = irBuffer[i];
      }
      bufferIndex = 75;
      
      // Step 2, 3, 4: Sanity Filter and Warm-up disabled for debugging
      currentSpO2 = spo2;
    }
  }

  // Update currentBPM globally if a finger is currently present, with Sanity & Warmup
  if (millis() - lastFingerSeen <= 1000) {
    currentBPM = beatAvg;
  } else {
    currentBPM = 0;
    currentSpO2 = 0;
    bufferIndex = 0;
    warmupCounter = 0;
  }
}

float getTemperature() {
  return mlx.readObjectTempC();
}

int getBPM() {
  return currentBPM;
}

int getSpO2() {
  return currentSpO2;
}
