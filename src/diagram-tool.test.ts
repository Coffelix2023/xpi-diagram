import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { registerDiagramTool } from "./diagram-tool.js";

const FAILED_PATTERN = /failed/i;
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
  const directory = await mkdtemp(join(tmpdir(), "xpi-diagram-tool-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function validHtml(payload: string): string {
  return `<!doctype html><html><body><svg role="img" aria-labelledby="bounded-title bounded-desc" data-diagram-type="architecture"><title id="bounded-title">Bounded result</title><desc id="bounded-desc">Architecture diagram used to test bounded output.</desc><g data-diagram-node="one"><text>${payload}</text></g></svg></body></html>`;
}

describe("create_diagram result", () => {
  it("returns bounded metadata without echoing large HTML", async () => {
    const tools: Array<Record<string, unknown>> = [];
    const pi = {
      on: () => undefined,
      registerTool: (tool: Record<string, unknown>) => tools.push(tool),
      sendUserMessage: () => undefined,
    } as unknown as ExtensionAPI;
    registerDiagramTool(pi);
    const tool = tools[0];
    if (!tool) {
      throw new Error("create_diagram was not registered");
    }
    const project = await projectDirectory();
    const payload = "x".repeat(200_000);
    const html = validHtml(payload);
    const execute = tool.execute as (
      id: string,
      params: Record<string, unknown>,
      signal: undefined,
      onUpdate: undefined,
      context: {
        cwd: string;
        hasUI: boolean;
        mode: "print";
      },
    ) => Promise<{
      content: Array<{
        text: string;
      }>;
      details: Record<string, unknown>;
    }>;

    const result = await execute(
      "call-1",
      {
        diagramId: "bounded-result",
        html,
        type: "architecture",
        simplificationNotes: [
          "Merged two equivalent workers.",
        ],
      },
      undefined,
      undefined,
      {
        cwd: project,
        hasUI: false,
        mode: "print",
      },
    );

    expect(result.details).toMatchObject({
      diagnostics: [],
      diagramId: "bounded-result",
      path: ".pi/diagram/bounded-result/v1.html",
      previewStatus: "unavailable",
      type: "architecture",
      validationStatus: "passed",
      version: 1,
      simplificationNotes: [
        "Merged two equivalent workers.",
      ],
    });
    const content = result.content[0];
    if (!content) {
      throw new Error("create_diagram returned no content");
    }
    expect(content.text.length).toBeLessThan(1_000);
    expect(JSON.stringify(result.content)).not.toContain(payload);
    expect(
      await readFile(
        join(project, ".pi", "diagram", "bounded-result", "v1.html"),
        "utf8",
      ),
    ).toBe(html);
  });

  it("returns actionable validation metadata without storing unsafe HTML", async () => {
    const tools: Array<Record<string, unknown>> = [];
    const pi = {
      on: () => undefined,
      registerTool: (tool: Record<string, unknown>) => tools.push(tool),
      sendUserMessage: () => undefined,
    } as unknown as ExtensionAPI;
    registerDiagramTool(pi);
    const tool = tools[0];
    if (!tool) {
      throw new Error("create_diagram was not registered");
    }
    const project = await projectDirectory();
    const execute = tool.execute as (
      id: string,
      params: Record<string, unknown>,
      signal: undefined,
      onUpdate: undefined,
      context: {
        cwd: string;
        hasUI: boolean;
        mode: "print";
      },
    ) => Promise<{
      content: Array<{
        text: string;
      }>;
      details: Record<string, unknown>;
    }>;

    const result = await execute(
      "call-2",
      {
        diagramId: "unsafe-result",
        html: validHtml("safe").replace(
          "</svg>",
          '<script src="https://evil.example/x.js"></script></svg>',
        ),
        type: "architecture",
      },
      undefined,
      undefined,
      {
        cwd: project,
        hasUI: false,
        mode: "print",
      },
    );

    expect(result.details).toMatchObject({
      diagramId: "unsafe-result",
      previewStatus: "not-attempted",
      validationStatus: "failed",
      version: null,
    });
    const content = result.content[0];
    if (!content) {
      throw new Error("create_diagram returned no content");
    }
    expect(content.text).toMatch(FAILED_PATTERN);
    await expect(
      readFile(join(project, ".pi", "diagram", "unsafe-result", "v1.html"), "utf8"),
    ).rejects.toThrow();
  });
});
