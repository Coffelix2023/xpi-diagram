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
    expect(html).not.toContain("window.glimpse.send");
    expect(html).not.toContain('sendAction("confirm")');
    expect(html).not.toContain('data-i18n="confirmAndClose"');
    expect(html).not.toContain('sendAction("submit_feedback"');
    expect(html).not.toContain('sendAction("request_changes")');
    expect(html).not.toContain('sendAction("submit_feedback"');
    expect(html).not.toContain('sendAction("select_version")');
    expect(html).not.toContain('sendAction("close")');
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain(":focus-visible");
  });

  it("isolates zoom to the read-only diagram preview", () => {
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
      ".content { flex: 1 1 auto; min-height: 0; padding: var(--space); overflow: auto; }",
    );
    expect(html).toContain(".footer { justify-content: flex-start;");
    expect(html).toContain('frame.style.transform = "scale(" + zoom + ")"');
    expect(html).toContain('frame.style.width = (100 / zoom) + "%"');
    expect(html).toContain('frame.style.height = (100 / zoom) + "%"');
    expect(html).not.toContain("document.body.style.zoom");
    expect(html).toContain("Math.min(1.5, Math.max(.8");
    expect(html).toContain("setZoom(1); });");
  });
});

describe("Pi review interaction", () => {
  it("uses Pi UI for version selection, confirmation, and feedback", async () => {
    const project = await projectDirectory();
    await storeVersion(project, "pi-review", "version one");
    const window = new FakeWindow();
    const sendUserMessage = vi.fn();
    const manager = new DiagramReviewManager(
      {
        sendUserMessage,
      } as unknown as ExtensionAPI,
      {
        loadGlimpse: async () => ({
          open: () => {
            setImmediate(() => window.emit("ready", {}));
            return window;
          },
        }),
      },
    );
    const ui = {
      confirm: vi.fn(async () => false),
      input: vi.fn(async () => "Increase contrast"),
      select: vi.fn(async () => "v1"),
    };
    const preview = await manager.preview(context(project), result("pi-review", 1));
    expect(preview).toBe("opened");
    await expect(
      manager.review(
        {
          ...context(project),
          ui: ui as never,
        },
        result("pi-review", 1),
      ),
    ).resolves.toEqual({
      feedback: "Increase contrast",
      status: "changes_requested",
      version: 1,
    });
    expect(ui.select).toHaveBeenCalled();
    expect(ui.confirm).toHaveBeenCalled();
    expect(ui.input).toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Increase contrast"),
      undefined,
    );
    expect(
      (await readDiagramReviewState(project, "pi-review"))?.latestFeedback,
    ).toMatchObject({
      feedback: "Increase contrast",
      status: "sent",
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
