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
  abortCleanup?: () => void;
  completedVersion?: number;
  confirmedVersion: number | null;
  isIdle: () => boolean;
  key: string;
  processing: boolean;
  projectRoot: string;
  resolveReview?: (result: DiagramReviewResult) => void;
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

function versionFiles(versions: number[]): string {
  return versions
    .map((version) => `<option value="${version}">v${version}</option>`)
    .join("");
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
    availableVersions: input.availableVersions,
    confirmedVersion: input.confirmedVersion,
    currentVersion: input.currentVersion,
    diagramId: input.diagramId,
    selectedVersion: input.selectedVersion,
  });
  const safeDiagramId = escapeHtml(input.diagramId);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:;">
<style>
:root {
  --surface: rgba(30, 30, 32, .82); --surface-2: rgba(255, 255, 255, .06);
  --surface-3: rgba(255, 255, 255, .11); --ink: #f2f2f4; --muted: #9a9aa2;
  --rule: rgba(255, 255, 255, .12); --sys-accent: #0a84ff; --primary: var(--sys-accent);
  --on-primary: #fff; --error: #ff5f57; --rounded-md: 10px; --rounded-lg: 14px;
  --space-1: 8px; --space-2: 12px; --space-3: 16px; --dur: 140ms;
}
[data-theme="light"] { --surface: rgba(246,246,248,.9); --surface-2: rgba(0,0,0,.045); --surface-3: rgba(0,0,0,.09); --ink: #222226; --muted: #6c6c74; --rule: rgba(0,0,0,.12); }
[data-theme="dark"][data-contrast="true"] { --ink: #fff; --muted: #d6d6dc; --rule: rgba(255,255,255,.3); }
[data-theme="light"][data-contrast="true"] { --ink: #111114; --muted: #4a4a52; --rule: rgba(0,0,0,.3); }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { color: var(--ink); background: transparent !important; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
button, select, textarea { font: inherit; }
button, select { cursor: pointer; }
.review-shell { height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); -webkit-backdrop-filter: blur(24px) saturate(1.5); backdrop-filter: blur(24px) saturate(1.5); border: 1px solid var(--rule); border-radius: var(--rounded-lg); animation: review-in var(--dur) ease-out; }
@keyframes review-in { from { opacity: 0; transform: translateY(4px); } }
.titlebar, .toolbar, .footer { flex: none; display: flex; align-items: center; gap: var(--space-1); padding: 10px 14px; border-bottom: 1px solid var(--rule); }
.title { flex: 1; min-width: 0; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { color: var(--muted); font-size: 12px; }
.toolbar { flex-wrap: wrap; border-bottom: 1px solid var(--rule); }
.toolbar label { color: var(--muted); font-size: 12px; }
select, textarea, .tool, .btn { color: var(--ink); background: var(--surface-2); border: 1px solid var(--rule); border-radius: var(--rounded-md); }
select, .tool { min-height: 30px; padding: 5px 9px; }
.tool { min-width: 32px; }
.content { flex: 1 1 auto; min-height: 0; padding: var(--space-2); overflow: auto; }
#diagram-frame { display: block; width: 100%; min-height: 420px; height: 100%; border: 1px solid var(--rule); border-radius: var(--rounded-md); background: #fff; }
#diagram-frame { display: block; width: 100%; min-height: 420px; height: 100%; border: 1px solid var(--rule); border-radius: var(--rounded-md); background: #fff; transform-origin: top left; }
.feedback { display: none; flex: none; min-height: 0; max-height: 40%; overflow: auto; padding: 0 14px 10px; }
textarea { display: block; width: 100%; min-height: 74px; padding: 8px 10px; resize: vertical; background: var(--surface-2); }
.footer { justify-content: flex-end; flex-wrap: wrap; padding: 10px 14px; border-top: 1px solid var(--rule); border-bottom: 0; background: var(--surface-2); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); }
.btn { min-height: 32px; padding: 7px 14px; }
.btn-primary { color: var(--on-primary); background: var(--primary); border-color: transparent; }
button:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
button:disabled { opacity: .45; cursor: default; }
.status { flex: 1; min-width: 180px; color: var(--muted); font-size: 12px; }
[data-reduce-motion="true"] * { animation: none !important; transition: none !important; }
</style>
</head>
<body>
<div class="review-shell">
  <header class="titlebar">
    <div class="title" data-i18n="title">Diagram review</div>
    <div class="meta" aria-live="polite">${safeDiagramId}</div>
    <button class="tool" id="zoom-out" type="button" data-i18n="zoomOut" data-i18n-title="zoomOutTitle">A-</button>
    <button class="tool" id="zoom-in" type="button" data-i18n="zoomIn" data-i18n-title="zoomInTitle">A+</button>
    <button class="tool" id="zoom-reset" type="button" data-i18n="zoomReset" data-i18n-title="zoomResetTitle">Reset</button>
  </header>
  <div class="toolbar">
    <label for="version" data-i18n="versionLabel">Version</label>
    <select id="version" aria-label="Version">${versionFiles(input.availableVersions)}</select>
    <span class="meta" id="version-status" aria-live="polite"></span>
  </div>
  <main class="content"><iframe id="diagram-frame" sandbox="" title="Diagram preview"></iframe></main>
  <div class="feedback" id="feedback-panel">
    <label for="feedback" data-i18n="feedbackLabel">Requested changes</label>
    <textarea id="feedback" maxlength="4000" data-i18n-placeholder="feedbackPlaceholder"></textarea>
  </div>
  <footer class="footer">
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <button class="btn" id="request" type="button" data-i18n="requestChanges">Request changes</button>
    <button class="btn" id="submit" type="button" data-i18n="submitFeedback">Submit feedback</button>
    <button class="btn btn-primary" id="confirm" type="button" data-i18n="confirmAndClose">Confirm &amp; close</button>
    <button class="btn" id="close" type="button" data-i18n="close">Close</button>
  </footer>
</div>
<script>
(function () {
  "use strict";
  var DATA = ${data};
  var TEXT = {
    zh: { title: "图表审阅", versionLabel: "版本", zoomOut: "A-", zoomIn: "A+", zoomReset: "重置", zoomOutTitle: "缩小 (⌘-)", zoomInTitle: "放大 (⌘+)", zoomResetTitle: "重置 (⌘0)", feedbackLabel: "修改意见", feedbackPlaceholder: "描述需要调整的内容", requestChanges: "请求修改", submitFeedback: "提交反馈", confirmAndClose: "确认并关闭", close: "关闭", current: "当前版本", confirmed: "已确认", feedbackRequired: "请先输入修改意见", sent: "反馈已发送", pending: "反馈待发送", invalid: "操作未接受" },
    en: { title: "Diagram review", versionLabel: "Version", zoomOut: "A-", zoomIn: "A+", zoomReset: "Reset", zoomOutTitle: "Zoom out (⌘-)", zoomInTitle: "Zoom in (⌘+)", zoomResetTitle: "Reset (⌘0)", feedbackLabel: "Requested changes", feedbackPlaceholder: "Describe what should change", requestChanges: "Request changes", submitFeedback: "Submit feedback", confirmAndClose: "Confirm & close", close: "Close", current: "Current version", confirmed: "Confirmed", feedbackRequired: "Enter feedback first", sent: "Feedback sent", pending: "Feedback pending", invalid: "Action rejected" }
  };
  var lang = "en";
  var zoom = 1;
  var selectedVersion = DATA.selectedVersion;
  var frame = document.getElementById("diagram-frame");
  var status = document.getElementById("status");
  var versionStatus = document.getElementById("version-status");
  var feedbackPanel = document.getElementById("feedback-panel");
  var feedback = document.getElementById("feedback");
  function t(key) { return TEXT[lang][key] || key; }
  function applyText() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) { el.title = t(el.getAttribute("data-i18n-title")); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) { el.placeholder = t(el.getAttribute("data-i18n-placeholder")); });
  }
  function renderStatus(message) { status.textContent = message; }
  function renderVersionStatus() {
    var message = selectedVersion === DATA.currentVersion ? t("current") : "v" + selectedVersion;
    if (DATA.confirmedVersion === selectedVersion) message += " · " + t("confirmed");
    versionStatus.textContent = message;
  }
  function decodeArtifact() {
    var bytes = Uint8Array.from(atob(DATA.artifactBase64), function (character) { return character.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }
  function showArtifact() {
    frame.srcdoc = selectedVersion === DATA.selectedVersion ? decodeArtifact() : "";
    renderVersionStatus();
  }
  function sendAction(action, extra) {
    var event = { action: action, diagramId: DATA.diagramId, version: selectedVersion };
    if (extra) Object.keys(extra).forEach(function (key) { event[key] = extra[key]; });
    window.glimpse.send(event);
  }
  function setZoom(value) { zoom = Math.min(1.5, Math.max(.8, Math.round(value * 10) / 10)); frame.style.transform = "scale(" + zoom + ")"; frame.style.width = (100 / zoom) + "%"; frame.style.height = (100 / zoom) + "%"; }
  function toggleFeedback() { feedbackPanel.classList.add("open"); feedback.focus(); }
  document.getElementById("version").value = String(selectedVersion);
  document.getElementById("version").addEventListener("change", function (event) { selectedVersion = Number(event.target.value); sendAction("select_version"); });
  document.getElementById("zoom-out").addEventListener("click", function () { setZoom(zoom - .1); });
  document.getElementById("zoom-in").addEventListener("click", function () { setZoom(zoom + .1); });
  document.getElementById("zoom-reset").addEventListener("click", function () { setZoom(1); });
  document.getElementById("request").addEventListener("click", function () { toggleFeedback(); sendAction("request_changes"); });
  document.getElementById("submit").addEventListener("click", function () { var value = feedback.value.trim(); if (!value) { renderStatus(t("feedbackRequired")); feedback.focus(); return; } sendAction("submit_feedback", { feedback: value }); });
  document.getElementById("confirm").addEventListener("click", function () { sendAction("confirm"); });
  document.getElementById("close").addEventListener("click", function () { sendAction("close"); });
  document.addEventListener("keydown", function (event) {
    var modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key === "+") { setZoom(zoom + .1); event.preventDefault(); }
    else if (modifier && event.key === "-") { setZoom(zoom - .1); event.preventDefault(); }
    else if (modifier && event.key === "0") { setZoom(1); event.preventDefault(); }
    else if (event.key === "Escape") { if (feedbackPanel.classList.contains("open")) feedbackPanel.classList.remove("open"); else sendAction("close"); }
    else if (event.key === "Enter" && event.target.tagName !== "TEXTAREA" && event.target.tagName !== "SELECT") { var active = document.activeElement; if (active && active.tagName === "BUTTON") active.click(); }
  });
  window.addEventListener("message", function (event) { var message = event.data || {}; if (message.type === "review-status") renderStatus(message.message || ""); });
  document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches ? "true" : "false";
  document.documentElement.dataset.contrast = matchMedia("(prefers-contrast: more)").matches ? "true" : "false";
  applyText(); showArtifact(); renderStatus("");
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

function postStatus(window: GlimpseWindow, message: string): void {
  window.send(
    `window.postMessage(${scriptJson({
      message,
      type: "review-status",
    })}, "*")`,
  );
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

function waitForReviewDecision(
  session: ReviewSession,
  signal?: AbortSignal,
): Promise<DiagramReviewResult> {
  if (signal?.aborted) {
    return Promise.resolve({
      status: "cancelled",
      version: session.currentVersion,
    });
  }
  return new Promise((resolveReview) => {
    session.completedVersion = undefined;
    session.resolveReview = resolveReview;
    const abort = () =>
      settleReview(session, {
        status: "cancelled",
        version: session.currentVersion,
      });
    signal?.addEventListener("abort", abort, {
      once: true,
    });
    session.abortCleanup = () => signal?.removeEventListener("abort", abort);
  });
}

function settleReview(session: ReviewSession, result: DiagramReviewResult): boolean {
  const resolveReview = session.resolveReview;
  if (!resolveReview) return false;
  session.abortCleanup?.();
  session.abortCleanup = undefined;
  session.resolveReview = undefined;
  session.completedVersion = result.version;
  resolveReview(result);
  return true;
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
    waitForReview: true,
    signal?: AbortSignal,
  ): Promise<DiagramReviewResult | PreviewStatus>;
  async preview(
    context: Pick<ExtensionContext, "cwd" | "hasUI" | "mode" | "isIdle">,
    diagram: DiagramResult,
    waitForReview = false,
    signal?: AbortSignal,
  ): Promise<DiagramReviewResult | PreviewStatus> {
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
      settleReview(existing, {
        status: "superseded",
        version: existing.currentVersion,
      });
      existing.availableVersions = new Set(versions);
      existing.currentVersion = currentVersion;
      existing.selectedVersion = currentVersion;
      existing.confirmedVersion = state.confirmedVersion;
      existing.isIdle = context.isIdle;
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
      if (waitForReview) return await waitForReviewDecision(existing, signal);
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
      isIdle: context.isIdle,
      processing: false,
      projectRoot,
      selectedVersion: currentVersion,
      window,
    };
    this.sessions.set(key, session);
    window.on("message", (message: unknown) => {
      if (session.processing) return;
      session.processing = true;
      void this.handleMessage(session, message)
        .catch(() => postStatus(session.window, "Review could not be saved"))
        .finally(() => {
          session.processing = false;
        });
    });
    window.on("closed", () => {
      settleReview(session, {
        status: "closed",
        version: session.currentVersion,
      });
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    });
    window.on("error", () => {
      settleReview(session, {
        status: "failed",
        version: session.currentVersion,
      });
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    });
    try {
      const info = await waitForReady(window, this.readyTimeoutMs);
      window.send(themeScript(info));
      diagram.previewStatus = "opened";
      if (waitForReview) return await waitForReviewDecision(session, signal);
      return diagram.previewStatus;
    } catch {
      this.sessions.delete(key);
      window.close();
      diagram.previewStatus = "failed";
      return diagram.previewStatus;
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      settleReview(session, {
        status: "cancelled",
        version: session.currentVersion,
      });
      session.window.close();
    }
    this.sessions.clear();
  }

  private async handleMessage(session: ReviewSession, value: unknown): Promise<void> {
    const validation = validateReviewEvent(value, session);
    if (!validation.ok) {
      postStatus(session.window, validation.message);
      return;
    }
    const event = validation.event;
    if (event.action === "select_version") {
      session.selectedVersion = event.version;
      session.window.setHTML(
        buildReviewPanelHtml({
          artifactHtml: await readVersion(
            session.projectRoot,
            session.diagramId,
            event.version,
          ),
          availableVersions: [
            ...session.availableVersions,
          ].sort((a, b) => a - b),
          confirmedVersion: session.confirmedVersion,
          currentVersion: session.currentVersion,
          diagramId: session.diagramId,
          selectedVersion: event.version,
        }),
      );
      return;
    }
    if (event.action === "close") {
      settleReview(session, {
        status: "closed",
        version: session.currentVersion,
      });
      session.window.close();
      this.sessions.delete(session.key);
      return;
    }
    if (session.completedVersion === event.version) {
      postStatus(session.window, "Review already completed");
      return;
    }
    if (event.action === "request_changes") {
      postStatus(session.window, "Feedback is ready");
      return;
    }
    if (event.action === "confirm") {
      const state =
        (await readDiagramReviewState(session.projectRoot, session.diagramId)) ??
        emptyState(session.currentVersion);
      state.confirmedVersion = event.version;
      state.currentVersion = session.currentVersion;
      state.updatedAt = new Date().toISOString();
      try {
        await this.writeReviewState(session.projectRoot, session.diagramId, state);
      } catch {
        postStatus(session.window, "Review could not be saved");
        return;
      }
      session.confirmedVersion = event.version;
      postStatus(session.window, "Confirmed");
      settleReview(session, {
        status: "confirmed",
        version: event.version,
      });
      session.window.close();
      this.sessions.delete(session.key);
      return;
    }

    const state =
      (await readDiagramReviewState(session.projectRoot, session.diagramId)) ??
      emptyState(session.currentVersion);
    state.latestFeedback = {
      feedback: event.feedback,
      status: "sent",
      submittedAt: new Date().toISOString(),
      version: event.version,
    };
    state.currentVersion = session.currentVersion;
    state.updatedAt = new Date().toISOString();
    try {
      await this.writeReviewState(session.projectRoot, session.diagramId, state);
    } catch {
      postStatus(session.window, "Review could not be saved");
      return;
    }
    postStatus(session.window, "Feedback sent");
    const result: DiagramReviewResult = {
      feedback: event.feedback,
      status: "changes_requested",
      version: event.version,
    };
    if (!settleReview(session, result)) {
      const message = `Diagram ${event.diagramId} v${event.version} review feedback:\n${event.feedback}`;
      if (session.isIdle()) {
        this.pi.sendUserMessage(message);
      } else {
        this.pi.sendUserMessage(message, {
          deliverAs: "steer",
        });
      }
    }
  }
}
