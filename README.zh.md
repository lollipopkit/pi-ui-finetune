# Pi UI Finetune — 工具输出显示精简器

[English](./README.md) | 中文

一个 [Pi](https://github.com/badlogic/pi-mono) 扩展，用于精简内置工具结果在 TUI
折叠态下的显示内容。

## 行为

扩展会用自定义 result renderer 重新注册 Pi 内置的 `read`、`bash`、`edit`、`write`、`grep`、`find`、`ls` 工具：

- 折叠态只显示正常的工具调用行，以及一行紧凑提示。
- 展开态（`ctrl+o`）仍可查看工具结果。
- 不再把工具返回内容替换为临时文件摘要。

对于较长的 bash 输出，折叠态会变成：

```text
$ find /Users/lk/proj/academy-agent-web -type f -name "*.go" | head -30
   ... (25 earlier lines, ctrl+o to expand)
```

## 安装

```bash
pi install npm:pi-ui-finetune
# 然后启动 pi
pi
```

或者将 `index.ts` 复制到 `~/.pi/agent/extensions/` 自动发现。

## 配置

所有设置均可选。

```bash
# 需要精简折叠态显示的工具。
# 默认：所有内置工具：read,bash,edit,write,grep,find,ls
PIUF_SUPPRESSED_TOOLS=read,bash,edit,write,grep,find,ls

# 按 Pi 默认折叠预览会显示的输出行数计算提示数量。
# 提示中的 earlier lines = 总输出行数 - 此值。默认：5
PIUF_COLLAPSED_VISIBLE_LINES=5

# 启用调试日志（默认：false）
PIUF_DEBUG=false
```

扩展也会读取当前目录下的 `.env` 文件。真实环境变量优先级高于 `.env`。

## 更多插件

- [tab-follow-up](https://github.com/lollipopkit/pi-tab-follow-up/blob/main/README.zh.md): 使用 <kbd>Tab</kbd> 而不是 <kbd>Alt</kbd>+<kbd>Enter</kbd> 来触发跟进输入。
- [pi-models-metadata](https://github.com/lollipopkit/pi-models-metadata): 注册 provider 模型并增强元数据。
