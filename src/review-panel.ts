import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import {
  type DiagramResult,
  type DiagramReviewResult,
  type PreviewStatus,
  type ReviewEvent,
  reviewEventSchema,
} from "./contracts.js";
import {
  type DiagramReviewState,
  readDiagramReviewState,
  writeDiagramReviewState,
} from "./review-state.js";

const PREVIEW_PATH_PATTERN =
  /^\.pi\/diagram\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\/v\d+\.html$/;
const VERSION_FILE_PATTERN = /^v(\d+)\.html$/;
const SUPPORTED_PREVIEW_MODES = new Set<ExtensionContext["mode"]>([
  "rpc",
  "tui",
]);

interface GlimpseWindow {
  close(): void;
  on(event: "closed", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "message", listener: (message: unknown) => void): void;
  on(event: "ready", listener: (info: unknown) => void): void;
  send(script: string): void;
  setHTML(html: string): void;
}

interface GlimpseModule {
  open(html: string, options: Record<string, unknown>): GlimpseWindow;
}

export interface GlimpseLoaderOptions {
  loadGlimpse?: () => Promise<GlimpseModule | null>;
  readyTimeoutMs?: number;
  writeReviewState?: typeof writeDiagramReviewState;
}

interface ReviewContext {
  availableVersions: Set<number>;
  currentVersion: number;
  diagramId: string;
  selectedVersion: number;
}

type ReviewValidation =
  | {
      ok: true;
      event: ReviewEvent;
    }
  | {
      code: "invalid-event" | "stale-version" | "unknown-version";
      message: string;
      ok: false;
    };

interface ReviewSession extends ReviewContext {
  confirmedVersion: number | null;
  key: string;
  projectRoot: string;
  window: GlimpseWindow;
}

export interface DiagramPreviewResult {
  previewStatus: PreviewStatus;
  review?: DiagramReviewResult;
}

const DEFAULT_READY_TIMEOUT_MS = 3_000;

function defaultLoadGlimpse(): Promise<GlimpseModule | null> {
  return loadGlimpse();
}

async function loadGlimpse(): Promise<GlimpseModule | null> {
  const candidates = [
    "glimpseui",
    join(homedir(), ".pi/agent/npm/node_modules/glimpseui/src/glimpse.mjs"),
  ];
  const modules = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return (await import(
          candidate.startsWith("/") ? pathToFileURL(candidate).href : candidate
        )) as GlimpseModule;
      } catch {
        return null;
      }
    }),
  );
  return modules.find((module): module is GlimpseModule => module !== null) ?? null;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "'": "&#39;",
        '"': "&quot;",
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
      })[character] ?? character,
  );
}

export function buildReviewPanelHtml(input: {
  artifactHtml: string;
  availableVersions: number[];
  confirmedVersion: number | null;
  currentVersion: number;
  diagramId: string;
  selectedVersion: number;
}): string {
  const data = scriptJson({
    artifactBase64: Buffer.from(input.artifactHtml, "utf8").toString("base64"),
  });
  const safeDiagramId = escapeHtml(input.diagramId);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:;">
<style>
 :root { --surface: rgba(30, 30, 32, .82); --ink: #f2f2f4; --muted: #9a9aa2; --rule: rgba(255, 255, 255, .12); --primary: #0a84ff; --rounded: 10px; --space: 12px; --dur: 140ms; }
 [data-theme="light"] { --surface: rgba(246,246,248,.9); --ink: #222226; --muted: #6c6c74; --rule: rgba(0,0,0,.12); }
 [data-theme="dark"][data-contrast="true"] { --ink: #fff; --muted: #d6d6dc; --rule: rgba(255,255,255,.3); }
 [data-theme="light"][data-contrast="true"] { --ink: #111114; --muted: #4a4a52; --rule: rgba(0,0,0,.3); }
 * { box-sizing: border-box; }
 html, body { height: 100%; margin: 0; }
 body { color: var(--ink); background: transparent !important; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
 button { font: inherit; cursor: pointer; }
 .preview-shell { height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); -webkit-backdrop-filter: blur(24px) saturate(1.5); backdrop-filter: blur(24px) saturate(1.5); border: 1px solid var(--rule); border-radius: 14px; animation: preview-in var(--dur) ease-out; }
 @keyframes preview-in { from { opacity: 0; transform: translateY(4px); } }
 .titlebar, .footer { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--rule); }
 .title { flex: 1; min-width: 0; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
 .meta, .status { color: var(--muted); font-size: 12px; }
 .tool { min-width: 32px; min-height: 30px; padding: 5px 9px; color: var(--ink); background: rgba(255,255,255,.06); border: 1px solid var(--rule); border-radius: var(--rounded); }
 .content { flex: 1 1 auto; min-height: 0; padding: var(--space); overflow: auto; }
 #diagram-frame { display: block; width: 100%; min-height: 420px; height: 100%; border: 1px solid var(--rule); border-radius: var(--rounded); background: #fff; transform-origin: top left; }
 .footer { justify-content: flex-start; border-top: 1px solid var(--rule); border-bottom: 0; background: rgba(255,255,255,.06); }
 button:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
 [data-reduce-motion="true"] * { animation: none !important; transition: none !important; }
</style>
</head>
<body>
<div class="preview-shell">
  <header class="titlebar">
    <div class="title">Diagram preview</div>
    <div class="meta" aria-live="polite">${safeDiagramId}</div>
    <button class="tool" id="zoom-out" type="button" title="Zoom out (Cmd -)">A-</button>
    <button class="tool" id="zoom-in" type="button" title="Zoom in (Cmd +)">A+</button>
    <button class="tool" id="zoom-reset" type="button" title="Reset (Cmd 0)">Reset</button>
  </header>
  <main class="content"><iframe id="diagram-frame" sandbox="" title="Diagram preview"></iframe></main>
  <footer class="footer"><div class="status" role="status">Read-only preview</div></footer>
</div>
<script>
(function () {
  "use strict";
  var DATA = ${data};
  var zoom = 1;
  var frame = document.getElementById("diagram-frame");
  function decodeArtifact() {
    var bytes = Uint8Array.from(atob(DATA.artifactBase64), function (character) { return character.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }
  function setZoom(value) { zoom = Math.min(1.5, Math.max(.8, Math.round(value * 10) / 10)); frame.style.transform = "scale(" + zoom + ")"; frame.style.width = (100 / zoom) + "%"; frame.style.height = (100 / zoom) + "%"; }
  document.getElementById("zoom-out").addEventListener("click", function () { setZoom(zoom - .1); });
  document.getElementById("zoom-in").addEventListener("click", function () { setZoom(zoom + .1); });
  document.getElementById("zoom-reset").addEventListener("click", function () { setZoom(1); });
  document.addEventListener("keydown", function (event) {
    var modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key === "+") { setZoom(zoom + .1); event.preventDefault(); }
    else if (modifier && event.key === "-") { setZoom(zoom - .1); event.preventDefault(); }
    else if (modifier && event.key === "0") { setZoom(1); event.preventDefault(); }
  });
  document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches ? "true" : "false";
  document.documentElement.dataset.contrast = matchMedia("(prefers-contrast: more)").matches ? "true" : "false";
  frame.srcdoc = decodeArtifact();
}());
</script>
</body>
</html>`;
}

export function validateReviewEvent(
  value: unknown,
  context: ReviewContext,
): ReviewValidation {
  if (!Value.Check(reviewEventSchema, value)) {
    return {
      code: "invalid-event",
      message: "Invalid review event",
      ok: false,
    };
  }
  const event = value as ReviewEvent;
  if (event.diagramId !== context.diagramId) {
    return {
      code: "invalid-event",
      message: "Unknown diagram",
      ok: false,
    };
  }
  if (!context.availableVersions.has(event.version)) {
    return {
      code: "unknown-version",
      message: "Unknown diagram version",
      ok: false,
    };
  }
  if (
    event.action !== "close" &&
    event.action !== "select_version" &&
    event.version !== context.currentVersion
  ) {
    return {
      code: "stale-version",
      message: "Review version is no longer current",
      ok: false,
    };
  }
  return {
    event,
    ok: true,
  };
}

function artifactPath(projectRoot: string, path: string): string {
  const root = resolve(projectRoot);
  const target = resolve(root, path);
  const projectRelative = relative(root, target);
  if (
    projectRelative.startsWith("..") ||
    projectRelative.startsWith("/") ||
    !PREVIEW_PATH_PATTERN.test(projectRelative)
  ) {
    throw new Error("Diagram preview path escaped the project directory");
  }
  return target;
}

async function listVersions(projectRoot: string, diagramId: string): Promise<number[]> {
  const directory = resolve(projectRoot, ".pi", "diagram", diagramId);
  const files = await readdir(directory);
  return files
    .map((file) => Number(VERSION_FILE_PATTERN.exec(file)?.[1] ?? 0))
    .filter((version) => Number.isSafeInteger(version) && version > 0)
    .sort((a, b) => a - b);
}

async function readVersion(
  projectRoot: string,
  diagramId: string,
  version: number,
): Promise<string> {
  return readFile(
    artifactPath(projectRoot, `.pi/diagram/${diagramId}/v${version}.html`),
    "utf8",
  );
}

function themeScript(info: unknown): string {
  const appearance =
    (
      info as {
        appearance?: Record<string, unknown>;
      }
    )?.appearance ?? {};
  return `document.documentElement.style.setProperty("--sys-accent", ${scriptJson(appearance.accentColor ?? "#0a84ff")});document.documentElement.dataset.theme=${scriptJson(appearance.darkMode ? "dark" : "light")};document.documentElement.dataset.reduceMotion=${scriptJson(String(Boolean(appearance.reduceMotion)))};document.documentElement.dataset.contrast=${scriptJson(String(Boolean(appearance.increaseContrast)))};`;
}

function waitForReady(window: GlimpseWindow, timeoutMs: number): Promise<unknown> {
  return new Promise((resolveReady, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error("Glimpse ready timeout")),
      timeoutMs,
    );
    const finish = (error?: Error, info?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolveReady(info);
    };
    window.on("ready", (info: unknown) => finish(undefined, info));
    window.on("error", (error: Error) => finish(error));
    window.on("closed", () => finish(new Error("Glimpse closed before ready")));
  });
}

function emptyState(version: number): DiagramReviewState {
  return {
    confirmedVersion: null,
    currentVersion: version,
    updatedAt: new Date().toISOString(),
  };
}

export class DiagramReviewManager {
  private readonly loadGlimpse: () => Promise<GlimpseModule | null>;
  private readonly readyTimeoutMs: number;
  private readonly sessions = new Map<string, ReviewSession>();
  private readonly writeReviewState: typeof writeDiagramReviewState;

  constructor(
    private readonly pi: Pick<ExtensionAPI, "sendUserMessage">,
    options: GlimpseLoaderOptions = {},
  ) {
    this.loadGlimpse = options.loadGlimpse ?? defaultLoadGlimpse;
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.writeReviewState = options.writeReviewState ?? writeDiagramReviewState;
  }

  async preview(
    context: Pick<ExtensionContext, "cwd" | "hasUI" | "mode" | "isIdle">,
    diagram: DiagramResult,
  ): Promise<PreviewStatus>;
  async preview(
    context: Pick<ExtensionContext, "cwd" | "hasUI" | "mode" | "isIdle">,
    diagram: DiagramResult,
    _waitForReview: true,
    _signal?: AbortSignal,
  ): Promise<PreviewStatus>;
  async preview(
    context: Pick<ExtensionContext, "cwd" | "hasUI" | "mode" | "isIdle">,
    diagram: DiagramResult,
    _waitForReview = false,
    _signal?: AbortSignal,
  ): Promise<PreviewStatus> {
    if (
      !context.hasUI ||
      !SUPPORTED_PREVIEW_MODES.has(context.mode) ||
      diagram.validationStatus !== "passed" ||
      diagram.version === null
    ) {
      diagram.previewStatus = "unavailable";
      return diagram.previewStatus;
    }

    const projectRoot = resolve(context.cwd);
    const key = `${projectRoot}\0${diagram.diagramId}`;
    const versions = await listVersions(projectRoot, diagram.diagramId);
    const currentVersion = Math.max(...versions);
    const state =
      (await readDiagramReviewState(projectRoot, diagram.diagramId)) ??
      emptyState(currentVersion);
    state.currentVersion = currentVersion;
    state.updatedAt = new Date().toISOString();
    await this.writeReviewState(projectRoot, diagram.diagramId, state);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.availableVersions = new Set(versions);
      existing.currentVersion = currentVersion;
      existing.selectedVersion = currentVersion;
      existing.confirmedVersion = state.confirmedVersion;
      existing.window.setHTML(
        buildReviewPanelHtml({
          artifactHtml: await readVersion(
            projectRoot,
            diagram.diagramId,
            currentVersion,
          ),
          availableVersions: versions,
          confirmedVersion: state.confirmedVersion,
          currentVersion,
          diagramId: diagram.diagramId,
          selectedVersion: currentVersion,
        }),
      );
      diagram.previewStatus = "opened";
      return diagram.previewStatus;
    }

    const glimpse = await this.loadGlimpse();
    if (!glimpse) {
      diagram.previewStatus = "unavailable";
      return diagram.previewStatus;
    }
    let window: GlimpseWindow;
    try {
      window = glimpse.open(
        buildReviewPanelHtml({
          artifactHtml: await readVersion(
            projectRoot,
            diagram.diagramId,
            currentVersion,
          ),
          availableVersions: versions,
          confirmedVersion: state.confirmedVersion,
          currentVersion,
          diagramId: diagram.diagramId,
          selectedVersion: currentVersion,
        }),
        {
          height: 600,
          title: `Diagram ${diagram.diagramId}`,
          width: 800,
        },
      );
    } catch {
      diagram.previewStatus = "failed";
      return diagram.previewStatus;
    }
    const session: ReviewSession = {
      availableVersions: new Set(versions),
      confirmedVersion: state.confirmedVersion,
      currentVersion,
      diagramId: diagram.diagramId,
      key,
      projectRoot,
      selectedVersion: currentVersion,
      window,
    };
    this.sessions.set(key, session);
    window.on("closed", () => {
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    });
    window.on("error", () => {
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    });
    try {
      const info = await waitForReady(window, this.readyTimeoutMs);
      window.send(themeScript(info));
      diagram.previewStatus = "opened";
      return diagram.previewStatus;
    } catch {
      this.sessions.delete(key);
      window.close();
      diagram.previewStatus = "failed";
      return diagram.previewStatus;
    }
  }

  async review(
    context: Pick<ExtensionContext, "cwd" | "hasUI" | "mode" | "isIdle" | "ui">,
    diagram: DiagramResult,
    signal?: AbortSignal,
  ): Promise<DiagramReviewResult | undefined> {
    if (signal?.aborted || !context.hasUI || diagram.version === null) return undefined;
    const projectRoot = resolve(context.cwd);
    const key = `${projectRoot}\0${diagram.diagramId}`;
    const session = this.sessions.get(key);
    const versions = session
      ? [
          ...session.availableVersions,
        ].sort((a, b) => a - b)
      : await listVersions(projectRoot, diagram.diagramId);
    const currentVersion = session?.currentVersion ?? diagram.version;
    const selected = await context.ui.select(
      `Review diagram ${diagram.diagramId}`,
      versions.map((version) => `v${version}`),
    );
    if (!selected)
      return {
        status: "closed",
        version: currentVersion,
      };
    const version = Number(selected.slice(1));
    const confirmed = await context.ui.confirm(
      `Confirm diagram ${diagram.diagramId} v${version}?`,
      "The preview is read-only. Confirm this version in Pi.",
    );
    if (confirmed) {
      const state =
        (await readDiagramReviewState(projectRoot, diagram.diagramId)) ??
        emptyState(currentVersion);
      state.confirmedVersion = version;
      state.currentVersion = currentVersion;
      state.updatedAt = new Date().toISOString();
      await this.writeReviewState(projectRoot, diagram.diagramId, state);
      session?.window.close();
      if (session) this.sessions.delete(key);
      return {
        status: "confirmed",
        version,
      };
    }
    const feedback = await context.ui.input(
      `Feedback for ${diagram.diagramId} v${version}`,
      "Describe the requested changes",
    );
    if (!feedback)
      return {
        status: "closed",
        version,
      };
    const state =
      (await readDiagramReviewState(projectRoot, diagram.diagramId)) ??
      emptyState(currentVersion);
    state.latestFeedback = {
      feedback,
      status: "sent",
      submittedAt: new Date().toISOString(),
      version,
    };
    state.currentVersion = currentVersion;
    state.updatedAt = new Date().toISOString();
    await this.writeReviewState(projectRoot, diagram.diagramId, state);
    const message = `Diagram ${diagram.diagramId} v${version} review feedback:\n${feedback}`;
    this.pi.sendUserMessage(
      message,
      context.isIdle()
        ? undefined
        : {
            deliverAs: "steer",
          },
    );
    session?.window.close();
    if (session) this.sessions.delete(key);
    return {
      feedback,
      status: "changes_requested",
      version,
    };
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.window.close();
    }
    this.sessions.clear();
  }
}
