import { readFile } from "node:fs/promises";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	ToolExecutionComponent,
} from "@mariozechner/pi-coding-agent";
import {
	type Component,
	visibleWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

// ─── Constants ───────────────────────────────────────────────────

const LOG_PREFIX = "[pi-ui-finetune]";

const DEFAULT_FINETUNED_TOOLS = [
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
];
const DEFAULT_COLLAPSED_VISIBLE_LINES = 5;
const DEFAULT_BASH_PREVIEW_LINES = 3;
const TAB_DISPLAY = "    ";
const NON_MERGE_TOOLS = new Set(["write"]);
const NO_RESULT_DISPLAY_TOOLS = new Set(["read", "ls"]);

const ENV_FINETUNED_TOOLS = "PIUF_SUPPRESSED_TOOLS";
const ENV_COLLAPSED_VISIBLE_LINES = "PIUF_COLLAPSED_VISIBLE_LINES";
const ENV_BASH_PREVIEW_LINES = "PIUF_BASH_PREVIEW_LINES";
const ENV_DEBUG = "PIUF_DEBUG";
const ENV_DOT_ENV = ".env";

// ─── .env loader ─────────────────────────────────────────────────

function parseDotEnvValue(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

async function loadDotEnv(): Promise<void> {
	let content: string;
	try {
		content = await readFile(ENV_DOT_ENV, "utf8");
	} catch {
		return;
	}

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim().replace(/^export\s+/, "");
		if (!line || line.startsWith("#")) continue;

		const equalsIndex = line.indexOf("=");
		if (equalsIndex <= 0) continue;

		const key = line.slice(0, equalsIndex).trim();
		if (!key || process.env[key] !== undefined) continue;

		process.env[key] = parseDotEnvValue(line.slice(equalsIndex + 1));
	}
}

// ─── Env readers ─────────────────────────────────────────────────

function readBooleanEnv(name: string): boolean {
	const rawValue = process.env[name];
	if (!rawValue) return false;

	const value = rawValue.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(value)) return true;
	if (["0", "false", "no", "off"].includes(value)) return false;

	console.warn(`${LOG_PREFIX} Invalid ${name}=${rawValue}; using false.`);
	return false;
}

function readNumberEnv(name: string, defaultValue: number): number {
	const rawValue = process.env[name];
	if (!rawValue) return defaultValue;

	const parsed = Number.parseInt(rawValue, 10);
	if (!Number.isFinite(parsed) || parsed < 0) {
		console.warn(
			`${LOG_PREFIX} Invalid ${name}=${rawValue}; using ${defaultValue}.`,
		);
		return defaultValue;
	}

	return parsed;
}

function readFinetunedTools(): Set<string> {
	const rawValue = process.env[ENV_FINETUNED_TOOLS];
	if (!rawValue) return new Set(DEFAULT_FINETUNED_TOOLS);

	const tools = rawValue
		.split(",")
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);

	return tools.length > 0 ? new Set(tools) : new Set(DEFAULT_FINETUNED_TOOLS);
}

// ─── Renderer helpers ────────────────────────────────────────────

interface TextResultLike {
	content: Array<{
		type: string;
		text?: string;
	}>;
	isError?: boolean;
}

interface TextTheme {
	fg(name: string, text: string): string;
	bold(text: string): string;
}

interface ToolRenderContextLike {
	toolCallId: string;
	invalidate: () => void;
	state: Record<string, unknown>;
	cwd: string;
}

interface ToolGroup {
	toolName: string;
	toolCallIds: string[];
	labels: Map<string, string>;
	invalidates: Map<string, () => void>;
	resultOwnerToolCallId?: string;
}

class HiddenComponent implements Component {
	render(): string[] {
		return [];
	}

	invalidate(): void {}
}

class CompactText implements Component {
	private text: string;
	private readonly paddingTop: boolean;
	private readonly paddingBottom: boolean;

	constructor(
		text: string,
		options: { paddingTop?: boolean; paddingBottom?: boolean } = {},
	) {
		this.text = text;
		this.paddingTop = options.paddingTop ?? false;
		this.paddingBottom = options.paddingBottom ?? false;
	}

	setText(text: string): void {
		this.text = text;
	}

	render(width: number): string[] {
		if (!this.text.trim()) return [];

		const contentWidth = Math.max(1, width - 2);
		const wrappedLines = this.text
			.split("\n")
			.map(normalizeTerminalDisplayLine)
			.flatMap((line) => {
				return hasVisibleText(line) ? wrapTextWithAnsi(line, contentWidth) : [];
			})
			.filter((line) => hasVisibleText(line));
		const renderedLines = wrappedLines.map((line) => {
			const paddedLine = ` ${line}`;
			const paddingNeeded = Math.max(0, width - visibleWidth(paddedLine));
			return `${paddedLine}${" ".repeat(paddingNeeded)}`;
		});
		const emptyLine = " ".repeat(width);
		if (this.paddingTop) renderedLines.unshift(emptyLine);
		if (this.paddingBottom) renderedLines.push(emptyLine);
		return renderedLines;
	}

	invalidate(): void {}
}

function normalizeTerminalDisplayLine(line: string): string {
	return line.split("\t").join(TAB_DISPLAY);
}

function stripAnsi(text: string): string {
	let result = "";
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) !== 27) {
			result += text[i];
			continue;
		}

		const next = text[i + 1];
		if (next === "[") {
			let j = i + 2;
			while (j < text.length && !["m", "G", "K", "H", "J"].includes(text[j])) {
				j++;
			}
			i = j < text.length ? j : i;
			continue;
		}

		if (next === "]" || next === "_") {
			let j = i + 2;
			while (j < text.length) {
				if (text.charCodeAt(j) === 7) {
					i = j;
					break;
				}
				if (text.charCodeAt(j) === 27 && text[j + 1] === "\\") {
					i = j + 1;
					break;
				}
				j++;
			}
			if (j >= text.length) i = text.length;
			continue;
		}

		result += text[i];
	}
	return result;
}

function hasVisibleText(text: string): boolean {
	return stripAnsi(text).trim().length > 0;
}

const hiddenComponent = new HiddenComponent();

let lastToolGroup: ToolGroup | undefined;
const toolGroupsByCallId = new Map<string, ToolGroup>();
let patchedToolExecutionRender = false;

function textOutput(result: TextResultLike): string {
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.filter(Boolean)
		.join("\n")
		.trimEnd();
}

function countOutputLines(output: string): number {
	if (!output) return 0;
	return output.split("\n").length;
}

function nonEmptyOutputLines(output: string): string[] {
	return output.split("\n").filter((line) => line.trim().length > 0);
}

function bashCollapsedPreview(
	result: TextResultLike,
	theme: TextTheme,
	previewLines: number,
): Component {
	const output = textOutput(result);
	if (!output) return hiddenComponent;

	const color = result.isError ? "error" : "toolOutput";
	const lines = nonEmptyOutputLines(output);
	const visibleLines = lines.slice(0, previewLines);
	const hiddenLines = Math.max(0, lines.length - visibleLines.length);
	const renderedLines = visibleLines.map((line) => theme.fg(color, line));
	if (hiddenLines > 0) {
		const lineLabel = hiddenLines === 1 ? "line" : "lines";
		renderedLines.push(
			theme.fg(
				"muted",
				`   ... (${hiddenLines} more ${lineLabel}, ctrl+o to expand)`,
			),
		);
	}

	return new CompactText(renderedLines.join("\n"), { paddingBottom: true });
}

function collapsedHint(
	result: TextResultLike,
	theme: TextTheme,
	visibleLines: number,
): Component {
	if (result.isError) {
		const output = textOutput(result);
		return output
			? new CompactText(theme.fg("error", output), {
					paddingBottom: true,
				})
			: hiddenComponent;
	}

	const totalLines = countOutputLines(textOutput(result));
	if (totalLines === 0) return hiddenComponent;

	const hiddenLines = Math.max(0, totalLines - visibleLines);
	if (hiddenLines === 0) return hiddenComponent;

	const lineLabel = hiddenLines === 1 ? "line" : "lines";
	return new CompactText(
		theme.fg(
			"muted",
			`   ... (${hiddenLines} earlier ${lineLabel}, ctrl+o to expand)`,
		),
		{ paddingBottom: true },
	);
}

function expandedOutput(result: TextResultLike, theme: TextTheme): Component {
	const output = textOutput(result);
	if (!output) return hiddenComponent;

	const color = result.isError ? "error" : "toolOutput";
	return new CompactText(
		output
			.split("\n")
			.map((line) => theme.fg(color, line))
			.join("\n"),
		{ paddingBottom: true },
	);
}

function renderResult(
	result: TextResultLike,
	options: { expanded: boolean },
	theme: TextTheme,
	visibleLines: number,
	toolName?: string,
	bashPreviewLines = DEFAULT_BASH_PREVIEW_LINES,
): Component {
	if (!options.expanded) {
		if (toolName === "bash") {
			return bashCollapsedPreview(result, theme, bashPreviewLines);
		}
		return collapsedHint(result, theme, visibleLines);
	}

	return expandedOutput(result, theme);
}

function resetToolGroups(): void {
	lastToolGroup = undefined;
	toolGroupsByCallId.clear();
}

function patchToolExecutionRender(): void {
	if (patchedToolExecutionRender) return;

	const prototype = ToolExecutionComponent.prototype as unknown as {
		render(width: number): string[];
		_piUiFinetuneOriginalRender?: (width: number) => string[];
		_piUiFinetunePatched?: boolean;
	};
	if (prototype._piUiFinetunePatched) {
		patchedToolExecutionRender = true;
		return;
	}

	const originalRender = prototype.render;
	prototype._piUiFinetuneOriginalRender = originalRender;
	prototype.render = function (
		this: {
			rendererState?: Record<string, unknown>;
		},
		width: number,
	): string[] {
		if (this.rendererState?.piUiFinetuneHidden) {
			return [];
		}

		const lines = originalRender.call(this, width);
		if (!this.rendererState?.piUiFinetuneCompact) {
			return lines;
		}

		if (lines[0]?.trim() === "") {
			return lines.slice(1);
		}
		return lines;
	};
	prototype._piUiFinetunePatched = true;
	patchedToolExecutionRender = true;
}

function notifyGroupChanged(group: ToolGroup, exceptToolCallId?: string): void {
	for (const [toolCallId, invalidate] of group.invalidates) {
		if (toolCallId !== exceptToolCallId) {
			invalidate();
		}
	}
}

function ensureToolGroup(
	toolName: string,
	toolCallId: string,
	label: string,
	invalidate: () => void,
): ToolGroup {
	const existing = toolGroupsByCallId.get(toolCallId);
	if (existing) {
		const previousLabel = existing.labels.get(toolCallId);
		existing.labels.set(toolCallId, label);
		existing.invalidates.set(toolCallId, invalidate);

		if (
			lastToolGroup &&
			lastToolGroup !== existing &&
			lastToolGroup.toolName === toolName &&
			!NON_MERGE_TOOLS.has(toolName)
		) {
			const sourceGroup = existing;
			const targetGroup = lastToolGroup;
			for (const sourceToolCallId of sourceGroup.toolCallIds) {
				if (!targetGroup.toolCallIds.includes(sourceToolCallId)) {
					targetGroup.toolCallIds.push(sourceToolCallId);
				}
				const sourceLabel = sourceGroup.labels.get(sourceToolCallId);
				if (sourceLabel) {
					targetGroup.labels.set(sourceToolCallId, sourceLabel);
				}
				const sourceInvalidate = sourceGroup.invalidates.get(sourceToolCallId);
				if (sourceInvalidate) {
					targetGroup.invalidates.set(sourceToolCallId, sourceInvalidate);
				}
				toolGroupsByCallId.set(sourceToolCallId, targetGroup);
			}
			notifyGroupChanged(targetGroup, toolCallId);
			return targetGroup;
		}

		if (previousLabel !== label) {
			notifyGroupChanged(existing, toolCallId);
		}
		lastToolGroup = existing;
		return existing;
	}

	const canMerge =
		!NON_MERGE_TOOLS.has(toolName) && lastToolGroup?.toolName === toolName;
	const group =
		canMerge && lastToolGroup
			? lastToolGroup
			: {
					toolName,
					toolCallIds: [],
					labels: new Map<string, string>(),
					invalidates: new Map<string, () => void>(),
				};

	group.toolCallIds.push(toolCallId);
	group.labels.set(toolCallId, label);
	group.invalidates.set(toolCallId, invalidate);
	toolGroupsByCallId.set(toolCallId, group);
	lastToolGroup = group;
	notifyGroupChanged(group, toolCallId);

	return group;
}

function trimCwdPrefix(value: string, cwd: string): string {
	if (!value || value === "...") return value;
	if (value === cwd) return ".";

	const normalizedCwd = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
	const prefix = `${normalizedCwd}/`;
	if (value.startsWith(prefix)) {
		return value.slice(prefix.length);
	}

	return value;
}

function toolArgLabel(
	toolName: string,
	args: Record<string, unknown>,
	cwd: string,
): string {
	const stringArg = (name: string): string | undefined => {
		const value = args[name];
		return typeof value === "string" && value.length > 0 ? value : undefined;
	};
	const pathArg = (name: string): string | undefined => {
		const value = stringArg(name);
		return value ? trimCwdPrefix(value, cwd) : undefined;
	};

	switch (toolName) {
		case "bash":
			return stringArg("command") ?? "...";
		case "read": {
			const path = pathArg("file_path") ?? pathArg("path") ?? "...";
			const offset = args.offset;
			const limit = args.limit;
			if (offset !== undefined || limit !== undefined) {
				const startLine = typeof offset === "number" ? offset : 1;
				const endLine =
					typeof limit === "number" ? startLine + limit - 1 : undefined;
				return `${path}:${startLine}${endLine ? `-${endLine}` : ""}`;
			}
			return path;
		}
		case "edit":
		case "write":
			return pathArg("file_path") ?? pathArg("path") ?? "...";
		case "grep":
		case "find":
			return stringArg("pattern") ?? "...";
		case "ls":
			return pathArg("path") ?? ".";
		default:
			return "...";
	}
}

function groupLabel(group: ToolGroup): string {
	return group.toolCallIds
		.map((toolCallId) => group.labels.get(toolCallId))
		.filter((label): label is string => Boolean(label))
		.join(" ");
}

function forceBold(text: string): string {
	return `\x1b[1m${text}\x1b[22m`;
}

function formatToolName(toolName: string, theme: TextTheme): string {
	return theme.fg("toolTitle", forceBold(toolName));
}

function renderGroupedCall(
	toolName: string,
	args: Record<string, unknown>,
	theme: TextTheme,
	context: ToolRenderContextLike,
): Component {
	context.state.piUiFinetuneCompact = true;
	context.state.piUiFinetuneHidden = false;
	context.state.piUiFinetuneToolName = toolName;

	const group = ensureToolGroup(
		toolName,
		context.toolCallId,
		toolArgLabel(toolName, args, context.cwd),
		context.invalidate,
	);

	if (group.toolCallIds[0] !== context.toolCallId) {
		context.state.piUiFinetuneHidden = true;
		return hiddenComponent;
	}

	const label = groupLabel(group);
	const text =
		toolName === "bash"
			? `${formatToolName("$", theme)} ${theme.fg("toolOutput", label || "...")}`
			: `${formatToolName(toolName, theme)}${label ? ` ${theme.fg("toolOutput", label)}` : ""}`;

	return new CompactText(text, {
		paddingTop: true,
		paddingBottom: group.toolCallIds.length > 1,
	});
}

function renderGroupedResult(
	result: TextResultLike,
	options: { expanded: boolean },
	theme: TextTheme,
	visibleLines: number,
	bashPreviewLines: number,
	context: ToolRenderContextLike,
): Component {
	const group = toolGroupsByCallId.get(context.toolCallId);
	const toolName = group?.toolName ?? context.state.piUiFinetuneToolName;
	if (typeof toolName === "string" && NO_RESULT_DISPLAY_TOOLS.has(toolName)) {
		return hiddenComponent;
	}

	if (group) {
		group.resultOwnerToolCallId ??= context.toolCallId;
	}
	if (
		group?.resultOwnerToolCallId !== undefined &&
		group.resultOwnerToolCallId !== context.toolCallId
	) {
		return hiddenComponent;
	}

	return renderResult(
		result,
		options,
		theme,
		visibleLines,
		typeof toolName === "string" ? toolName : undefined,
		bashPreviewLines,
	);
}

// ─── Extension ────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
	await loadDotEnv();
	patchToolExecutionRender();

	const finetunedTools = readFinetunedTools();
	const collapsedVisibleLines = readNumberEnv(
		ENV_COLLAPSED_VISIBLE_LINES,
		DEFAULT_COLLAPSED_VISIBLE_LINES,
	);
	const bashPreviewLines = readNumberEnv(
		ENV_BASH_PREVIEW_LINES,
		DEFAULT_BASH_PREVIEW_LINES,
	);
	const debug = readBooleanEnv(ENV_DEBUG);

	if (debug) {
		console.warn(
			`${LOG_PREFIX} Config: tools=[${[...finetunedTools].join(
				", ",
			)}], collapsedVisibleLines=${collapsedVisibleLines}, bashPreviewLines=${bashPreviewLines}`,
		);
	}

	pi.on("turn_start", () => {
		resetToolGroups();
	});

	if (finetunedTools.has("bash")) {
		const baseTool = createBashToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			renderShell: "self",
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createBashToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderCall(args, theme, context) {
				return renderGroupedCall("bash", args, theme, context);
			},
			renderResult(result, options, theme, context) {
				return renderGroupedResult(
					result,
					options,
					theme,
					collapsedVisibleLines,
					bashPreviewLines,
					context,
				);
			},
		});
	}

	if (finetunedTools.has("read")) {
		const baseTool = createReadToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			renderShell: "self",
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createReadToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderCall(args, theme, context) {
				return renderGroupedCall("read", args, theme, context);
			},
			renderResult(result, options, theme, context) {
				return renderGroupedResult(
					result,
					options,
					theme,
					collapsedVisibleLines,
					bashPreviewLines,
					context,
				);
			},
		});
	}

	if (finetunedTools.has("edit")) {
		const baseTool = createEditToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			renderShell: "self",
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createEditToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderCall(args, theme, context) {
				return renderGroupedCall("edit", args, theme, context);
			},
			renderResult(result, options, theme, context) {
				return renderGroupedResult(
					result,
					options,
					theme,
					collapsedVisibleLines,
					bashPreviewLines,
					context,
				);
			},
		});
	}

	if (finetunedTools.has("write")) {
		const baseTool = createWriteToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			renderShell: "self",
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createWriteToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderCall(args, theme, context) {
				return renderGroupedCall("write", args, theme, context);
			},
			renderResult(result, options, theme, context) {
				return renderGroupedResult(
					result,
					options,
					theme,
					collapsedVisibleLines,
					bashPreviewLines,
					context,
				);
			},
		});
	}

	if (finetunedTools.has("grep")) {
		const baseTool = createGrepToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			renderShell: "self",
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createGrepToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderCall(args, theme, context) {
				return renderGroupedCall("grep", args, theme, context);
			},
			renderResult(result, options, theme, context) {
				return renderGroupedResult(
					result,
					options,
					theme,
					collapsedVisibleLines,
					bashPreviewLines,
					context,
				);
			},
		});
	}

	if (finetunedTools.has("find")) {
		const baseTool = createFindToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			renderShell: "self",
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createFindToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderCall(args, theme, context) {
				return renderGroupedCall("find", args, theme, context);
			},
			renderResult(result, options, theme, context) {
				return renderGroupedResult(
					result,
					options,
					theme,
					collapsedVisibleLines,
					bashPreviewLines,
					context,
				);
			},
		});
	}

	if (finetunedTools.has("ls")) {
		const baseTool = createLsToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			renderShell: "self",
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createLsToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderCall(args, theme, context) {
				return renderGroupedCall("ls", args, theme, context);
			},
			renderResult(result, options, theme, context) {
				return renderGroupedResult(
					result,
					options,
					theme,
					collapsedVisibleLines,
					bashPreviewLines,
					context,
				);
			},
		});
	}
}
