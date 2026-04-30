# Pi UI Finetune — Tool Output Display Trimmer

English | [中文](./README.zh.md)

A [Pi](https://github.com/badlogic/pi-mono) extension that reduces the collapsed
TUI display for verbose built-in tool results.

## Behavior

The extension re-registers Pi's built-in `read`, `bash`, `edit`, `write`,
`grep`, `find`, and `ls` tools with custom result renderers:

- Collapsed view shows the normal tool call line plus one compact hint.
- Expanded view (`ctrl+o`) still shows the tool result.
- Tool execution and returned content are not replaced with temp-file summaries.

For a long bash result, collapsed display becomes:

```text
$ find /Users/lk/proj/academy-agent-web -type f -name "*.go" | head -30
   ... (25 earlier lines, ctrl+o to expand)
```

## Installation

```bash
pi install npm:pi-ui-finetune
# Then launch pi
pi
```

Or copy `index.ts` to `~/.pi/agent/extensions/` for auto-discovery.

## Configuration

All settings are optional.

```bash
# Tools whose collapsed display should be trimmed.
# Default: all built-in tools: read,bash,edit,write,grep,find,ls
PIUF_SUPPRESSED_TOOLS=read,bash,edit,write,grep,find,ls

# Number of output lines considered visible in Pi's normal collapsed preview.
# The hint reports total output lines minus this number. Default: 5
PIUF_COLLAPSED_VISIBLE_LINES=5

# Enable debug logging (default: false)
PIUF_DEBUG=false
```

The extension also reads these variables from a local `.env` file. Real
environment variables take precedence over `.env` values.

## More Extensions

- [tab-follow-up](https://github.com/lollipopkit/pi-tab-follow-up): Use <kbd>Tab</kbd> instead of <kbd>Alt</kbd>+<kbd>Enter</kbd> to trigger follow-up input.
- [pi-models-metadata](https://github.com/lollipopkit/pi-models-metadata): Register provider models with metadata enrichment.
