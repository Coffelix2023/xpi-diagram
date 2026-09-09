import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const CONFIG_FILE = ".pi/xpi-diagram.json";
const DEFAULT_CONFIG = {
  preview: true,
} as const;

export interface DiagramConfig {
  preview: boolean;
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
    const preview = (parsed as Record<string, unknown>).preview;
    if (preview !== undefined && typeof preview !== "boolean") {
      throw new Error("preview must be a boolean");
    }
    return {
      trusted: true,
      config: {
        preview: preview ?? true,
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
