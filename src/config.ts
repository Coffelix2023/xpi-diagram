import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const CONFIG_FILE = ".pi/xpi-diagram.json";
export const PREVIEW_MODES = [
  "glimpse",
  "browser",
] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];
const DEFAULT_CONFIG = {
  preview: true,
  previewMode: "glimpse",
} as const;

export interface DiagramConfig {
  preview: boolean;
  previewMode: PreviewMode;
}

export interface DiagramConfigResult {
  config: DiagramConfig;
  diagnostic?: string;
  trusted: boolean;
}

function configPath(projectRoot: string): string {
  const root = resolve(projectRoot);
  const target = join(root, CONFIG_FILE);
  const projectRelative = relative(root, target);
  if (projectRelative.startsWith("..") || projectRelative.startsWith("/")) {
    throw new Error("xpi-diagram configuration escaped the project directory");
  }
  return target;
}

function isPreviewMode(value: unknown): value is PreviewMode {
  return (
    typeof value === "string" && (PREVIEW_MODES as readonly string[]).includes(value)
  );
}

export async function readDiagramConfig(
  projectRoot: string,
  isProjectTrusted = true,
): Promise<DiagramConfigResult> {
  if (!isProjectTrusted) {
    return {
      trusted: false,
      config: {
        ...DEFAULT_CONFIG,
      },
    };
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath(projectRoot), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("configuration must be a JSON object");
    }
    const values = parsed as Record<string, unknown>;
    const preview = values.preview;
    if (preview !== undefined && typeof preview !== "boolean") {
      throw new Error("preview must be a boolean");
    }
    const previewMode = values.previewMode;
    if (previewMode !== undefined && !isPreviewMode(previewMode)) {
      throw new Error('previewMode must be either "glimpse" or "browser"');
    }
    return {
      trusted: true,
      config: {
        preview: preview ?? DEFAULT_CONFIG.preview,
        previewMode: previewMode ?? DEFAULT_CONFIG.previewMode,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        trusted: true,
        config: {
          ...DEFAULT_CONFIG,
        },
      };
    }
    return {
      diagnostic: `Invalid xpi-diagram configuration: ${(error as Error).message}`,
      trusted: true,
      config: {
        ...DEFAULT_CONFIG,
      },
    };
  }
}

export async function writeDiagramConfig(
  projectRoot: string,
  config: DiagramConfig,
  isProjectTrusted = true,
): Promise<void> {
  if (!isProjectTrusted) {
    throw new Error("Cannot write xpi-diagram configuration in an untrusted project");
  }
  if (!isPreviewMode(config.previewMode)) {
    throw new Error('previewMode must be either "glimpse" or "browser"');
  }
  const target = configPath(projectRoot);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), {
    recursive: true,
  });
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(
        {
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

export const diagramConfigPath = configPath;
