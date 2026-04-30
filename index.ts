import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ToolResultEvent,
} from "@mariozechner/pi-coding-agent";

// ─── Constants ───────────────────────────────────────────────────

const LOG_PREFIX = "[pi-ui-finetune]";

const DEFAULT_SUPPRESSED_TOOLS = ["read", "write"];
const DEFAULT_PREVIEW_LINES = 3;
const DEFAULT_PREVIEW_LINE_MAX_CHARS = 120;
const DEFAULT_MIN_LINES = 4;
const DEFAULT_MIN_CHARS = 500;

const ENV_SUPPRESSED_TOOLS = "PIUF_SUPPRESSED_TOOLS";
const ENV_PREVIEW_LINES = "PIUF_PREVIEW_LINES";
const ENV_PREVIEW_LINE_MAX_CHARS = "PIUF_PREVIEW_LINE_MAX_CHARS";
const ENV_MIN_LINES = "PIUF_MIN_LINES";
const ENV_MIN_CHARS = "PIUF_MIN_CHARS";
const ENV_TEMP_DIR = "PIUF_TEMP_DIR";
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

	const parsed = Number.parseFloat(rawValue);
	if (!Number.isFinite(parsed) || parsed < 0) {
		console.warn(
			`${LOG_PREFIX} Invalid ${name}=${rawValue}; using ${defaultValue}.`,
		);
		return defaultValue;
	}

	return parsed;
}

function readSuppressedTools(): Set<string> {
	const rawValue = process.env[ENV_SUPPRESSED_TOOLS];
	if (!rawValue) return new Set(DEFAULT_SUPPRESSED_TOOLS);

	const tools = rawValue
		.split(",")
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);

	return tools.length > 0 ? new Set(tools) : new Set(DEFAULT_SUPPRESSED_TOOLS);
}

function readTempDir(): string {
	return (
		process.env[ENV_TEMP_DIR] ??
		join(
			process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
			"pi-ui-finetune",
		)
	);
}

// ─── Content summarizer ──────────────────────────────────────────

interface ContentPart {
	type: string;
	text?: string;
}

interface SummarizeConfig {
	previewLines: number;
	previewLineMaxChars: number;
	minLines: number;
	minChars: number;
}

function summarizeContent(
	content: ContentPart[],
	toolName: string,
	config: SummarizeConfig,
	tempDir: string,
	counter: { value: number },
	debug: boolean,
): ContentPart[] {
	return content.map((part) => {
		if (part.type !== "text" || !part.text) return part;

		const text = part.text;
		const lines = text.split("\n");
		const totalLines = lines.length;
		const totalChars = text.length;

		// Small outputs: pass through unchanged
		if (
			totalLines <= config.previewLines + config.minLines &&
			totalChars < config.minChars
		) {
			if (debug) {
				console.warn(
					`${LOG_PREFIX} ${toolName}: passing through small output (${totalLines} lines, ${totalChars} chars)`,
				);
			}
			return part;
		}

		// Build preview
		const previewLines = lines
			.slice(0, config.previewLines)
			.map((l) => l.slice(0, config.previewLineMaxChars));
		const preview = previewLines.join("\n");

		// Save full content to temp file
		const tempFile = join(
			tempDir,
			`${toolName}-${Date.now()}-${counter.value++}.txt`,
		);
		try {
			mkdirSync(tempDir, { recursive: true });
			writeFileSync(tempFile, text, "utf-8");

			const hint =
				totalLines > 20
					? `\nFull content (${totalLines} lines, ${totalChars} chars) saved to: ${tempFile}\nUse read with offset/limit to inspect specific sections.`
					: `\nFull content (${totalLines} lines, ${totalChars} chars) saved to: ${tempFile}`;

			if (debug) {
				console.warn(
					`${LOG_PREFIX} ${toolName}: suppressed ${totalLines} lines → preview + temp file ${tempFile}`,
				);
			}

			return { type: "text" as const, text: `${preview}\n...${hint}` };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(
				`${LOG_PREFIX} Failed to write temp file ${tempFile}: ${message}`,
			);

			// Fallback without temp file
			const hint =
				totalLines > 20
					? `\n(${totalLines} lines, ${totalChars} chars total — use offset/limit to read specific sections)`
					: `\n(${totalLines} lines, ${totalChars} chars total)`;

			return { type: "text" as const, text: `${preview}\n...${hint}` };
		}
	});
}

// ─── Extension ────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
	await loadDotEnv();

	const suppressedTools = readSuppressedTools();
	const previewLines = readNumberEnv(ENV_PREVIEW_LINES, DEFAULT_PREVIEW_LINES);
	const previewLineMaxChars = readNumberEnv(
		ENV_PREVIEW_LINE_MAX_CHARS,
		DEFAULT_PREVIEW_LINE_MAX_CHARS,
	);
	const minLines = readNumberEnv(ENV_MIN_LINES, DEFAULT_MIN_LINES);
	const minChars = readNumberEnv(ENV_MIN_CHARS, DEFAULT_MIN_CHARS);
	const tempDir = readTempDir();
	const debug = readBooleanEnv(ENV_DEBUG);

	// Ensure temp dir exists
	mkdirSync(tempDir, { recursive: true });

	const counter = { value: 0 };

	const config: SummarizeConfig = {
		previewLines,
		previewLineMaxChars,
		minLines,
		minChars,
	};

	if (debug) {
		const toolList = [...suppressedTools].join(", ");
		console.warn(
			`${LOG_PREFIX} Config: suppressedTools=[${toolList}], previewLines=${previewLines}, minLines=${minLines}, minChars=${minChars}, tempDir=${tempDir}`,
		);
	}

	pi.on(
		"tool_result",
		async (
			event: ToolResultEvent,
			_ctx,
		): Promise<undefined | { content?: ToolResultEvent["content"] }> => {
			if (!suppressedTools.has(event.toolName)) return undefined;

			return {
				content: summarizeContent(
					event.content,
					event.toolName,
					config,
					tempDir,
					counter,
					debug,
				) as ToolResultEvent["content"],
			};
		},
	);
}
