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
|- preview.py
|- web_preview.html
|- requirements.txt
|- layouts/
|  `- example_layout.json
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

To see the control result on the computer while still driving the ESP32 bridge:

```bash
python main.py --preview
```

To test the light logic without any ESP32 connected:

```bash
python main.py --preview-only
```

To preview on a real layout with light labels:

```bash
python main.py --preview-only --preview-layout layouts/example_layout.json --preview-labels
```

To test immediately in a browser without Python, ESP32, or sensor data, open:

```text
web_preview.html
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
| `FIREFLY_PREVIEW_LIGHTS` | `120` | Number of virtual lights in the desktop preview |
| `FIREFLY_PREVIEW_LAYOUT` | empty | JSON layout file for preview coordinates |
| `FIREFLY_PREVIEW_BACKGROUND` | empty | PNG/GIF drawing shown behind the preview lights |
| `FIREFLY_PREVIEW_LABELS` | `0` | Set to `1` to show light labels |
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

## Desktop Preview

The preview window is a local simulator for the light control parameters. It renders a virtual grid of LEDs using the same visual rules as `esp32/light_node.ino`:

- `waiting`: warm firefly flicker
- `pulse`: heartbeat-driven local breathing
- `homecoming`: waves flowing toward the tower coordinate

Run with real ESP32 data and real ESP-NOW output:

```bash
python main.py --preview
```

Run without hardware:

```bash
python main.py --preview-only
```

Run with a labeled layout file:

```bash
python main.py --preview-only --preview-layout layouts/example_layout.json --preview-labels
```

Run with a drawing or floor plan behind the lights:

```bash
python main.py --preview-only --preview-layout layouts/example_layout.json --preview-background path/to/floorplan.png --preview-labels
```

Layout files use normalized coordinates from `0.0` to `1.0`:

```json
{
  "background": "floorplan.png",
  "show_labels": true,
  "lights": [
    {"id": 0, "name": "A01", "x": 0.10, "y": 0.78},
    {"id": 1, "name": "A02", "x": 0.18, "y": 0.72}
  ]
}
```

`id` should match the LED index or fixture channel. `name` is the label shown in the preview. `x` and `y` are positions on the drawing, where `(0, 0)` is top-left and `(1, 1)` is bottom-right.

The preview is useful for tuning `FIREFLY_TOWER_X`, `FIREFLY_TOWER_Y`, `FIREFLY_PULSE_CENTER_X`, `FIREFLY_PULSE_CENTER_Y`, and `FIREFLY_PULSE_RADIUS` before testing on physical LEDs. The layout affects the computer preview; for physical LEDs to match exactly, mirror the same coordinates or fixture areas in `esp32/light_node.ino`.

## Browser Preview

`web_preview.html` is a standalone browser preview for quick testing. It does not require Python, serial, ESP32, or live sensor data.

Open it directly in a browser:

```text
web_preview.html
```

The page starts in demo mode and simulates people count, heart rate, `pulse`, and `homecoming`. You can:

- switch state manually
- move people and heart-rate sliders
- toggle light labels
- load a layout JSON file
- load a drawing image behind the lights

Use the same normalized layout format as `layouts/example_layout.json`.

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
7. Run `python main.py --preview`.

## Calibration Notes

- Change `TOWER_COORD` in `config.py` to move the homecoming target.
- Change `PULSE_CENTER` and `PULSE_RADIUS` in `config.py` to place the heartbeat breathing region.
- Replace the generated grid in `light_node.ino` if you have measured LED coordinates.
- Keep every ESP32 on the same `ESPNOW_CHANNEL`.
