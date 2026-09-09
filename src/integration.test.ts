import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDiagramTool } from "./diagram-tool.js";
import { DiagramReviewManager } from "./review-panel.js";
import { readDiagramReviewState } from "./review-state.js";

class FakeWindow extends EventEmitter {
  readonly htmlUpdates: string[] = [];
  closeCount = 0;

  close(): void {
    this.closeCount += 1;
  }

  send(_script: string): void {}

  setHTML(html: string): void {
    this.htmlUpdates.push(html);
  }
}

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
  const directory = await mkdtemp(join(tmpdir(), "xpi-diagram-integration-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function diagramHtml(marker: string): string {
  return `<!doctype html><html><body><svg role="img" aria-labelledby="diagram-title diagram-desc" data-diagram-type="architecture"><title id="diagram-title">${marker}</title><desc id="diagram-desc">Architecture smoke test</desc><g data-diagram-node="app" /></svg></body></html>`;
}

interface TuiToolContext {
  cwd: string;
  hasUI: true;
  isProjectTrusted: () => boolean;
  mode: "tui";
  ui: {
    notify: () => void;
  };
}

function tuiContext(cwd: string): TuiToolContext {
  return {
    cwd,
    hasUI: true,
    mode: "tui",
    isProjectTrusted: () => true,
    ui: {
      notify: vi.fn(),
    },
  };
}

describe("TUI diagram generation smoke test", () => {
  it("persists versions, opens one preview, confirms, feeds back, and updates it", async () => {
    const project = await projectDirectory();
    const window = new FakeWindow();
    const open = vi.fn(() => {
      setImmediate(() =>
        window.emit("ready", {
          appearance: {
            darkMode: true,
          },
        }),
      );
      return window;
    });
    const sendUserMessage = vi.fn();
    const manager = new DiagramReviewManager(
      {
        sendUserMessage,
      } as unknown as ExtensionAPI,
      {
        readyTimeoutMs: 100,
        loadGlimpse: async () => ({
          open,
        }),
      },
    );
    const tools: Array<Record<string, unknown>> = [];
    registerDiagramTool(
      {
        on: () => undefined,
        registerTool: (tool: Record<string, unknown>) => tools.push(tool),
        sendUserMessage,
      } as unknown as ExtensionAPI,
      manager,
    );
    const tool = tools[0];
    if (!tool) throw new Error("create_diagram was not registered");
    const execute = tool.execute as (
      id: string,
      params: Record<string, unknown>,
      signal: undefined,
      onUpdate: undefined,
      context: ReturnType<typeof tuiContext>,
    ) => Promise<{
      details: Record<string, unknown>;
    }>;
    const context = tuiContext(project);

    const first = await execute(
      "smoke-v1",
      {
        diagramId: "smoke",
        html: diagramHtml("v1"),
        type: "architecture",
      },
      undefined,
      undefined,
      context,
    );
    const second = await execute(
      "smoke-v2",
      {
        diagramId: "smoke",
        html: diagramHtml("v2"),
        type: "architecture",
      },
      undefined,
      undefined,
      context,
    );

    expect(first.details).toMatchObject({
      path: ".pi/diagram/smoke/v1.html",
      previewStatus: "opened",
      validationStatus: "passed",
      version: 1,
    });
    expect(second.details).toMatchObject({
      path: ".pi/diagram/smoke/v2.html",
      previewStatus: "opened",
      validationStatus: "passed",
      version: 2,
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(
      await readFile(join(project, ".pi/diagram/smoke/v1.html"), "utf8"),
    ).toContain("v1");
    expect(
      await readFile(join(project, ".pi/diagram/smoke/v2.html"), "utf8"),
    ).toContain("v2");
    expect(window.htmlUpdates).toHaveLength(1);
    expect(window.htmlUpdates.at(-1)).toContain("v2");

    window.emit("message", {
      action: "confirm",
      diagramId: "smoke",
      version: 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await readDiagramReviewState(project, "smoke"))?.confirmedVersion).toBe(2);
    expect(sendUserMessage).not.toHaveBeenCalled();

    window.emit("message", {
      action: "submit_feedback",
      diagramId: "smoke",
      feedback: "Show the cache boundary.",
      version: 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Diagram smoke v2 review feedback:"),
      {
        deliverAs: "followUp",
      },
    );

    window.emit("message", {
      action: "select_version",
      diagramId: "smoke",
      version: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.htmlUpdates.at(-1)).toContain("v1");
  });
});
