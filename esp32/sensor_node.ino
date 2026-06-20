#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_idf_version.h>

const uint8_t ESPNOW_CHANNEL = 1;
const uint8_t BROADCAST_MAC[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

const uint8_t PACKET_SENSOR = 1;

const bool SIMULATION_MODE = true;
const int HEART_SENSOR_PIN = 34;
const int PEOPLE_SENSOR_PIN = 35;

struct __attribute__((packed)) SensorPacket {
  uint8_t type;
  uint16_t peopleCount;
  uint16_t heartRate;
  uint32_t sequence;
};

unsigned long lastPublishAt = 0;
uint32_t sequence = 0;
int simulatedPeople = 0;
int simulatedHeartRate = 72;

void setupEspNow() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
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
}

int readPeopleCount() {
  if (SIMULATION_MODE) {
    simulatedPeople += random(-1, 3);
    simulatedPeople = constrain(simulatedPeople, 0, 28);
    return simulatedPeople;
  }

  int raw = analogRead(PEOPLE_SENSOR_PIN);
  return map(raw, 0, 4095, 0, 30);
}

int readHeartRate() {
  if (SIMULATION_MODE) {
    simulatedHeartRate += random(-3, 4);
    simulatedHeartRate = constrain(simulatedHeartRate, 55, 125);
    return simulatedHeartRate;
  }

  int raw = analogRead(HEART_SENSOR_PIN);
  return map(raw, 0, 4095, 50, 140);
}

void setup() {
  Serial.begin(115200);
  randomSeed(esp_random());
  setupEspNow();
  Serial.print("sensor mac=");
  Serial.println(WiFi.macAddress());
}

void loop() {
  unsigned long now = millis();
  if (now - lastPublishAt >= 1000) {
    lastPublishAt = now;

    int peopleCount = readPeopleCount();
    int heartRate = readHeartRate();

    SensorPacket packet;
    packet.type = PACKET_SENSOR;
    packet.peopleCount = peopleCount;
    packet.heartRate = heartRate;
    packet.sequence = sequence++;

    esp_err_t result = esp_now_send(
      BROADCAST_MAC,
      (const uint8_t*)&packet,
      sizeof(packet)
    );

    Serial.printf(
      "people_count=%d heart_rate=%d espnow=%s\n",
      peopleCount,
      heartRate,
      result == ESP_OK ? "ok" : "failed"
    );
  }
}
