# Pi UI Finetune — Tool Output Suppressor

English | [中文](./README.zh.md)

A [Pi](https://github.com/badlogic/pi-mono) extension that suppresses verbose
tool output from `read` and `write` operations to reduce LLM context pollution.

## Problem

When Pi reads or writes large files, the full content is sent back to the LLM,
consuming valuable context window tokens. For a 1000-line file, this can waste
thousands of tokens on content the model doesn't need to see in full.

## Solution

This extension hooks into the `tool_result` event and replaces large `read` /
`write` tool outputs with a compact summary:

- **Small outputs** pass through unchanged (≤ 7 lines AND < 500 chars)
- **Larger outputs** are replaced with:
  - A preview of the first 3 lines (truncated to 120 chars each)
  - Line count and character count
  - A temp file path containing the full content (LLM can use `read` with
    `offset`/`limit` to inspect specific sections)

## Installation

```bash
pi install npm:pi-ui-finetune
# Then launch pi
pi
```

Or copy `index.ts` to `~/.pi/agent/extensions/` for auto-discovery.

## Configuration

All settings are optional and use sensible defaults.

```bash
# Which tools to suppress (comma-separated, default: read,write)
PIUF_SUPPRESSED_TOOLS=read,write

# Max preview lines shown before truncation (default: 3)
PIUF_PREVIEW_LINES=3

# Max chars per preview line (default: 120)
PIUF_PREVIEW_LINE_MAX_CHARS=120

# Skip suppression when output is under this many lines (default: 4)
PIUF_MIN_LINES=4

# Skip suppression when output is under this many chars (default: 500)
PIUF_MIN_CHARS=500

# Directory for temp files storing full content (default: system temp dir)
PIUF_TEMP_DIR=/tmp/pi-hide

# Enable debug logging (default: false)
PIUF_DEBUG=false
```

The extension also reads these variables from a local `.env` file. Real
environment variables take precedence over `.env` values.

## Example

**Before** (full 100-line file piped into LLM context):

```
1: import { createHash } from "node:crypto";
2: import { mkdir, readFile, writeFile } from "node:fs/promises";
3: import { homedir } from "node:os";
...100 more lines...
```

**After** (compact summary):

```
1: import { createHash } from "node:crypto";
2: import { mkdir, readFile, writeFile } from "node:fs/promises";
3: import { homedir } from "node:os";
...
Full content (100 lines, 4521 chars) saved to: /tmp/pi-hide-Hk2m/read-1714539600000-0.txt
Use read with offset/limit to inspect specific sections.
```

## More Extensions

- [tab-follow-up](https://github.com/lollipopkit/pi-tab-follow-up): Use <kbd>Tab</kbd> instead of <kbd>Alt</kbd>+<kbd>Enter</kbd> to trigger follow-up input.
- [pi-models-metadata](https://github.com/lollipopkit/pi-models-metadata): Register provider models with metadata enrichment.