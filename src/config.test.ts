import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diagramConfigPath, readDiagramConfig, writeDiagramConfig } from "./config.js";

const CONFIG_DIAGNOSTIC_PATTERN = /preview must be a boolean/;
const PREVIEW_MODE_DIAGNOSTIC_PATTERN =
  /previewMode must be either "glimpse" or "browser"/;
const LANGUAGE_DIAGNOSTIC_PATTERN = /language must be either "zh-CN" or "en"/;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

async function globalDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xpi-diagram-config-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("diagram configuration", () => {
  it("defaults to enabled in Simplified Chinese when no global config exists", async () => {
    const agentDirectory = await globalDirectory();

    await expect(readDiagramConfig(agentDirectory)).resolves.toEqual({
      config: {
        language: "zh-CN",
        preview: true,
        previewMode: "glimpse",
      },
    });
  });

  it("ignores project-local config and reports malformed global values", async () => {
    const agentDirectory = await globalDirectory();
    const project = await globalDirectory();
    await mkdir(join(project, ".pi"), {
      recursive: true,
    });
    await writeFile(
      join(project, ".pi", "xpi-diagram.json"),
      '{"preview":false,"language":"en"}',
      "utf8",
    );
    await writeFile(diagramConfigPath(agentDirectory), '{"preview":"yes"}', "utf8");

    const result = await readDiagramConfig(agentDirectory);

    expect(result.config).toEqual({
      language: "zh-CN",
      preview: true,
      previewMode: "glimpse",
    });
    expect(result.diagnostic).toMatch(CONFIG_DIAGNOSTIC_PATTERN);
  });

  it("accepts English and browser mode", async () => {
    const agentDirectory = await globalDirectory();
    await writeFile(
      diagramConfigPath(agentDirectory),
      '{"language":"en","preview":false,"previewMode":"browser"}',
      "utf8",
    );

    await expect(readDiagramConfig(agentDirectory)).resolves.toEqual({
      config: {
        language: "en",
        preview: false,
        previewMode: "browser",
      },
    });
  });

  it("fails closed for unsupported language and preview mode", async () => {
    const agentDirectory = await globalDirectory();
    await writeFile(
      diagramConfigPath(agentDirectory),
      '{"language":"fr","previewMode":"web"}',
      "utf8",
    );

    const result = await readDiagramConfig(agentDirectory);

    expect(result.config).toEqual({
      language: "zh-CN",
      preview: true,
      previewMode: "glimpse",
    });
    expect(result.diagnostic).toMatch(LANGUAGE_DIAGNOSTIC_PATTERN);
  });

  it("ignores unknown fields while preserving supported values", async () => {
    const agentDirectory = await globalDirectory();
    await writeFile(
      diagramConfigPath(agentDirectory),
      '{"language":"en","preview":false,"previewMode":"browser","futureOption":"ignored"}',
      "utf8",
    );

    await expect(readDiagramConfig(agentDirectory)).resolves.toEqual({
      config: {
        language: "en",
        preview: false,
        previewMode: "browser",
      },
    });
  });

  it("writes only the normalized global config atomically", async () => {
    const agentDirectory = await globalDirectory();

    await writeDiagramConfig(
      {
        language: "en",
        preview: false,
        previewMode: "browser",
      },
      agentDirectory,
    );

    await expect(readFile(diagramConfigPath(agentDirectory), "utf8")).resolves.toBe(
      '{\n  "language": "en",\n  "preview": false,\n  "previewMode": "browser"\n}\n',
    );
  });

  it("rejects an invalid language or mode before writing", async () => {
    const agentDirectory = await globalDirectory();

    await expect(
      writeDiagramConfig(
        {
          language: "fr" as never,
          preview: true,
          previewMode: "glimpse",
        },
        agentDirectory,
      ),
    ).rejects.toThrow(LANGUAGE_DIAGNOSTIC_PATTERN);

    await expect(
      writeDiagramConfig(
        {
          language: "zh-CN",
          preview: true,
          previewMode: "web" as never,
        },
        agentDirectory,
      ),
    ).rejects.toThrow(PREVIEW_MODE_DIAGNOSTIC_PATTERN);
  });
});
