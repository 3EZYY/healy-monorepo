#ifndef SENSOR_MODULE_H
#define SENSOR_MODULE_H

void initSensors();
void updateSensors();
float getTemperature();
int   getBPM();
int   getSpO2();
bool  isFingerPresent();  // true if IR >= 50000 seen within last 2s
bool  isAdjustNeeded();   // true if finger on > 5s but no valid beats yet

#endif
