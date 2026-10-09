# dsh-bubble-fold

[![npm version](https://img.shields.io/npm/v/dsh-bubble-fold.svg)](https://www.npmjs.com/package/dsh-bubble-fold)
[![npm downloads](https://img.shields.io/npm/dm/dsh-bubble-fold.svg)](https://www.npmjs.com/package/dsh-bubble-fold)
[![test](https://github.com/FiVE0016/dsh-bubble-fold/actions/workflows/test.yml/badge.svg)](https://github.com/FiVE0016/dsh-bubble-fold/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/dsh-bubble-fold.svg)](LICENSE)

给 DSH 会话加一层"阅读优先"的折叠：**最新一轮永远是展开的，历史消息与工作步骤自动收起来**，想看细节点一下就回来。

```sh
dsh plugin --profile desktop add dsh-bubble-fold
```

> English — A display-only plugin for DeepSeek Harness: the newest turn always stays open, while older messages and every run of work-step rows fold into one click.

![默认状态：历史折起、步骤收成一条折叠缝、最新一轮保持展开](assets/step-fold-default.png)

## 功能

### 消息

- **最新一轮永远展开** —— 你正在读的那条输入和那条回复，再长也不折，也不给按钮。
- **历史消息自动收起** —— 超出预算就折成几行 + 淡出：用户输入 6 行、助手回复 10 行（行数可调）。
- 折叠的消息下方有一个气泡胶囊键：`▾ 展开我的输入 · 还有 12 行` / `▾ 展开全文 · 还有 30 行`，展开后变成 `▴ 收起`。只影响这一条。
- **正在流式输出的回复不折** —— 等这一轮结束再说。
- **短消息不折** —— 只有真的超出预算才折，不会给每条消息都塞一个按钮。
- **轮次自动交接** —— 新的一轮开始时，上一轮从"最新"退成"历史"，它的长消息随即折起。

### 工作步骤

- **两段消息之间的整串步骤收成一个折叠缝** —— 位置在最后一个步骤行与下面那条回复之间，是一条横线上的圆形气泡键。
- **一次折一整串** —— 这串步骤如果横跨了好几轮对话（连续自动续跑、中间没有回复），也是一个键全部折起。
- **默认就是收起的**，最新那一轮也收起；悬停提示会写明折了多少步。
- **下面还没有回复时不出现**（这一轮还在跑），等回复落地再补上。
- **不会留死按钮** —— 宿主那一行不能折叠时，折叠缝直接不出现。
- **尊重你的手动操作** —— 你点开过的那一段，不会被再次自动收起。

### 输入框

- 输入框顶部有一条拖拽手柄：**向上拖变高、向下拖变矮**，双击恢复默认高度 336px。
- 设置面板里也能直接填高度数值，或按 `Ctrl + Shift + ↑ / ↓` 每次微调 40px。

### 快捷键

| 快捷键 | 效果 |
|---|---|
| `Ctrl + Shift + B` | 停用 / 启用插件 |
| `Ctrl + Shift + ,` | 打开设置面板（点外部或 `Esc` 关闭） |
| `Ctrl + Shift + ↑ / ↓` | 输入框高度 ±40px |

### 设置项

`Ctrl + Shift + ,` 打开，改动即时生效。

| 项 | 默认 |
|---|---|
| 启用插件 | 开 |
| 最新一轮保持展开 | 开 |
| 折叠我的输入 / 我的输入保留行数 | 开 / 6 |
| 折叠助手回复 / 助手回复保留行数 | 开 / 10 |
| 全部消息都折叠 / 折叠后保留行数 | 关 / 3 |
| 淡出与按钮留白 (px) | 34 |
| 步骤区与回复之间加折叠按钮 | 开 |
| 步骤默认收起 | 开 |
| 输入框可拖动调高 / 输入框高度 | 开 / 336 |

### 边界

纯显示层：只改界面显示，不写会话日志、不改模型输入、不碰上下文注入与系统提示词卡，也不影响宿主原生的步骤折叠与右缘导航。关掉开关或卸载，界面立刻回到原生状态。

![展开后：整串步骤原样回来](assets/step-fold-expanded.png)

## 安装

从 npm 安装（推荐）：

```sh
dsh plugin --profile desktop add dsh-bubble-fold
```

把 `desktop` 换成你的 profile 名（网页版是 `web`），也可以在 **设置 → 插件** 里手动填包名安装。

不想走 npm 时，也可以直接从 GitHub 安装：

```sh
dsh plugin --profile desktop add 'github:FiVE0016/dsh-bubble-fold#v0.9.1'
```

装完**重启宿主**（`dsh web` 或桌面版）：host 半与客户端 bundle 都只在启动时加载。

MIT License
