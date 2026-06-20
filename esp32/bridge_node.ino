#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_idf_version.h>

const uint8_t ESPNOW_CHANNEL = 1;
const uint8_t BROADCAST_MAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

const uint8_t PACKET_SENSOR = 1;
const uint8_t PACKET_CONTROL = 2;

const uint8_t STATE_WAITING = 0;
const uint8_t STATE_PULSE = 1;
const uint8_t STATE_HOMECOMING = 2;

struct __attribute__((packed)) SensorPacket {
  uint8_t type;
  uint16_t peopleCount;
  uint16_t heartRate;
  uint32_t sequence;
};

struct __attribute__((packed)) ControlPacket {
  uint8_t type;
  uint8_t state;
  uint16_t peopleCount;
  uint16_t heartRate;
  uint16_t frame;
  float brightness;
  float towerX;
  float towerY;
  float pulseX;
  float pulseY;
  float pulseRadius;
  float homecomingRemaining;
};

char serialLine[384];
size_t serialLineIndex = 0;

void sendStatus(const char* event) {
  Serial.printf(
    "{\"type\":\"bridge_status\",\"event\":\"%s\",\"mac\":\"%s\",\"channel\":%u}\n",
    event,
    WiFi.macAddress().c_str(),
    ESPNOW_CHANNEL
  );
}

uint8_t stateFromString(const char* value) {
  if (value == nullptr) {
    return STATE_WAITING;
  }
  if (strcmp(value, "pulse") == 0) {
    return STATE_PULSE;
  }
  if (strcmp(value, "homecoming") == 0) {
    return STATE_HOMECOMING;
  }
  return STATE_WAITING;
}

void sendControlPacket(const ControlPacket& packet) {
  esp_err_t result = esp_now_send(BROADCAST_MAC, (const uint8_t*)&packet, sizeof(packet));
  if (result != ESP_OK) {
    Serial.printf(
      "{\"type\":\"espnow_status\",\"event\":\"send_failed\",\"code\":%d}\n",
      result
    );
  }
}

void handlePythonLine(const char* line) {
  StaticJsonDocument<384> doc;
  DeserializationError error = deserializeJson(doc, line);
  if (error) {
    Serial.printf(
      "{\"type\":\"bridge_status\",\"event\":\"bad_json\",\"detail\":\"%s\"}\n",
      error.c_str()
    );
    return;
  }

  const char* messageType = doc["type"] | "";
  if (strcmp(messageType, "control") != 0) {
    return;
  }

  ControlPacket packet = {};
  packet.type = PACKET_CONTROL;
  packet.state = stateFromString(doc["state"] | "waiting");
  packet.peopleCount = doc["people_count"] | 0;
  packet.heartRate = doc["heart_rate"] | 0;
  packet.frame = doc["frame"] | 0;
  packet.brightness = doc["brightness"] | 0.08;
  packet.towerX = doc["tower_x"] | 0.5;
  packet.towerY = doc["tower_y"] | 0.08;
  packet.pulseX = doc["pulse_x"] | 0.38;
  packet.pulseY = doc["pulse_y"] | 0.62;
  packet.pulseRadius = doc["pulse_radius"] | 0.32;
  packet.homecomingRemaining = doc["homecoming_remaining"] | 0.0;

  sendControlPacket(packet);
}

void readPythonSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      serialLine[serialLineIndex] = '\0';
      handlePythonLine(serialLine);
      serialLineIndex = 0;
    } else if (c != '\r' && serialLineIndex < sizeof(serialLine) - 1) {
      serialLine[serialLineIndex++] = c;
    } else if (serialLineIndex >= sizeof(serialLine) - 1) {
      serialLineIndex = 0;
      sendStatus("serial_line_overflow");
    }
  }
}

void handleSensorPacket(const uint8_t* data, int length) {
  if (length != sizeof(SensorPacket)) {
    return;
  }

  SensorPacket packet;
  memcpy(&packet, data, sizeof(packet));
  if (packet.type != PACKET_SENSOR) {
    return;
  }

  Serial.printf(
    "{\"type\":\"sensor\",\"people_count\":%u,\"heart_rate\":%u,\"sequence\":%lu}\n",
    packet.peopleCount,
    packet.heartRate,
    (unsigned long)packet.sequence
  );
}

#if ESP_IDF_VERSION_MAJOR >= 5
void onDataRecv(const esp_now_recv_info_t* info, const uint8_t* data, int length) {
  handleSensorPacket(data, length);
}
#else
void onDataRecv(const uint8_t* mac, const uint8_t* data, int length) {
  handleSensorPacket(data, length);
}
#endif

void setupEspNow() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) {
    sendStatus("espnow_init_failed");
    while (true) {
      delay(1000);
    }
  }

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, BROADCAST_MAC, 6);
  peerInfo.channel = ESPNOW_CHANNEL;
  peerInfo.encrypt = false;

  if (!esp_now_is_peer_exist(BROADCAST_MAC)) {
    esp_now_add_peer(&peerInfo);
  }

  esp_now_register_recv_cb(onDataRecv);
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(5);
  setupEspNow();
  sendStatus("ready");
}

void loop() {
  readPythonSerial();
}
