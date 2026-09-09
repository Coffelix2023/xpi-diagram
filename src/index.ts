import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { readDiagramConfig, writeDiagramConfig } from "./config.js";
import { DIAGRAM_TYPES, type DiagramResult, type DiagramType } from "./contracts.js";
import { registerDiagramTool } from "./diagram-tool.js";
import { findLatestDiagram } from "./storage.js";

const VERSION = "0.1.0";

const MENU_STATUS = "View status";
const MENU_ENABLE = "Enable automatic preview";
const MENU_DISABLE = "Disable automatic preview";
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
    const status = await reviewManager.preview(ctx, diagram);
    ctx.ui.notify(`Reopened ${diagram.diagramId} v${diagram.version} (${status}).`);
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
  const status = configuration.config.preview ? "enabled" : "disabled";
  const choice = await ctx.ui.select(
    `xpi-diagram ${VERSION} · automatic preview: ${status}`,
    [
      MENU_STATUS,
      MENU_ENABLE,
      MENU_DISABLE,
      MENU_LATEST,
    ],
  );
  if (!choice || choice === MENU_STATUS) {
    if (choice === MENU_STATUS)
      ctx.ui.notify(`Automatic Glimpse preview is ${status}.`);
    return;
  }
  if (choice === MENU_LATEST) {
    await reopenLatest(ctx, reviewManager);
    return;
  }
  const preview = choice === MENU_ENABLE;
  try {
    await writeDiagramConfig(
      ctx.cwd,
      {
        preview,
      },
      trusted,
    );
    ctx.ui.notify(`Automatic Glimpse preview ${preview ? "enabled" : "disabled"}.`);
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
