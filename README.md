# Home Firefly Engine

Python + ESP32 bridge + ESP-NOW interactive lighting engine. This version removes the MQTT broker and uses one ESP32 as a USB serial / ESP-NOW bridge.

## Architecture

```text
sensor ESP32  -- ESP-NOW -->  bridge ESP32  -- USB Serial -->  Python

Python       -- USB Serial --> bridge ESP32  -- ESP-NOW broadcast --> light ESP32
```

Python still owns the high-level state machine:

- `waiting`
- `pulse`
- `homecoming`

ESP32 light nodes render the actual LED pixels locally from compact control parameters. This avoids sending large per-pixel JSON frames over ESP-NOW.

## Project Structure

```text
Home-Firefly-Engine/
|- main.py
|- config.py
|- state_machine.py
|- espnow_serial.py
|- light_engine.py
|- requirements.txt
|- esp32/
|  |- bridge_node.ino
|  |- sensor_node.ino
|  `- light_node.ino
`- README.md
```

## Runtime Behavior

- Sensor ESP32 sends `people_count` and `heart_rate` to the bridge by ESP-NOW.
- Bridge ESP32 forwards sensor values to Python as newline-delimited serial JSON.
- Python updates the state machine.
- More people increases global brightness.
- Heart rate switches the system into `pulse` and controls a local breathing group.
- If `people_count > 20`, Python triggers `homecoming` for 30 seconds.
- During `homecoming`, light ESP32 nodes render waves that flow by coordinate toward the configured tower coordinate.
- After 30 seconds, Python returns to `waiting`.

## Python Setup

Install the Python dependency:

```bash
pip install -r requirements.txt
```

Or install directly:

```bash
pip install pyserial
```

Set the serial port used by the bridge ESP32. In PowerShell:

```powershell
$env:FIREFLY_SERIAL_PORT = "COM5"
```

Then run:

```bash
python main.py
```

If your Python launcher is `py`, use:

```bash
py -3 main.py
```

## Python Configuration

Edit `config.py` or use environment variables.

| Variable | Default | Meaning |
| --- | --- | --- |
| `FIREFLY_SERIAL_PORT` | `COM3` | USB serial port for bridge ESP32 |
| `FIREFLY_SERIAL_BAUDRATE` | `115200` | Serial baud rate |
| `FIREFLY_FRAME_RATE` | `20` | Python control packet rate |
| `FIREFLY_HOMECOMING_THRESHOLD` | `20` | People count threshold |
| `FIREFLY_HOMECOMING_DURATION` | `30` | Homecoming duration in seconds |
| `FIREFLY_PEOPLE_COUNT_MAX` | `20` | People count that maps to max brightness |
| `FIREFLY_TOWER_X` | `0.5` | Tower X coordinate, normalized 0..1 |
| `FIREFLY_TOWER_Y` | `0.08` | Tower Y coordinate, normalized 0..1 |
| `FIREFLY_PULSE_CENTER_X` | `0.38` | Pulse center X coordinate |
| `FIREFLY_PULSE_CENTER_Y` | `0.62` | Pulse center Y coordinate |
| `FIREFLY_PULSE_RADIUS` | `0.32` | Pulse influence radius |

## ESP32 Setup

Install ESP32 board support in Arduino IDE.

Required libraries:

- `ArduinoJson` for `bridge_node.ino`
- `FastLED` for `light_node.ino`

No Wi-Fi router, MQTT broker, or `PubSubClient` is needed.

All ESP32 sketches must use the same channel:

```cpp
const uint8_t ESPNOW_CHANNEL = 1;
```

### 1. Bridge Node

Open and flash:

```text
esp32/bridge_node.ino
```

The bridge:

- Receives sensor packets by ESP-NOW.
- Prints sensor data to USB serial as JSON.
- Reads Python control JSON from USB serial.
- Broadcasts compact control packets by ESP-NOW to light nodes.

Close Arduino Serial Monitor before running Python, because only one program can own the serial port at a time.

### 2. Sensor Node

Open and flash:

```text
esp32/sensor_node.ino
```

By default:

```cpp
const bool SIMULATION_MODE = true;
```

It publishes changing demo values once per second. To connect real sensors, set:

```cpp
const bool SIMULATION_MODE = false;
```

Then replace:

```cpp
readPeopleCount()
readHeartRate()
```

with your real sensor logic.

### 3. Light Node

Open and flash:

```text
esp32/light_node.ino
```

Set your LED parameters:

```cpp
const uint8_t LED_PIN = 5;
const uint16_t NUM_LEDS = 60;
```

If you have multiple light ESP32 nodes, give each one a different normalized fixture area:

```cpp
const float FIXTURE_OFFSET_X = 0.0;
const float FIXTURE_OFFSET_Y = 0.0;
const float FIXTURE_SCALE_X = 1.0;
const float FIXTURE_SCALE_Y = 1.0;
```

For example, the left half of an installation could use:

```cpp
const float FIXTURE_OFFSET_X = 0.0;
const float FIXTURE_SCALE_X = 0.5;
```

The right half could use:

```cpp
const float FIXTURE_OFFSET_X = 0.5;
const float FIXTURE_SCALE_X = 0.5;
```

## Serial Protocol

Bridge to Python:

```json
{"type":"sensor","people_count":12,"heart_rate":78,"sequence":42}
```

Python to bridge:

```json
{
  "type": "control",
  "frame": 120,
  "state": "pulse",
  "people_count": 12,
  "heart_rate": 78,
  "brightness": 0.632,
  "tower_x": 0.5,
  "tower_y": 0.08,
  "pulse_x": 0.38,
  "pulse_y": 0.62,
  "pulse_radius": 0.32,
  "homecoming_remaining": 0
}
```

The bridge converts this JSON into a small ESP-NOW binary packet before broadcasting to light nodes.

## ESP-NOW Packet Strategy

Sensor packet:

- packet type
- people count
- heart rate
- sequence number

Control packet:

- packet type
- state id
- people count
- heart rate
- frame number
- brightness
- tower coordinate
- pulse center and radius
- homecoming remaining time

This keeps ESP-NOW messages small and avoids fragmented per-pixel frames.

## Startup Order

1. Flash `bridge_node.ino`.
2. Flash `sensor_node.ino`.
3. Flash `light_node.ino`.
4. Plug the bridge ESP32 into the computer.
5. Close Arduino Serial Monitor.
6. Set `FIREFLY_SERIAL_PORT`.
7. Run `python main.py`.

## Calibration Notes

- Change `TOWER_COORD` in `config.py` to move the homecoming target.
- Change `PULSE_CENTER` and `PULSE_RADIUS` in `config.py` to place the heartbeat breathing region.
- Replace the generated grid in `light_node.ino` if you have measured LED coordinates.
- Keep every ESP32 on the same `ESPNOW_CHANNEL`.
