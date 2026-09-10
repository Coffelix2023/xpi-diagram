import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CONFIG_FILE = "xpi-diagram.json";
export const PREVIEW_MODES = [
  "glimpse",
  "browser",
] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];
export const UI_LANGUAGES = [
  "zh-CN",
  "en",
] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
const DEFAULT_CONFIG = {
  language: "zh-CN",
  preview: true,
  previewMode: "glimpse",
} as const;

export interface DiagramConfig {
  language: UiLanguage;
  preview: boolean;
  previewMode: PreviewMode;
}

export interface DiagramConfigResult {
  config: DiagramConfig;
  diagnostic?: string;
}

function configPath(agentDir: string): string {
  return join(resolve(agentDir), CONFIG_FILE);
}

function isPreviewMode(value: unknown): value is PreviewMode {
  return (
    typeof value === "string" && (PREVIEW_MODES as readonly string[]).includes(value)
  );
}

function isUiLanguage(value: unknown): value is UiLanguage {
  return (
    typeof value === "string" && (UI_LANGUAGES as readonly string[]).includes(value)
  );
}

export async function readDiagramConfig(
  agentDir = getAgentDir(),
): Promise<DiagramConfigResult> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath(agentDir), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("configuration must be a JSON object");
    }
    const values = parsed as Record<string, unknown>;
    const language = values.language;
    if (language !== undefined && !isUiLanguage(language)) {
      throw new Error('language must be either "zh-CN" or "en"');
    }
    const preview = values.preview;
    if (preview !== undefined && typeof preview !== "boolean") {
      throw new Error("preview must be a boolean");
    }
    const previewMode = values.previewMode;
    if (previewMode !== undefined && !isPreviewMode(previewMode)) {
      throw new Error('previewMode must be either "glimpse" or "browser"');
    }
    return {
      config: {
        language: language ?? DEFAULT_CONFIG.language,
        preview: preview ?? DEFAULT_CONFIG.preview,
        previewMode: previewMode ?? DEFAULT_CONFIG.previewMode,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        config: {
          ...DEFAULT_CONFIG,
        },
      };
    }
    return {
      diagnostic: `Invalid xpi-diagram configuration: ${(error as Error).message}`,
      config: {
        ...DEFAULT_CONFIG,
      },
    };
  }
}

export async function writeDiagramConfig(
  config: DiagramConfig,
  agentDir = getAgentDir(),
): Promise<void> {
  if (!isUiLanguage(config.language)) {
    throw new Error('language must be either "zh-CN" or "en"');
  }
  if (!isPreviewMode(config.previewMode)) {
    throw new Error('previewMode must be either "glimpse" or "browser"');
  }
  const target = configPath(agentDir);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), {
    recursive: true,
  });
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(
        {
          language: config.language,
          preview: config.preview,
          previewMode: config.previewMode,
        },
        null,
        2,
      )}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    await rename(temporary, target);
  } finally {
    await rm(temporary, {
      force: true,
    });
  }
}

export const diagramConfigPath = (agentDir = getAgentDir()): string =>
  configPath(agentDir);
