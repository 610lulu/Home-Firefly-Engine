# Spiral Firefly v2 - 安装与运行指南

## 1. 硬件装配顺序

### Day 1:骨架
1. 弯底圈(直径 1.2 m,圆环,直径 12 mm 钢丝)
2. 弯螺旋主线(直径 8 mm 钢丝绕 5 圈,总高 3 m)
3. 装 3 根纵向支撑(直径 8 mm × 3.3 m,均布 120°)
4. 弯顶圈 + 立柱(直径 16 mm × 0.3 m)

### Day 2:灯带
1. 螺旋主线外侧,每 30 cm 1 颗灯的位置做标记
2. 灯带沿螺旋主线缠绕,**首尾留 30 cm 飞线**
3. 起点(底部)接 3 芯线(5V/GND/Din)到防水接线盒 #2
4. 终点(顶部)绝缘处理(热缩管)
5. **全灯带通电测试**:接 WLED,全亮 1 分钟,无虚焊

### Day 3:Pi 5 + Camera
1. Pi 5 装系统(Raspberry Pi OS Lite,64-bit)
2. 装 ultralytics + opencv + picamera2
3. Pi Camera V3 Wide 装防水盒,固定在立柱
4. 15 cm 排线 + 防水接头接到防水接线盒 #1

### Day 4:通电
1. 24V 电源接 AC 220V(接漏保)
2. DC-DC 5V/20A 模块给 Pi 5 + WLED + 灯带
3. 共地

### Day 5:配置
1. WLED 配 6 段,测试独立控
2. Pi 5 配 Wi-Fi,固定 IP
3. 跑 YOLO 测试,看画面分 6 区

## 2. 软件启动

### Pi 5 端
```bash
cd ~/spiral-firefly/v2/pi
pip install -r requirements.txt
python main.py
```

### 模拟器(开发者本机)
```bash
cd v2/sim
python3 -m http.server 8080
# 浏览器开 http://localhost:8080
# 按 1-6 切换激活区域(等同 YOLO 输出)
```

### Pi 5 推数据给模拟器
- Pi 5 的 sim_server 监听 `:8765/state.json`
- 模拟器每 200 ms 轮询一次
- 模拟器要能从浏览器访问 Pi 5 的 IP(`fetch('http://<pi-ip>:8765/state.json')`)

## 3. 测试序列

| 测试 | 期望 |
|---|---|
| WLED 段独立控 | 6 段可单独开关、变色、效果 |
| Pi Camera 画面 | 实时出图,无撕裂 |
| YOLO 检测 | 画面框出所有人,控制台输出区域编号 |
| Pi 5 → WLED 链路 | 站在某区,对应段亮 |
| Three.js 模拟 | 浏览器里 3D 螺旋灯段跟着亮 |

## 4. 户外防护要点

- 所有接线用**防水航空插头**或**热缩管 + 防水胶带**
- 灯带必须 **IP65+**,接头处灌胶
- Pi 5 / WLED 必须装**防水盒**
- 24V 电源用**明纬防水版**
- 整机接地(防雷)
- 6 个月清理一次(钢丝骨架、灯带表面)
