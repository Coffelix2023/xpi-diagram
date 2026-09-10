import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { type PreviewMode, readDiagramConfig, writeDiagramConfig } from "./config.js";
import { DIAGRAM_TYPES, type DiagramResult, type DiagramType } from "./contracts.js";
import { previewDiagram, registerDiagramTool } from "./diagram-tool.js";
import { findLatestDiagram } from "./storage.js";

const VERSION = "0.1.0";

const MENU_STATUS = "View status";
const MENU_ENABLE = "Enable automatic preview";
const MENU_DISABLE = "Disable automatic preview";
const MENU_GLIMPSE = "Preview in Glimpse";
const MENU_BROWSER = "Preview in browser";
const MENU_LATEST = "Reopen latest diagram";
const DIAGRAM_TYPE_PATTERN = /<svg\b[^>]*\bdata-diagram-type=["']([^"']+)["']/i;

function storedDiagramType(html: string): DiagramType {
  const value = html.match(DIAGRAM_TYPE_PATTERN)?.[1];
  if (value && (DIAGRAM_TYPES as readonly string[]).includes(value))
    return value as DiagramType;
  throw new Error("Latest diagram is missing supported data-diagram-type metadata");
}

async function reopenLatest(
  ctx: ExtensionCommandContext,
  reviewManager: ReturnType<typeof registerDiagramTool>,
): Promise<void> {
  try {
    const latest = await findLatestDiagram(ctx.cwd);
    if (!latest) {
      ctx.ui.notify("No saved diagrams found.", "warning");
      return;
    }
    const html = await readFile(latest.path, "utf8");
    const diagram: DiagramResult = {
      diagnostics: [],
      diagramId: latest.diagramId,
      path: relative(ctx.cwd, latest.path).replaceAll("\\\\", "/"),
      previewStatus: "not-attempted",
      simplificationNotes: [],
      type: storedDiagramType(html),
      validationStatus: "passed",
      version: latest.version,
    };
    const configuration = await readDiagramConfig(ctx.cwd, ctx.isProjectTrusted());
    if (configuration.diagnostic) ctx.ui.notify(configuration.diagnostic, "warning");
    if (!configuration.config.preview) {
      diagram.previewStatus = "disabled";
    } else {
      await previewDiagram(
        ctx,
        diagram,
        configuration.config.previewMode,
        reviewManager,
      );
    }
    ctx.ui.notify(
      `Reopened ${diagram.diagramId} v${diagram.version} (${diagram.previewStatus}).`,
    );
  } catch (error) {
    ctx.ui.notify(
      `Could not reopen latest diagram: ${(error as Error).message}`,
      "error",
    );
  }
}

async function handleDiagramCommand(
  ctx: ExtensionCommandContext,
  reviewManager: ReturnType<typeof registerDiagramTool>,
): Promise<void> {
  const trusted = ctx.isProjectTrusted();
  const configuration = await readDiagramConfig(ctx.cwd, trusted);
  if (configuration.diagnostic) ctx.ui.notify(configuration.diagnostic, "warning");
  const config = configuration.config;
  const status = config.preview ? "enabled" : "disabled";
  const choice = await ctx.ui.select(
    `xpi-diagram ${VERSION} · automatic preview: ${status}, mode: ${config.previewMode}`,
    [
      MENU_STATUS,
      MENU_ENABLE,
      MENU_DISABLE,
      MENU_GLIMPSE,
      MENU_BROWSER,
      MENU_LATEST,
    ],
  );
  if (!choice || choice === MENU_STATUS) {
    if (choice === MENU_STATUS)
      ctx.ui.notify(`Automatic preview is ${status}; mode is ${config.previewMode}.`);
    return;
  }
  if (choice === MENU_LATEST) {
    await reopenLatest(ctx, reviewManager);
    return;
  }
  let preview: boolean | undefined;
  let previewMode: PreviewMode | undefined;
  if (choice === MENU_ENABLE) preview = true;
  else if (choice === MENU_DISABLE) preview = false;
  else previewMode = choice === MENU_BROWSER ? "browser" : "glimpse";
  try {
    await writeDiagramConfig(
      ctx.cwd,
      {
        preview: preview ?? config.preview,
        previewMode: previewMode ?? config.previewMode,
      },
      trusted,
    );
    let changed: string;
    if (preview === undefined) changed = `mode set to ${previewMode}`;
    else changed = preview ? "enabled" : "disabled";
    ctx.ui.notify(
      `Automatic preview ${changed} (mode: ${previewMode ?? config.previewMode}).`,
    );
  } catch (error) {
    ctx.ui.notify(
      `Could not update xpi-diagram configuration: ${(error as Error).message}`,
      "error",
    );
  }
}

export default function xpiDiagram(pi: ExtensionAPI): void {
  const reviewManager = registerDiagramTool(pi);
  pi.registerCommand("xpi-diagram", {
    description: "Configure diagram preview or reopen the latest diagram",
    handler: async (_args, ctx) => {
      await handleDiagramCommand(ctx, reviewManager);
    },
  });
}
