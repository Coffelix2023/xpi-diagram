import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findLatestDiagram, storeDiagramVersion } from "./storage.js";

const UNSAFE_ID_PATTERN = /safe diagram ID/i;

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
  const directory = await mkdtemp(join(tmpdir(), "xpi-diagram-storage-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("storeDiagramVersion", () => {
  it("stores sequential versions below the project boundary without overwriting", async () => {
    const project = await projectDirectory();
    const first = await storeDiagramVersion(project, {
      diagramId: "checkout-flow",
      html: "<html>v1</html>",
      type: "sequence",
    });
    const second = await storeDiagramVersion(project, {
      diagramId: "checkout-flow",
      html: "<html>v2</html>",
      type: "sequence",
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(await readFile(first.path, "utf8")).toBe("<html>v1</html>");
    expect(await readFile(second.path, "utf8")).toBe("<html>v2</html>");
    expect(relative(project, first.path)).toBe(".pi/diagram/checkout-flow/v1.html");
  });

  it.each([
    "../escape",
    "nested/id",
    "UPPER",
    "bad id",
    "-",
  ])("rejects unsafe ID %j", async (diagramId) => {
    const project = await projectDirectory();
    await expect(
      storeDiagramVersion(project, {
        diagramId,
        html: "<html></html>",
        type: "architecture",
      }),
    ).rejects.toThrow(UNSAFE_ID_PATTERN);
  });

  it("does not overwrite an existing version file", async () => {
    const project = await projectDirectory();
    const first = await storeDiagramVersion(project, {
      diagramId: "stable",
      html: "original",
      type: "architecture",
    });
    const files = await readdir(join(project, ".pi", "diagram", "stable"));

    expect(files).toContain("v1.html");
    expect(await readFile(first.path, "utf8")).toBe("original");
  });

  it("keeps project root paths from escaping through a symlinked project directory", async () => {
    const project = await projectDirectory();
    const result = await storeDiagramVersion(project, {
      diagramId: "safe",
      html: "content",
      type: "architecture",
    });

    expect(result.path.startsWith(join(project, ".pi", "diagram"))).toBe(true);
  });

  it("finds the highest-version saved diagram", async () => {
    const project = await projectDirectory();
    await storeDiagramVersion(project, {
      diagramId: "latest",
      html: "v1",
      type: "architecture",
    });
    await storeDiagramVersion(project, {
      diagramId: "latest",
      html: "v2",
      type: "architecture",
    });

    await expect(findLatestDiagram(project)).resolves.toMatchObject({
      diagramId: "latest",
      version: 2,
    });
  });
});
