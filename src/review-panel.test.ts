import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramResult } from "./contracts.js";
import {
  buildReviewPanelHtml,
  DiagramReviewManager,
  validateReviewEvent,
} from "./review-panel.js";
import { readDiagramReviewState } from "./review-state.js";
import { storeDiagramVersion } from "./storage.js";

const temporaryDirectories: string[] = [];

class FakeWindow extends EventEmitter {
  readonly htmlUpdates: string[] = [];
  readonly scripts: string[] = [];
  closeCount = 0;

  close(): void {
    this.closeCount += 1;
  }

  send(script: string): void {
    this.scripts.push(script);
  }

  setHTML(html: string): void {
    this.htmlUpdates.push(html);
  }
}

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
  const directory = await mkdtemp(join(tmpdir(), "xpi-diagram-review-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function context(
  cwd: string,
  mode: ExtensionContext["mode"] = "tui",
  hasUI = true,
  isIdle = true,
): Pick<ExtensionContext, "cwd" | "hasUI" | "mode" | "isIdle"> {
  return {
    cwd,
    hasUI,
    isIdle: () => isIdle,
    mode,
  };
}

function result(diagramId: string, version: number): DiagramResult {
  return {
    diagnostics: [],
    diagramId,
    path: `.pi/diagram/${diagramId}/v${version}.html`,
    previewStatus: "not-attempted",
    simplificationNotes: [],
    type: "architecture",
    validationStatus: "passed",
    version,
  };
}

async function storeVersion(
  project: string,
  diagramId: string,
  marker: string,
): Promise<number> {
  const stored = await storeDiagramVersion(project, {
    diagramId,
    html: `<!doctype html><svg role="img" aria-labelledby="t d" data-diagram-type="architecture"><title id="t">${marker}</title><desc id="d">test</desc><g data-diagram-node="one" /></svg>`,
    type: "architecture",
  });
  return stored.version;
}

async function flushMessages(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
}

describe("DiagramReviewManager capability fallback", () => {
  it.each([
    [
      "headless TUI",
      "tui",
      false,
    ],
    [
      "print mode",
      "print",
      false,
    ],
    [
      "JSON mode",
      "json",
      false,
    ],
  ] as const)("preserves a usable path in %s", async (_name, mode, hasUI) => {
    const project = await projectDirectory();
    await storeVersion(project, "fallback", "fallback");
    const loadGlimpse = vi.fn(async () => null);
    const manager = new DiagramReviewManager(
      {
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      {
        loadGlimpse,
      },
    );
    const diagram = result("fallback", 1);

    const previewStatus = await manager.preview(context(project, mode, hasUI), diagram);

    expect(previewStatus).toBe("unavailable");
    expect(diagram.path).toBe(".pi/diagram/fallback/v1.html");
    expect(await readFile(join(project, diagram.path), "utf8")).toContain("fallback");
    expect(loadGlimpse).not.toHaveBeenCalled();
  });

  it("preserves the artifact when Glimpse is missing", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "missing-glimpse", "saved");
    const manager = new DiagramReviewManager(
      {
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      {
        loadGlimpse: async () => null,
      },
    );

    await expect(
      manager.preview(context(project), result("missing-glimpse", 1)),
    ).resolves.toBe("unavailable");
    await expect(
      readFile(join(project, ".pi/diagram/missing-glimpse/v1.html"), "utf8"),
    ).resolves.toContain("saved");
  });

  it("preserves the artifact when Glimpse fails to start", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "failed-glimpse", "saved");
    const manager = new DiagramReviewManager(
      {
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      {
        loadGlimpse: async () => ({
          open: () => {
            throw new Error("native host unavailable");
          },
        }),
      },
    );

    await expect(
      manager.preview(context(project), result("failed-glimpse", 1)),
    ).resolves.toBe("failed");
    await expect(
      readFile(join(project, ".pi/diagram/failed-glimpse/v1.html"), "utf8"),
    ).resolves.toContain("saved");
  });
});

describe("review panel document", () => {
  it("renders diagram HTML in a script-disabled sandbox and escapes inline data", () => {
    const payload =
      "</script><script>window.__diagram_payload_executed__ = true</script>";
    const html = buildReviewPanelHtml({
      artifactHtml: `<svg><text>${payload}</text></svg>`,
      confirmedVersion: null,
      currentVersion: 1,
      diagramId: "safe-id",
      selectedVersion: 1,
      availableVersions: [
        1,
      ],
    });

    expect(html).toContain('<iframe id="diagram-frame" sandbox=""');
    expect(html).not.toContain(payload);
    expect(html).toContain("window.glimpse.send");
    expect(html).toContain('sendAction("confirm")');
    expect(html).toContain('sendAction("request_changes")');
    expect(html).toContain('sendAction("submit_feedback"');
    expect(html).toContain('sendAction("select_version")');
    expect(html).toContain('sendAction("close")');
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain(":focus-visible");
  });

  it("isolates zoom to the diagram and keeps feedback scrollable above the footer", () => {
    const html = buildReviewPanelHtml({
      artifactHtml: "<svg></svg>",
      confirmedVersion: null,
      currentVersion: 1,
      diagramId: "layout-test",
      selectedVersion: 1,
      availableVersions: [
        1,
      ],
    });

    expect(html).toContain(
      ".feedback { display: none; flex: none; min-height: 0; max-height: 40%; overflow: auto;",
    );
    expect(html).toContain(".footer { justify-content: flex-end;");
    expect(html).toContain("frame.style.zoom = String(zoom)");
    expect(html).not.toContain("document.body.style.zoom");
    expect(html).toContain("Math.min(1.5, Math.max(.8");
    expect(html).toContain("setZoom(1); });");
  });

  it("waits for confirmation and returns the review decision", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "await-review", "version one");
    const window = new FakeWindow();
    const manager = new DiagramReviewManager(
      {
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      {
        readyTimeoutMs: 100,
        loadGlimpse: async () => ({
          open: () => {
            setImmediate(() => window.emit("ready", {}));
            return window;
          },
        }),
      },
    );
    const preview = manager.preview(context(project), result("await-review", 1), true);
    let settled = false;
    void preview.then(() => {
      settled = true;
    });

    await flushMessages();
    expect(settled).toBe(false);
    window.emit("message", {
      action: "confirm",
      diagramId: "await-review",
      version: 1,
    });

    await expect(preview).resolves.toEqual({
      status: "confirmed",
      version: 1,
    });
  });

  it("releases waiting reviews on close, cancellation, and replacement", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "lifecycle", "version one");
    const window = new FakeWindow();
    const manager = new DiagramReviewManager(
      {
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      {
        readyTimeoutMs: 100,
        loadGlimpse: async () => ({
          open: () => {
            setImmediate(() => window.emit("ready", {}));
            return window;
          },
        }),
      },
    );

    const first = manager.preview(context(project), result("lifecycle", 1), true);
    await flushMessages();
    await storeVersion(project, "lifecycle", "version two");
    const second = manager.preview(context(project), result("lifecycle", 2), true);
    await expect(first).resolves.toEqual({
      status: "superseded",
      version: 1,
    });

    const controller = new AbortController();
    const third = manager.preview(
      context(project),
      result("lifecycle", 2),
      true,
      controller.signal,
    );
    await expect(second).resolves.toEqual({
      status: "superseded",
      version: 2,
    });
    controller.abort();
    await expect(third).resolves.toEqual({
      status: "cancelled",
      version: 2,
    });

    const closed = manager.preview(context(project), result("lifecycle", 2), true);
    await flushMessages();
    window.emit("message", {
      action: "close",
      diagramId: "lifecycle",
      version: 1,
    });
    await expect(closed).resolves.toEqual({
      status: "closed",
      version: 2,
    });
  });

  it("releases a waiting review when the host shuts down or the window errors", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "shutdown-review", "version one");
    const shutdownWindow = new FakeWindow();
    const shutdownManager = new DiagramReviewManager(
      {
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      {
        readyTimeoutMs: 100,
        loadGlimpse: async () => ({
          open: () => {
            setImmediate(() => shutdownWindow.emit("ready", {}));
            return shutdownWindow;
          },
        }),
      },
    );
    const shutdown = shutdownManager.preview(
      context(project),
      result("shutdown-review", 1),
      true,
    );
    await flushMessages();
    shutdownManager.closeAll();
    await expect(shutdown).resolves.toEqual({
      status: "cancelled",
      version: 1,
    });

    await storeVersion(project, "error-review", "version one");
    const errorWindow = new FakeWindow();
    const errorManager = new DiagramReviewManager(
      {
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      {
        readyTimeoutMs: 100,
        loadGlimpse: async () => ({
          open: () => {
            setImmediate(() => errorWindow.emit("ready", {}));
            return errorWindow;
          },
        }),
      },
    );
    const failed = errorManager.preview(
      context(project),
      result("error-review", 1),
      true,
    );
    await flushMessages();
    errorWindow.emit("error", new Error("window crashed"));
    await expect(failed).resolves.toEqual({
      status: "failed",
      version: 1,
    });
  });

  it("keeps a waiting review open when persistence fails and accepts one retry", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "retry-review", "version one");
    const window = new FakeWindow();
    let failWrites = false;
    const writeReviewState = vi.fn(async () => {
      if (failWrites) throw new Error("disk full");
    });
    const manager = new DiagramReviewManager(
      {
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      {
        readyTimeoutMs: 100,
        loadGlimpse: async () => ({
          open: () => {
            setImmediate(() => window.emit("ready", {}));
            return window;
          },
        }),
        writeReviewState,
      },
    );
    const preview = manager.preview(context(project), result("retry-review", 1), true);
    await flushMessages();
    failWrites = true;
    window.emit("message", {
      action: "confirm",
      diagramId: "retry-review",
      version: 1,
    });
    window.emit("message", {
      action: "confirm",
      diagramId: "retry-review",
      version: 1,
    });
    await flushMessages();
    expect(window.scripts.at(-1)).toContain("Review could not be saved");

    failWrites = false;
    window.emit("message", {
      action: "confirm",
      diagramId: "retry-review",
      version: 1,
    });
    await expect(preview).resolves.toEqual({
      status: "confirmed",
      version: 1,
    });
  });
});

describe("review event validation", () => {
  const review = {
    availableVersions: new Set([
      1,
      2,
    ]),
    currentVersion: 2,
    diagramId: "checkout-flow",
    selectedVersion: 2,
  };

  it("rejects unknown actions", () => {
    expect(
      validateReviewEvent(
        {
          action: "execute_diagram_text",
          diagramId: "checkout-flow",
          version: 2,
        },
        review,
      ),
    ).toMatchObject({
      code: "invalid-event",
      ok: false,
    });
  });

  it("rejects oversized feedback", () => {
    expect(
      validateReviewEvent(
        {
          action: "submit_feedback",
          diagramId: "checkout-flow",
          feedback: "x".repeat(4_001),
          version: 2,
        },
        review,
      ),
    ).toMatchObject({
      code: "invalid-event",
      ok: false,
    });
  });

  it("rejects stale mutations without changing review context", () => {
    const before = {
      ...review,
      availableVersions: new Set(review.availableVersions),
    };
    expect(
      validateReviewEvent(
        {
          action: "confirm",
          diagramId: "checkout-flow",
          version: 1,
        },
        review,
      ),
    ).toMatchObject({
      code: "stale-version",
      ok: false,
    });
    expect(review.currentVersion).toBe(before.currentVersion);
    expect(review.selectedVersion).toBe(before.selectedVersion);
    expect([
      ...review.availableVersions,
    ]).toEqual([
      ...before.availableVersions,
    ]);
  });

  it("accepts navigation to an existing historical version", () => {
    expect(
      validateReviewEvent(
        {
          action: "select_version",
          diagramId: "checkout-flow",
          version: 1,
        },
        review,
      ),
    ).toMatchObject({
      ok: true,
    });
  });

  it("allows closing while a historical version is selected", () => {
    expect(
      validateReviewEvent(
        {
          action: "close",
          diagramId: "checkout-flow",
          version: 1,
        },
        review,
      ),
    ).toMatchObject({
      ok: true,
    });
  });
});

describe("review panel session", () => {
  it("reuses one window, persists review state, and routes only feedback", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "live-review", "version one");
    const window = new FakeWindow();
    const open = vi.fn((_html: string, _options: Record<string, unknown>) => {
      setImmediate(() =>
        window.emit("ready", {
          appearance: {
            accentColor: "#123456",
            darkMode: true,
            increaseContrast: false,
            reduceMotion: false,
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

    await expect(
      manager.preview(context(project), result("live-review", 1)),
    ).resolves.toBe("opened");
    const firstPanelHtml = window.htmlUpdates.at(-1);
    await storeVersion(project, "live-review", "version two");
    await expect(
      manager.preview(context(project), result("live-review", 2)),
    ).resolves.toBe("opened");

    expect(open).toHaveBeenCalledTimes(1);
    expect(window.htmlUpdates.at(-1)).not.toBe(firstPanelHtml);

    expect(open).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        height: 600,
        title: "Diagram live-review",
        width: 800,
      }),
    );
    expect(open.mock.calls[0]?.[1]).not.toHaveProperty("frameless");
    expect(open.mock.calls[0]?.[1]).not.toHaveProperty("transparent");
    window.emit("message", {
      action: "confirm",
      diagramId: "live-review",
      version: 1,
    });
    await flushMessages();
    expect(
      (await readDiagramReviewState(project, "live-review"))?.confirmedVersion,
    ).toBeNull();

    window.emit("message", {
      action: "confirm",
      diagramId: "live-review",
      version: 2,
    });
    await flushMessages();
    expect(
      (await readDiagramReviewState(project, "live-review"))?.confirmedVersion,
    ).toBe(2);
    expect(sendUserMessage).not.toHaveBeenCalled();

    window.emit("message", {
      action: "submit_feedback",
      diagramId: "live-review",
      feedback: "Increase the database label contrast.",
      version: 2,
    });
    await flushMessages();
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Diagram live-review v2 review feedback:"),
    );
    expect(
      (await readDiagramReviewState(project, "live-review"))?.latestFeedback,
    ).toMatchObject({
      status: "sent",
      version: 2,
    });

    window.emit("message", {
      action: "close",
      diagramId: "live-review",
      version: 2,
    });
    await flushMessages();
    expect(window.closeCount).toBe(1);
    expect(
      (await readDiagramReviewState(project, "live-review"))?.confirmedVersion,
    ).toBe(2);
  });
  it("steers standalone feedback while the host is busy", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "busy-review", "version one");
    const window = new FakeWindow();
    const sendUserMessage = vi.fn();
    const manager = new DiagramReviewManager(
      {
        sendUserMessage,
      } as unknown as ExtensionAPI,
      {
        readyTimeoutMs: 100,
        loadGlimpse: async () => ({
          open: () => {
            setImmediate(() => window.emit("ready", {}));
            return window;
          },
        }),
      },
    );
    await expect(
      manager.preview(context(project, "tui", true, false), result("busy-review", 1)),
    ).resolves.toBe("opened");

    window.emit("message", {
      action: "submit_feedback",
      diagramId: "busy-review",
      feedback: "Move the cache boundary.",
      version: 1,
    });
    await flushMessages();

    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Diagram busy-review v1 review feedback:"),
      {
        deliverAs: "steer",
      },
    );
  });
});
