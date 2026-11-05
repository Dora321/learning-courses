// 自动维护：课程数据源。含 ESP32 主线 + 老师补强 9 门。
window.COURSE_DATA = {
  "courses": [
    {
      "id": "esp32-geeksman-mpy",
      "track": "ESP32主线（MicroPython）",
      "title": "ESP32 + MicroPython 系统教程",
      "teacher": "极客侠 / MicroPython 官方",
      "platform": "极客侠文档 / 官方文档",
      "urls": [
        {
          "label": "极客侠文档",
          "url": "https://docs.geeksman.com/esp32/MicroPython/"
        },
        {
          "label": "极客侠系列",
          "url": "https://geeksman.com/series/esp32-micropython/"
        },
        {
          "label": "官方 ESP32 速查",
          "url": "https://docs.micropython.org/en/latest/esp32/quickref.html"
        },
        {
          "label": "固件下载",
          "url": "https://micropython.org/download/ESP32_GENERIC/"
        }
      ],
      "note": "教学主线。配合库内大纲、知识体系与 ESP32-AI科创课程总览。",
      "status": "not_started",
      "progress": 0,
      "order": 1
    },
    {
      "id": "esp32-bemfa-mqtt",
      "track": "ESP32主线（MicroPython）",
      "title": "巴法云 MQTT 与微信推送",
      "teacher": "巴法云 + 自有课例",
      "platform": "巴法文档 / 哔哩哔哩",
      "urls": [
        {
          "label": "巴法 MQTT 文档",
          "url": "https://cloud.bemfa.com/docs/src/mqtt.html"
        },
        {
          "label": "B站示例",
          "url": "https://www.bilibili.com/video/BV1jigHzeEYk/"
        }
      ],
      "note": "物联网实战；对应讲义 L17–L25 与库内「ESP32 + 巴法云 MQTT + 微信推送」。",
      "status": "not_started",
      "progress": 0,
      "order": 2
    },
    {
      "id": "esp32-asyncio-fsm",
      "track": "ESP32主线（MicroPython）",
      "title": "MicroPython 异步与状态机",
      "teacher": "MicroPython 官方 + 自有笔记",
      "platform": "官方文档 / Obsidian",
      "urls": [
        {
          "label": "uasyncio 文档",
          "url": "https://docs.micropython.org/en/latest/library/asyncio.html"
        }
      ],
      "note": "进阶概念；库内有多篇 asyncio/状态机笔记，建议指定一篇总入口后精读。",
      "status": "not_started",
      "progress": 0,
      "order": 3
    },
    {
      "id": "arduino-mindplus",
      "track": "课堂工具",
      "title": "Arduino UNO + Mind+",
      "teacher": "Mind+ / Arduino",
      "platform": "Mind+ 官网",
      "urls": [
        {
          "label": "Mind+ 官网",
          "url": "https://mindplus.cc/"
        }
      ],
      "note": "课堂教具线；配合智慧停车场踩坑笔记。Arduino 入门 BV 待钉。",
      "status": "not_started",
      "progress": 0,
      "order": 4
    },
    {
      "id": "k230-canmv",
      "track": "端侧 AI",
      "title": "K230 CanMV 端侧视觉",
      "teacher": "嘉楠 / CanMV",
      "platform": "哔哩哔哩 / Kendryte 文档",
      "urls": [
        {
          "label": "B站 MicroPython 上手",
          "url": "https://www.bilibili.com/video/BV1BWUUYaEXv/"
        },
        {
          "label": "YOLOv8n 检测示例",
          "url": "https://www.kendryte.com/k230_canmv/zh/main/example/ai/yolov8n_detection.html"
        },
        {
          "label": "AI 推理入门",
          "url": "https://www.kendryte.com/ai_docs/zh/main/快速入门K230_AI推理流程.html"
        },
        {
          "label": "电赛视觉速成",
          "url": "https://www.bilibili.com/video/BV1Z6jJzyEmM/"
        }
      ],
      "note": "端侧视觉；对应讲义 L28–L35 与植物视觉/刷机日志。",
      "status": "not_started",
      "progress": 0,
      "order": 5
    },
    {
      "id": "sim-lab-wokwi",
      "track": "仿真实验室",
      "title": "浏览器仿真与 8 周机器人路线",
      "teacher": "Wokwi / Tinkercad / robotips",
      "platform": "网页工具",
      "urls": [
        {
          "label": "Wokwi",
          "url": "https://wokwi.com"
        },
        {
          "label": "Tinkercad Circuits",
          "url": "https://www.tinkercad.com/circuits"
        },
        {
          "label": "ESP Labs",
          "url": "https://esp-labs-web.vercel.app"
        },
        {
          "label": "robotips 路线",
          "url": "https://robotips.app"
        }
      ],
      "note": "练手与备课演示；详见库内 8 周机器人 3D 交互学习路线笔记。可不计入主线加权。",
      "status": "not_started",
      "progress": 0,
      "order": 6
    },
    {
      "id": "c-wengkai",
      "track": "老师补强 · 语言与电路基础",
      "title": "程序设计入门——C语言",
      "teacher": "翁恺 · 浙江大学",
      "platform": "中国大学 MOOC / 哔哩哔哩",
      "urls": [
        {
          "label": "中国大学 MOOC",
          "url": "https://www.icourse163.org/course/ZJU-199001"
        },
        {
          "label": "B 站完整版",
          "url": "https://www.bilibili.com/video/BV1ME411h75N/"
        },
        {
          "label": "B 站另一套",
          "url": "https://www.bilibili.com/video/BV1e7411y7Ky/"
        }
      ],
      "note": "国家精品在线开放课；零基础 C 入门，嵌入式必会。官方以 MOOC 为准，B 站为自学镜像。后续还有《C语言程序设计进阶》。",
      "status": "not_started",
      "progress": 0,
      "order": 10
    },
    {
      "id": "analog-zheng",
      "track": "老师补强 · 语言与电路基础",
      "title": "模拟电子技术基础",
      "teacher": "郑益慧 · 上海交通大学",
      "platform": "哔哩哔哩",
      "urls": [
        {
          "label": "B 站 4K 版",
          "url": "https://www.bilibili.com/video/BV1Gt411b7Zq/"
        },
        {
          "label": "B 站 1080P 版",
          "url": "https://www.bilibili.com/video/BV1Kh4y127ay/"
        }
      ],
      "note": "经典模电公开课，二极管 / BJT / MOS / 放大 / 反馈 / 运放 / 振荡与电源。适合有一点电路基础后再跟；教材多配童诗白、华成英《模拟电子技术基础》。",
      "status": "not_started",
      "progress": 0,
      "order": 11
    },
    {
      "id": "circuits-shiqun",
      "track": "老师补强 · 语言与电路基础",
      "title": "《电路》（邱关源）",
      "teacher": "石群",
      "platform": "哔哩哔哩 / 网易公开课",
      "urls": [
        {
          "label": "网易公开课 · 80 集",
          "url": "https://open.163.com/newview/movie/free?pid=PESEP49N5"
        },
        {
          "label": "B 站完整版",
          "url": "https://www.bilibili.com/video/BV1F7411a7iV/"
        },
        {
          "label": "B 站 4K 修复版",
          "url": "https://www.bilibili.com/video/BV1jHLGzDEJe/"
        }
      ],
      "note": "配套邱关源《电路》第五 / 六版；从基尔霍夫、等效变换讲到相量、三相、二端口等，偏本科电路理论 + 考研。对做科创硬件：不必全啃，挑电阻网络、运放电阻电路、一阶暂态、正弦稳态即可。 讲师学校归属未确认；勿与于歆杰《电路原理》混淆。",
      "status": "not_started",
      "progress": 0,
      "order": 12
    },
    {
      "id": "stm32-tietou",
      "track": "老师补强 · STM32嵌入式",
      "title": "STM32 入门教程【新版】",
      "teacher": "铁头山羊",
      "platform": "哔哩哔哩",
      "urls": [
        {
          "label": "B 站新版合集",
          "url": "https://www.bilibili.com/video/BV11X4y1j7si/"
        },
        {
          "label": "B 站第 4 版",
          "url": "https://www.bilibili.com/video/BV1pw41187Sy/"
        }
      ],
      "note": "GPIO / 串口 / I2C / SPI / 中断 / EXTI / 时钟 / 定时器 / ADC；讲解偏底层与封装习惯。另有更长的「第 4 版」系列（如 BV1pw41187Sy 起），入门优先跟【新版】合集即可。",
      "status": "not_started",
      "progress": 0,
      "order": 13
    },
    {
      "id": "stm32-jiangxie",
      "track": "老师补强 · STM32嵌入式",
      "title": "STM32 入门教程-2023版",
      "teacher": "江协科技",
      "platform": "哔哩哔哩 / 江协科技",
      "urls": [
        {
          "label": "B 站 2023 版",
          "url": "https://www.bilibili.com/video/BV1th411z7sn/"
        },
        {
          "label": "江协官网",
          "url": "https://jiangxiekeji.com/"
        },
        {
          "label": "配套资料",
          "url": "https://jiangxiekeji.com/download.html"
        }
      ],
      "note": "B 站 STM32 零基础最主流之一；标准库手打、带中文字幕，配套套件与疑难解答页。与铁头山羊二选一精学即可（江协更「全基础」，铁头山羊偏模块化讲解）。",
      "status": "not_started",
      "progress": 0,
      "order": 14
    },
    {
      "id": "freertos-wei",
      "track": "老师补强 · FreeRTOS与网络",
      "title": "FreeRTOS 入门与工程实践",
      "teacher": "韦东山 · 百问网",
      "platform": "哔哩哔哩 / 百问网",
      "urls": [
        {
          "label": "B 站课程",
          "url": "https://www.bilibili.com/video/BV1Jw411i7Fz/"
        },
        {
          "label": "百问网专栏",
          "url": "https://100ask.net/course/134"
        }
      ],
      "note": "基于 STM32、以项目为导向；任务 / 队列 / 信号量 / 互斥 / 事件组 / 任务通知 / 软件定时器。有 ESP32 / MicroPython 基础后再补 RTOS 概念会更顺。",
      "status": "not_started",
      "progress": 0,
      "order": 15
    },
    {
      "id": "lwip-alientek",
      "track": "老师补强 · FreeRTOS与网络",
      "title": "基于 STM32 的 LwIP 网络教学",
      "teacher": "正点原子",
      "platform": "哔哩哔哩 / 正点原子官网 / 原子哥",
      "urls": [
        {
          "label": "官方新版资料",
          "url": "https://www.openedv.com/docs/book-videos/zdyzshipin/4free/newlwIP.html"
        },
        {
          "label": "B 站官方空间",
          "url": "https://space.bilibili.com/394620890"
        },
        {
          "label": "原子哥平台",
          "url": "https://www.yuanzige.com/"
        },
        {
          "label": "B 站旧版合集",
          "url": "https://www.bilibili.com/video/BV1zx411d7eC/"
        }
      ],
      "note": "以太网 / MAC·PHY、裸机与 RTOS 移植、UDP/TCP、WebServer 等。新版以官方空间 / 原子哥为准；单条 BV 号随上架变动，进空间搜「lwIP」即可。对你做 ESP32 Wi‑Fi/MQTT 教学：可作协议层对照，不必先买正点板。",
      "status": "not_started",
      "progress": 0,
      "order": 16
    },
    {
      "id": "hardware-online",
      "track": "老师补强 · 硬件与PCB",
      "title": "硬件工程师零基础入门",
      "teacher": "电子online",
      "platform": "哔哩哔哩",
      "urls": [
        {
          "label": "B 站 · 125 讲",
          "url": "https://www.bilibili.com/video/BV1gHSyY3E6q/"
        }
      ],
      "note": "从安全、欧姆定律、R/L/C、二极管三极管 MOS、运放、开关电源，到循迹小车与原理图 / PCB 流程；面向零基础硬件岗入门，比纯模电课更「工程向」。",
      "status": "not_started",
      "progress": 0,
      "order": 17
    },
    {
      "id": "pcb-fanyi",
      "track": "老师补强 · 硬件与PCB",
      "title": "Altium Designer PCB 设计教程",
      "teacher": "凡亿教育",
      "platform": "哔哩哔哩 / 凡亿课堂",
      "urls": [
        {
          "label": "B 站 AD22/23 入门",
          "url": "https://www.bilibili.com/video/BV11a411x75o/"
        },
        {
          "label": "B 站两层板实战",
          "url": "https://www.bilibili.com/video/BV1CJ411G7At/"
        },
        {
          "label": "凡亿课堂",
          "url": "https://www.fanyedu.com/"
        }
      ],
      "note": "安装 / 原理图 / 封装 / 布局布线 / 规则 / DRC / Gerber。同名课很多，优先跟「新手入门必备课」这一套；做学生板或教具小板够用。",
      "status": "not_started",
      "progress": 0,
      "order": 18
    }
  ],
  "studyPlan": "ESP32 + MicroPython（极客侠）\n  → 巴法 MQTT / 微信推送\n  → asyncio / 状态机（按需）\n并行：Mind+ × Arduino（课堂）· K230 视觉（端侧 AI）· Wokwi 仿真\n选学补强：C → 电路/模电 → STM32（二选一）→ FreeRTOS → LwIP → PCB",
  "studyContext": "主线服务小学 ESP32/MicroPython/AI 硬件课；豆包 9 门是老师电类底子补强，STM32 二选一即可。仿真与 K230 按备课需要点开。"
};
