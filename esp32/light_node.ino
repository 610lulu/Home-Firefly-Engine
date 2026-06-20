#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_idf_version.h>
#include <FastLED.h>

const uint8_t ESPNOW_CHANNEL = 1;
const uint8_t LED_PIN = 5;
const uint16_t NUM_LEDS = 60;
const uint8_t GLOBAL_BRIGHTNESS = 220;
const uint16_t RENDER_INTERVAL_MS = 33;
const uint16_t CONTROL_TIMEOUT_MS = 3000;

const float FIXTURE_OFFSET_X = 0.0;
const float FIXTURE_OFFSET_Y = 0.0;
const float FIXTURE_SCALE_X = 1.0;
const float FIXTURE_SCALE_Y = 1.0;

const uint8_t PACKET_CONTROL = 2;
const uint8_t STATE_WAITING = 0;
const uint8_t STATE_PULSE = 1;
const uint8_t STATE_HOMECOMING = 2;
const float TAU = 6.28318530718;

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

CRGB leds[NUM_LEDS];
ControlPacket currentControl = {
  PACKET_CONTROL,
  STATE_WAITING,
  0,
  0,
  0,
  0.08,
  0.5,
  0.08,
  0.38,
  0.62,
  0.32,
  0.0
};

unsigned long lastControlAt = 0;
unsigned long lastRenderAt = 0;

float clampf(float value, float lower, float upper) {
  return max(lower, min(upper, value));
}

float mixf(float a, float b, float amount) {
  return a + (b - a) * amount;
}

float distancef(float ax, float ay, float bx, float by) {
  float dx = ax - bx;
  float dy = ay - by;
  return sqrtf(dx * dx + dy * dy);
}

void ledPosition(uint16_t id, float* x, float* y) {
  uint16_t columns = ceil(sqrt((float)NUM_LEDS));
  uint16_t rows = ceil((float)NUM_LEDS / columns);
  uint16_t row = id / columns;
  uint16_t column = id % columns;

  float localX = columns <= 1 ? 0.5 : (float)column / (float)(columns - 1);
  float localY = rows <= 1 ? 0.5 : (float)row / (float)(rows - 1);

  *x = FIXTURE_OFFSET_X + localX * FIXTURE_SCALE_X;
  *y = FIXTURE_OFFSET_Y + localY * FIXTURE_SCALE_Y;
}

float maxTowerDistance(const ControlPacket& packet) {
  float maxDistance = 0.001;
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    float x;
    float y;
    ledPosition(i, &x, &y);
    maxDistance = max(maxDistance, distancef(x, y, packet.towerX, packet.towerY));
  }
  return maxDistance;
}

void setScaledLed(uint16_t id, uint8_t r, uint8_t g, uint8_t b, float brightness) {
  brightness = clampf(brightness, 0.0, 1.0);
  leds[id] = CRGB(
    (uint8_t)(r * brightness),
    (uint8_t)(g * brightness),
    (uint8_t)(b * brightness)
  );
}

void renderWaiting(uint16_t id, float baseBrightness, float seconds) {
  float flicker = 0.92 + 0.08 * sinf(seconds * 1.7 + id * 0.61);
  setScaledLed(id, 255, 176, 72, baseBrightness * flicker);
}

void renderPulse(uint16_t id, const ControlPacket& packet, float baseBrightness, float seconds) {
  float x;
  float y;
  ledPosition(id, &x, &y);

  float heartRate = clampf(packet.heartRate, 40.0, 180.0);
  float beatFrequency = heartRate / 60.0;
  float breath = 0.5 - 0.5 * cosf(seconds * beatFrequency * TAU);
  breath = breath * breath;

  float pulseDistance = distancef(x, y, packet.pulseX, packet.pulseY);
  float pulseInfluence = clampf(1.0 - pulseDistance / packet.pulseRadius, 0.0, 1.0);
  float localPulse = breath * pulseInfluence;
  float flicker = 0.9 + 0.1 * sinf(seconds * 1.3 + id * 0.47);
  float brightness = clampf(baseBrightness * flicker + localPulse * 0.55, 0.0, 1.0);

  uint8_t red = 255;
  uint8_t green = (uint8_t)mixf(176, 66, localPulse);
  uint8_t blue = (uint8_t)mixf(72, 122, localPulse);
  setScaledLed(id, red, green, blue, brightness);
}

void renderHomecoming(uint16_t id, const ControlPacket& packet, float baseBrightness, float seconds, float maxDistance) {
  float x;
  float y;
  ledPosition(id, &x, &y);

  float distanceToTower = distancef(x, y, packet.towerX, packet.towerY);
  float normalizedDistance = distanceToTower / maxDistance;
  float flowPhase = fmodf(normalizedDistance * 3.5 + seconds * 0.72, 1.0);
  float wave = 1.0 - min(flowPhase, 1.0 - flowPhase) * 2.0;
  wave = powf(max(0.0f, wave), 2.7);

  float towerGlow = powf(1.0 - normalizedDistance, 1.7);
  float brightness = clampf(baseBrightness * 0.48 + wave * 0.78 + towerGlow * 0.35, 0.0, 1.0);
  float flowMix = clampf(wave + towerGlow * 0.55, 0.0, 1.0);

  uint8_t red = (uint8_t)mixf(255, 118, flowMix);
  uint8_t green = (uint8_t)mixf(176, 224, flowMix);
  uint8_t blue = (uint8_t)mixf(72, 255, flowMix);
  setScaledLed(id, red, green, blue, brightness);
}

void renderLights() {
  ControlPacket packet = currentControl;
  float seconds = millis() / 1000.0;
  float baseBrightness = clampf(packet.brightness, 0.0, 1.0);

  if (millis() - lastControlAt > CONTROL_TIMEOUT_MS) {
    baseBrightness *= 0.25;
  }

  float maxDistance = maxTowerDistance(packet);
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    if (packet.state == STATE_HOMECOMING) {
      renderHomecoming(i, packet, baseBrightness, seconds, maxDistance);
    } else if (packet.state == STATE_PULSE) {
      renderPulse(i, packet, baseBrightness, seconds);
    } else {
      renderWaiting(i, baseBrightness, seconds);
    }
  }

  FastLED.show();
}

void handleControlPacket(const uint8_t* data, int length) {
  if (length != sizeof(ControlPacket)) {
    return;
  }

  ControlPacket packet;
  memcpy(&packet, data, sizeof(packet));
  if (packet.type != PACKET_CONTROL) {
    return;
  }

  currentControl = packet;
  lastControlAt = millis();
}

#if ESP_IDF_VERSION_MAJOR >= 5
void onDataRecv(const esp_now_recv_info_t* info, const uint8_t* data, int length) {
  handleControlPacket(data, length);
}
#else
void onDataRecv(const uint8_t* mac, const uint8_t* data, int length) {
  handleControlPacket(data, length);
}
#endif

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

  esp_now_register_recv_cb(onDataRecv);
}

void setup() {
  Serial.begin(115200);
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(GLOBAL_BRIGHTNESS);
  FastLED.clear(true);

  setupEspNow();
  lastControlAt = millis();
  Serial.print("light mac=");
  Serial.println(WiFi.macAddress());
}

void loop() {
  unsigned long now = millis();
  if (now - lastRenderAt >= RENDER_INTERVAL_MS) {
    lastRenderAt = now;
    renderLights();
  }
}
