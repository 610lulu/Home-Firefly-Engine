# Spiral Firefly v2 — 运行条件

## 1. Pi 5 真机端(Python)

**系统:** Raspberry Pi OS Bookworm 64-bit (Debian 12)

**Python:** 3.11+ (Bookworm 默认 3.11)

### 安装
```bash
sudo apt update
sudo apt install -y python3-pip python3-venv python3-opencv
cd v2/pi/
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Python 依赖(pi/requirements.txt)
| 包 | 版本 | 用途 |
|---|---|---|
| ultralytics | >= 8.0.0 | YOLOv8n 模型推理 |
| opencv-python | >= 4.8.0 | 图像预处理/标注(可选) |
| picamera2 | >= 0.3.12 | Pi Camera V3 采集 |
| requests | >= 2.31.0 | HTTP POST WLED |
| pyyaml | >= 6.0 | 配置解析 |
| numpy | >= 1.24.0 | bbox 数组处理 |

### 资源
- YOLOv8n 模型权重:`yolov8n.pt`(6 MB,首次运行自动下载)
- RAM:推荐 Pi 5 4GB 起步
- 存储:MicroSD 32GB(Raspbian + 模型 + 缓存)

---

## 2. 模拟器(浏览器端)

**无需 Python**,纯静态文件。

### 启动
```bash
cd v2/sim/
python3 -m http.server 8888
# 浏览器打开 http://localhost:8888
```

### 浏览器要求
- Chrome 110+ / Firefox 110+ / Edge 110+
- WebGL 2.0 支持
- 屏幕 ≥ 1280×720(推荐 1920×1080)

### 第三方库(已本地化)
- `three.module.js` (1.3 MB) → `v2/sim/vendor/`
- `OrbitControls.js` (30 KB) → `v2/sim/vendor/addons/`
- **完全离线可用**,不需要 CDN

---

## 3. 开发环境(本机 WSL)

**OS:** Ubuntu 24.04 / Windows 11 + WSL2

### Python 工具链
- Python 3.12.3(系统)
- pip 24.0+
- 无需 venv(本地不部署)

### 启动模拟器
```bash
cd /mnt/h/Home-Firefly-Engine/v2/sim
python3 -m http.server 8888
```

### 浏览器调试
- F12 → Console:看 `[hc] t=... h=...` 日志(开启 `window.__fireflyDebug = true`)
- F12 → Network:看 8765 端口 WebSocket 状态(未启用可忽略)
- F12 → Performance:看 FPS(目标 30+)

---

## 4. 硬件接口

### Pi 5 GPIO(默认不用)
- 仅 CSI 接口接 Pi Camera V3(排线)
- 不直接驱动 LED(WLED 板负责)
- USB-C 供电 5V/5A

### WLED 控制器(ESP32)
- GPIO 16:WS2812B Din(数据线,绿/白/红三色线缆)
- 5V/20A 电源:红线(+) + 黑线(-)
- WiFi:连接局域网,IP 由 DHCP 分配

### Pi Camera V3 Wide
- IMX708 传感器,102° 视场角
- MIPI CSI-2 排线(15-pin × 1mm 间距)
- 对焦:固定(广角镜头,景深足够)

---

## 5. 网络

| 设备 | IP | 端口 | 协议 |
|---|---|---|---|
| WLED 控制器 | 192.168.1.50 | 80 | HTTP GET/POST |
| Pi 5(可选 WebSocket 服务) | 192.168.1.100 | 8765 | WebSocket |
| 开发机(模拟器) | localhost | 8888 | HTTP |

**修改 IP:** 编辑 `pi/config.yaml` 的 `wled.ip` 字段。

---

## 6. 系统依赖(户外部署用)

```bash
# Pi Camera
sudo apt install -y libcamera-apps python3-picamera2

# GPIO/I2C(可选,留作扩展)
sudo apt install -y python3-gpiozero python3-smbus2

# 防火墙(开放 WLED HTTP 端口,如需要外部访问)
sudo ufw allow from 192.168.1.0/24 to any port 80
```

---

## 7. 验证清单

启动模拟器后,在浏览器确认:

- [ ] 主视图显示 3m 高螺旋装置
- [ ] 顶部能看到横梁 + Pi Camera + 夹具
- [ ] 地面 3 圈距离感应圈虚线
- [ ] + 1 人按钮,胶囊人立起来
- [ ] 人数 > 33 时,自动触发 homecoming(10 秒波带秀)
- [ ] 🎆 Homecoming 按钮可以手动触发
- [ ] 🎨 显示段编号,6 段不同色
- [ ] 📷 Pi 视角 → 俯视同心圆

控制台(F12 → Console):
- [ ] 无 ERR 红条
- [ ] 1 个 canvas 元素
- [ ] `window.__fireflyState` 能查到家状态(可选)