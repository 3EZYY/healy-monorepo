#ifndef NETWORK_MODULE_H
#define NETWORK_MODULE_H

#include <Arduino.h>

void connectWiFi(const char* ssid, const char* password);
void initWebSocket(const char* host, uint16_t port, const char* path);
void sendTelemetry(const char* jsonPayload);
void networkLoop();

// Drain captured mic PCM and stream it to the backend via webSocket.sendBIN().
// Call from networkTask only (keeps all WebSocket I/O single-threaded).
void networkAudioPump();

#endif
