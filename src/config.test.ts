import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDiagramConfig, writeDiagramConfig } from "./config.js";

const CONFIG_DIAGNOSTIC_PATTERN = /preview must be a boolean/;
const TRUST_PATTERN = /untrusted/i;
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

async function projectDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xpi-diagram-config-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("diagram configuration", () => {
  it("defaults to enabled when no project config exists", async () => {
    const project = await projectDirectory();

    await expect(readDiagramConfig(project)).resolves.toEqual({
      trusted: true,
      config: {
        preview: true,
      },
    });
  });

  it("uses defaults and reports malformed or unsupported config values", async () => {
    const project = await projectDirectory();
    await mkdir(join(project, ".pi"), {
      recursive: true,
    });
    await writeFile(join(project, ".pi-config.json"), "{}", "utf8");
    await writeFile(
      join(project, ".pi", "xpi-diagram.json"),
      '{"preview":"yes"}',
      "utf8",
    );

    const result = await readDiagramConfig(project);
    expect(result.config).toEqual({
      preview: true,
    });
    expect(result.diagnostic).toMatch(CONFIG_DIAGNOSTIC_PATTERN);
  });

  it("ignores unknown fields while preserving supported values", async () => {
    const project = await projectDirectory();
    await mkdir(join(project, ".pi"), {
      recursive: true,
    });
    await writeFile(
      join(project, ".pi", "xpi-diagram.json"),
      '{"preview":false,"futureOption":"ignored"}',
      "utf8",
    );

    await expect(readDiagramConfig(project)).resolves.toEqual({
      trusted: true,
      config: {
        preview: false,
      },
    });
  });

  it("does not apply or write project config when the project is untrusted", async () => {
    const project = await projectDirectory();

    await expect(readDiagramConfig(project, false)).resolves.toEqual({
      trusted: false,
      config: {
        preview: true,
      },
    });
    await expect(
      writeDiagramConfig(
        project,
        {
          preview: false,
        },
        false,
      ),
    ).rejects.toThrow(TRUST_PATTERN);
  });

  it("writes only the normalized config atomically", async () => {
    const project = await projectDirectory();

    await writeDiagramConfig(project, {
      preview: false,
    });

    await expect(
      readFile(join(project, ".pi", "xpi-diagram.json"), "utf8"),
    ).resolves.toBe('{\n  "preview": false\n}\n');
  });
});
