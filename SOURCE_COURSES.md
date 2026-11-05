---
title: 待学习-嵌入式与硬件课程清单
date: 2026-11-05
source: 豆包推荐课单
tags:
  - 科创
  - 待学习
  - STM32
  - 电路
  - FreeRTOS
  - PCB
---

# 待学习课程清单 · 嵌入式 / 硬件补强

> 来源：豆包推荐课单（用户转发整理）  
> 整理日期：2026-11-05（Asia/Taipei）  
> 说明：优先列 B 站可看入口；能找到官方 MOOC / 官网的一并附上。B 站链接对本机 `curl` 常返回 412（反爬），按公开检索保留。

---

## 一、语言与电路基础

### 1. 浙大翁恺 · 程序设计入门——C语言
- 讲师 / 机构：翁恺 · 浙江大学
- 官方（中国大学MOOC）：[程序设计入门——C语言](https://www.icourse163.org/course/ZJU-199001)
- B站（转载完整版，常用）：[BV1ME411h75N](https://www.bilibili.com/video/BV1ME411h75N/) · 另一套 [BV1e7411y7Ky](https://www.bilibili.com/video/BV1e7411y7Ky/)
- 说明：国家精品在线开放课；零基础 C 入门，嵌入式必会。官方以 MOOC 为准，B 站为自学镜像。后续还有《C语言程序设计进阶》。

### 2. 上交大郑益慧 · 模拟电子技术基础
- 讲师 / 机构：郑益慧 · 上海交通大学
- B站（播放量最高、4K 精校常推）：[BV1Gt411b7Zq](https://www.bilibili.com/video/BV1Gt411b7Zq/)
- B站（1080P「最新版」整理）：[BV1Kh4y127ay](https://www.bilibili.com/video/BV1Kh4y127ay/)
- 说明：经典模电公开课，二极管 / BJT / MOS / 放大 / 反馈 / 运放 / 振荡与电源。适合有一点电路基础后再跟；教材多配童诗白、华成英《模拟电子技术基础》。

### 3. 石群 · 《电路》（邱关源）
- 讲师：石群（学校归属公开信息不一；B 站转载常误标「清华」——清华同名公开课常见的是**于歆杰《电路原理》**，勿混）
- 网易公开课（80 集）：[石群《电路》](https://open.163.com/newview/movie/free?pid=PESEP49N5)
- B站（经典完整转载）：[BV1F7411a7iV](https://www.bilibili.com/video/BV1F7411a7iV/) · 4K 修复整理版 [BV1jHLGzDEJe](https://www.bilibili.com/video/BV1jHLGzDEJe/)
- 说明：配套邱关源《电路》第五 / 六版；从基尔霍夫、等效变换讲到相量、三相、二端口等，偏本科电路理论 + 考研。对做科创硬件：**不必全啃**，挑电阻网络、运放电阻电路、一阶暂态、正弦稳态即可。

---

## 二、STM32 / 嵌入式入门

### 4. 铁头山羊 · STM32 入门教程【新版】
- 讲师 / 机构：铁头山羊（B 站 UP）
- B站：[BV11X4y1j7si](https://www.bilibili.com/video/BV11X4y1j7si/)（约 54 集）
- 说明：GPIO / 串口 / I2C / SPI / 中断 / EXTI / 时钟 / 定时器 / ADC；讲解偏底层与封装习惯。另有更长的「第 4 版」系列（如 [BV1pw41187Sy](https://www.bilibili.com/video/BV1pw41187Sy/) 起），入门优先跟【新版】合集即可。

### 5. 江协科技 · STM32 入门教程-2023版
- 讲师 / 机构：江协科技（江科大相关 UP，常称「江科大 STM32」）
- B站：[BV1th411z7sn](https://www.bilibili.com/video/BV1th411z7sn/)（约 50 集 / 33+ 小时，已完结）
- 官网与资料：[jiangxiekeji.com](https://jiangxiekeji.com/) · [资料下载](https://jiangxiekeji.com/download.html)
- 说明：B 站 STM32 零基础最主流之一；标准库手打、带中文字幕，配套套件与疑难解答页。与铁头山羊二选一精学即可（江协更「全基础」，铁头山羊偏模块化讲解）。

---

## 三、FreeRTOS 与网络

### 6. 韦东山 · FreeRTOS 入门与工程实践
- 讲师 / 机构：韦东山 · 百问网
- B站：[BV1Jw411i7Fz](https://www.bilibili.com/video/BV1Jw411i7Fz/)
- 官网专栏：[100ask.net/course/134](https://100ask.net/course/134)
- 说明：基于 STM32、以项目为导向；任务 / 队列 / 信号量 / 互斥 / 事件组 / 任务通知 / 软件定时器。有 ESP32 / MicroPython 基础后再补 RTOS 概念会更顺。

### 7. 正点原子 · 基于 STM32 的 LwIP 网络教学
- 讲师 / 机构：正点原子（ALIENTEK）
- 官方资料页（2023 新版说明）：[openedv · 新版手把手教你学 lwIP](https://www.openedv.com/docs/book-videos/zdyzshipin/4free/newlwIP.html)
- B站官方空间（新版在线入口）：[space/394620890](https://space.bilibili.com/394620890)
- 原子哥平台：[yuanzige.com](https://www.yuanzige.com/)
- B站旧版合集（仍广泛流传）：[BV1zx411d7eC](https://www.bilibili.com/video/BV1zx411d7eC/)
- 说明：以太网 / MAC·PHY、裸机与 RTOS 移植、UDP/TCP、WebServer 等。新版以官方空间 / 原子哥为准；单条 BV 号随上架变动，进空间搜「lwIP」即可。对你做 ESP32 Wi‑Fi/MQTT 教学：可作协议层对照，不必先买正点板。

---

## 四、硬件与 PCB

### 8. 电子Online · 硬件工程师零基础入门
- 讲师 / 机构：B 站 UP「电子online」
- B站：[BV1gHSyY3E6q](https://www.bilibili.com/video/BV1gHSyY3E6q/)（约 125 讲，2024 全新课）
- 说明：从安全、欧姆定律、R/L/C、二极管三极管 MOS、运放、开关电源，到循迹小车与原理图 / PCB 流程；面向零基础硬件岗入门，比纯模电课更「工程向」。

### 9. 凡亿教育 · Altium Designer PCB 设计教程
- 讲师 / 机构：凡亿教育
- B站（AD22/23 新手入门 56 讲，主流）：[BV11a411x75o](https://www.bilibili.com/video/BV11a411x75o/)
- B站（2 层板实战）：[BV1CJ411G7At](https://www.bilibili.com/video/BV1CJ411G7At/)
- 官网课堂：[fanyedu.com](https://www.fanyedu.com/)（站点对本机偶发 5xx，以 B 站免费课为主即可）
- 说明：安装 / 原理图 / 封装 / 布局布线 / 规则 / DRC / Gerber。同名课很多，优先跟「新手入门必备课」这一套；做学生板或教具小板够用。

---

## 建议学习顺序

```
C（翁恺）
  → 电路挑讲（石群：网络/运放/一阶）+ 模电概览（郑益慧前半：器件与放大）
  → STM32 入门（江协 或 铁头山羊，二选一）
  → FreeRTOS（韦东山）
  → LwIP / 网络（正点原子，按需）
并行支线：电子Online（器件与工程感）→ 凡亿 AD（自己画小板）
```

对 **ESP32 + MicroPython + AI 硬件** 主线：C 与 STM32 用来建立「寄存器 / 外设 / 中断」直觉；RTOS 与 LwIP 用来讲清「任务与联网」；模电 / PCB 用来自己改板、带学生看原理图。不必按电类本科把石群 80 集、郑益慧全套啃完。

---

## 可实践改变（面向小学科创 / 教培）

1. **两周 C 突击**：只跟翁恺前 4–5 周（变量、判断、循环、数组、函数），用同一套练习题改写成 MicroPython 对照表，给学生看「语法不同、结构一样」。
2. **STM32 对照课例**：江协 / 铁头山羊里挑 GPIO、PWM、串口、I2C 四节，在 ESP32 上用 MicroPython 复刻同一实验（灯、舵机、串口打印、OLED），做成「双板对照」公开课一节。
3. **FreeRTOS → 异步直觉**：韦东山前几讲（任务与队列）映射到 `asyncio` / 双核 / 回调，解释为什么摄像头 + Wi‑Fi + 按键会卡。
4. **PCB 最小闭环**：凡亿入门 + 电子Online 原理图章节，画一块 ESP32 载板或传感器转接板（2 层），打样后进课堂当教具——比只讲面包板更有「产品感」。

---

## 链接核验备忘（2026-11-05）

| 课程 | 主链接状态 |
|---|---|
| 翁恺 C | MOOC 200；B 站 412（反爬，保留） |
| 郑益慧模电 | B 站 412（保留） |
| 石群电路 | 网易公开课 200；B 站 412 |
| 铁头山羊 / 江协 STM32 | B 站 412；江协官网 200 |
| 韦东山 FreeRTOS | B 站 412；百问网专栏 200 |
| 正点原子 LwIP | openedv / 原子哥 200；B 站空间 412 |
| 电子Online | B 站 412 |
| 凡亿 AD | B 站 412；官网偶发 5xx |

不确定项：
- **石群**具体任职学校未找到权威个人页；以「石群《电路》+ 邱关源」锁定资源即可。
- **正点原子 2023 新版 LwIP** 官方未钉死单一 BV，进官方空间搜「lwIP」；旧版 BV1zx411d7eC 仍可用。

---
