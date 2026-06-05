#include "display_module.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT  64

static Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// Guard: display.buffer is nullptr if begin() failed; never call display methods without this.
static bool displayOk = false;

void initDisplay() {
  Serial.println("Init OLED...");
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 allocation failed — OLED disabled");
    displayOk = false;
    return;
  }
  displayOk = true;
  Serial.println("OLED Init OK");
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.display();
}

// Layout (128x64, textSize 1 = 6x8px per char):
//  y= 0  "--- HEALTH DATA ---"   header
//  y=10  horizontal divider
//  y=13  "Temp : 36.5 C"
//  y=26  "BPM  : 73 bpm"   or  "BPM  : --"  when no reading
//  y=39  "SpO2 : 98 %"     or  "SpO2 : --"  when no reading
//  y=50  horizontal divider
//  y=53  footer — one of four states:
//          "Place finger..."   no finger
//          "Measuring..."      finger on, warming up (<5s)
//          "Adjust finger!"    finger on >5s, still no beats
//          "Status: OK"        valid reading
void updateDisplay(float temp, int bpm, int spo2, bool fingerPresent, bool adjustNeeded) {
  if (!displayOk) return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  // Header
  display.setCursor(0, 0);
  display.print("--- HEALTH DATA ---");
  display.drawFastHLine(0, 10, SCREEN_WIDTH, SSD1306_WHITE);

  // Temperature — always valid (MLX90614 is independent of MAX30102)
  display.setCursor(0, 13);
  display.print("Temp : ");
  display.print(temp, 1);
  display.print(" C");

  // BPM — show "--" until sensor produces a valid reading (avoids misleading "0")
  display.setCursor(0, 26);
  display.print("BPM  : ");
  if (bpm > 0) {
    display.print(bpm);
    display.print(" bpm");
  } else {
    display.print("--");
  }

  // SpO2 — show "--" until Maxim algorithm confirms a valid result
  display.setCursor(0, 39);
  display.print("SpO2 : ");
  if (spo2 > 0) {
    display.print(spo2);
    display.print(" %");
  } else {
    display.print("--");
  }

  // Status footer — four states driven by sensor module state
  display.drawFastHLine(0, 50, SCREEN_WIDTH, SSD1306_WHITE);
  display.setCursor(0, 53);
  if (bpm > 0) {
    display.print("Status: OK");
  } else if (!fingerPresent) {
    display.print("Place finger...");
  } else if (adjustNeeded) {
    display.print("Adjust finger!");
  } else {
    display.print("Measuring...");
  }

  display.display();
}
