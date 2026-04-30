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
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

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

const ENV_FINETUNED_TOOLS = "PIUF_SUPPRESSED_TOOLS";
const ENV_COLLAPSED_VISIBLE_LINES = "PIUF_COLLAPSED_VISIBLE_LINES";
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
}

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

function collapsedHint(
	result: TextResultLike,
	theme: TextTheme,
	visibleLines: number,
): Text {
	if (result.isError) {
		const output = textOutput(result);
		return new Text(output ? `\n${theme.fg("error", output)}` : "", 0, 0);
	}

	const totalLines = countOutputLines(textOutput(result));
	if (totalLines === 0) return new Text("", 0, 0);

	const hiddenLines = Math.max(0, totalLines - visibleLines);
	if (hiddenLines === 0) return new Text("", 0, 0);

	const lineLabel = hiddenLines === 1 ? "line" : "lines";
	return new Text(
		`\n${theme.fg(
			"muted",
			`   ... (${hiddenLines} earlier ${lineLabel}, ctrl+o to expand)`,
		)}`,
		0,
		0,
	);
}

function expandedOutput(result: TextResultLike, theme: TextTheme): Text {
	const output = textOutput(result);
	if (!output) return new Text("", 0, 0);

	const color = result.isError ? "error" : "toolOutput";
	return new Text(
		`\n${output
			.split("\n")
			.map((line) => theme.fg(color, line))
			.join("\n")}`,
		0,
		0,
	);
}

function renderResult(
	result: TextResultLike,
	options: { expanded: boolean },
	theme: TextTheme,
	visibleLines: number,
): Text {
	if (!options.expanded) {
		return collapsedHint(result, theme, visibleLines);
	}

	return expandedOutput(result, theme);
}

// ─── Extension ────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
	await loadDotEnv();

	const finetunedTools = readFinetunedTools();
	const collapsedVisibleLines = readNumberEnv(
		ENV_COLLAPSED_VISIBLE_LINES,
		DEFAULT_COLLAPSED_VISIBLE_LINES,
	);
	const debug = readBooleanEnv(ENV_DEBUG);

	if (debug) {
		console.warn(
			`${LOG_PREFIX} Config: tools=[${[...finetunedTools].join(
				", ",
			)}], collapsedVisibleLines=${collapsedVisibleLines}`,
		);
	}

	if (finetunedTools.has("bash")) {
		const baseTool = createBashToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createBashToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderResult(result, options, theme) {
				return renderResult(result, options, theme, collapsedVisibleLines);
			},
		});
	}

	if (finetunedTools.has("read")) {
		const baseTool = createReadToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createReadToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderResult(result, options, theme) {
				return renderResult(result, options, theme, collapsedVisibleLines);
			},
		});
	}

	if (finetunedTools.has("edit")) {
		const baseTool = createEditToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createEditToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderResult(result, options, theme) {
				return renderResult(result, options, theme, collapsedVisibleLines);
			},
		});
	}

	if (finetunedTools.has("write")) {
		const baseTool = createWriteToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createWriteToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderResult(result, options, theme) {
				return renderResult(result, options, theme, collapsedVisibleLines);
			},
		});
	}

	if (finetunedTools.has("grep")) {
		const baseTool = createGrepToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createGrepToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderResult(result, options, theme) {
				return renderResult(result, options, theme, collapsedVisibleLines);
			},
		});
	}

	if (finetunedTools.has("find")) {
		const baseTool = createFindToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createFindToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderResult(result, options, theme) {
				return renderResult(result, options, theme, collapsedVisibleLines);
			},
		});
	}

	if (finetunedTools.has("ls")) {
		const baseTool = createLsToolDefinition(process.cwd());
		pi.registerTool({
			...baseTool,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				return createLsToolDefinition(ctx.cwd).execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
				);
			},
			renderResult(result, options, theme) {
				return renderResult(result, options, theme, collapsedVisibleLines);
			},
		});
	}
}
