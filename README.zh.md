# Pi UI Finetune

[English](./README.md) | 中文

一个 [Pi](https://github.com/badlogic/pi-mono) 扩展，用于精简内置工具结果在 TUI
折叠态下的显示内容。

## 截图

![效果](./docs/media/effect.png)

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

# bash 折叠态提示前显示的输出行数。默认：3
PIUF_BASH_PREVIEW_LINES=3

# 启用调试日志（默认：false）
PIUF_DEBUG=false
```

扩展也会读取当前目录下的 `.env` 文件。真实环境变量优先级高于 `.env`。

## 更多插件

- [tab-follow-up](https://github.com/lollipopkit/pi-tab-follow-up/blob/main/README.zh.md): 使用 <kbd>Tab</kbd> 而不是 <kbd>Alt</kbd>+<kbd>Enter</kbd> 来触发跟进输入。
- [pi-models-metadata](https://github.com/lollipopkit/pi-models-metadata): 自动同步远端的模型列表+模型的元数据(上下文大小/多模态等等)
