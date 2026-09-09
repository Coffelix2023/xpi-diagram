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

const FEEDBACK_MESSAGE_PATTERN = /live-review[\s\S]*v2[\s\S]*database label contrast/;
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
): Pick<ExtensionContext, "cwd" | "hasUI" | "mode"> {
  return {
    cwd,
    hasUI,
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
});

describe("review panel session", () => {
  it("reuses one window, persists review state, and routes only feedback", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "live-review", "version one");
    const window = new FakeWindow();
    const open = vi.fn(() => {
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
      expect.stringMatching(FEEDBACK_MESSAGE_PATTERN),
      {
        deliverAs: "followUp",
      },
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
});
