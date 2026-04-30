# Pi UI Finetune — 工具输出压缩器

[English](./README.md) | 中文

一个 [Pi](https://github.com/badlogic/pi-mono) 扩展，抑制 `read` 和 `write` 工具的冗长输出，减少 LLM 上下文污染。

## 问题

当 Pi 读取或写入大文件时，完整内容会发送回 LLM，消耗宝贵的上下文窗口 token。对于 1000 行的文件，这可能会在模型不需要完整查看的内容上浪费数千 token。

## 解决方案

本扩展通过 `tool_result` 事件钩子，将大型 `read` / `write` 工具输出替换为紧凑摘要：

- **小输出**直接透传（≤ 7 行 且 < 500 字符）
- **大输出**替换为：
  - 前 3 行预览（每行截断至 120 字符）
  - 行数和字符数统计
  - 包含完整内容的临时文件路径（LLM 可以使用 `read` 的 `offset`/`limit` 参数查看特定段落）

## 安装

```bash
pi install npm:pi-ui-finetune
# 然后启动 pi
pi
```

或者将 `index.ts` 复制到 `~/.pi/agent/extensions/` 自动发现。

## 配置

所有设置均可选，使用合理默认值。

```bash
# 要抑制的工具（逗号分隔，默认：read,write）
PIUF_SUPPRESSED_TOOLS=read,write

# 截断前显示的最大预览行数（默认：3）
PIUF_PREVIEW_LINES=3

# 每条预览行的最大字符数（默认：120）
PIUF_PREVIEW_LINE_MAX_CHARS=120

# 输出不超过此行数时跳过抑制（默认：4）
PIUF_MIN_LINES=4

# 输出不超过此字符数时跳过抑制（默认：500）
PIUF_MIN_CHARS=500

# 存储完整内容的临时文件目录（默认：系统临时目录）
PIUF_TEMP_DIR=/tmp/pi-hide

# 启用调试日志（默认：false）
PIUF_DEBUG=false
```

扩展也会读取当前目录下的 `.env` 文件。真实环境变量优先级高于 `.env`。

## 示例

**之前**（100 行文件完整灌入 LLM 上下文）：

```
1: import { createHash } from "node:crypto";
2: import { mkdir, readFile, writeFile } from "node:fs/promises";
3: import { homedir } from "node:os";
...还有 100 行...
```

**之后**（紧凑摘要）：

```
1: import { createHash } from "node:crypto";
2: import { mkdir, readFile, writeFile } from "node:fs/promises";
3: import { homedir } from "node:os";
...
Full content (100 lines, 4521 chars) saved to: /tmp/pi-hide-Hk2m/read-1714539600000-0.txt
Use read with offset/limit to inspect specific sections.
```

## 更多插件

- [tab-follow-up](https://github.com/lollipopkit/pi-tab-follow-up/blob/main/README.zh.md): 使用 <kbd>Tab</kbd> 而不是 <kbd>Alt</kbd>+<kbd>Enter</kbd> 来触发跟进输入。
- [pi-models-metadata](https://github.com/lollipopkit/pi-models-metadata): 注册 provider 模型并增强元数据。