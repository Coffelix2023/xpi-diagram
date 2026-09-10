import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { type PreviewMode, readDiagramConfig, writeDiagramConfig } from "./config.js";
import {
  DIAGRAM_TYPES,
  type DiagramResult,
  type DiagramType,
  PREVIEW_STATUSES,
  type PreviewStatus,
} from "./contracts.js";
import { previewDiagram, registerDiagramTool } from "./diagram-tool.js";
import { findLatestDiagram } from "./storage.js";

const VERSION = "0.1.0";

const MENU_LATEST = "重新打开最新图表";
const DIAGRAM_TYPE_PATTERN = /<svg\b[^>]*\bdata-diagram-type=["']([^"']+)["']/i;

function autoPreviewMenuItem(preview: boolean): string {
  return `自动预览: ${preview ? "已启用" : "已禁用"}`;
}

function previewModeLabel(mode: PreviewMode): string {
  return mode === "glimpse" ? "Glimpse" : "浏览器";
}

function previewModeMenuItem(mode: PreviewMode): string {
  return `预览模式: ${previewModeLabel(mode)}`;
}

function previewStatusLabel(status: PreviewStatus): string {
  if (status === PREVIEW_STATUSES[1]) return "已禁用";
  switch (status) {
    case "not-attempted":
      return "未尝试";
    case "opened":
      return "已打开";
    case "unavailable":
      return "不可用";
    case "failed":
      return "失败";
  }
}

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
      // biome-ignore lint/security/noSecrets: user-facing notification text is not a secret
      ctx.ui.notify("未找到已保存的图表。", "warning");
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
      diagram.previewStatus = PREVIEW_STATUSES[1];
    } else {
      await previewDiagram(
        ctx,
        diagram,
        configuration.config.previewMode,
        reviewManager,
      );
    }
    ctx.ui.notify(
      `已重新打开图表 ${diagram.diagramId} v${diagram.version}（预览状态：${previewStatusLabel(diagram.previewStatus)}）。`,
    );
  } catch (error) {
    ctx.ui.notify(`重新打开最新图表失败：${(error as Error).message}`, "error");
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
  const autoPreviewChoice = autoPreviewMenuItem(config.preview);
  const previewModeChoice = previewModeMenuItem(config.previewMode);
  const choice = await ctx.ui.select(
    `xpi-diagram ${VERSION} · ${autoPreviewChoice} · ${previewModeChoice}`,
    [
      autoPreviewChoice,
      previewModeChoice,
      MENU_LATEST,
    ],
  );
  if (!choice) return;
  if (choice === MENU_LATEST) {
    await reopenLatest(ctx, reviewManager);
    return;
  }

  let preview = config.preview;
  let previewMode = config.previewMode;
  if (choice === autoPreviewChoice) preview = !config.preview;
  else if (choice === previewModeChoice)
    previewMode = config.previewMode === "glimpse" ? "browser" : "glimpse";
  else return;

  try {
    await writeDiagramConfig(
      ctx.cwd,
      {
        preview,
        previewMode,
      },
      trusted,
    );
    const changed =
      choice === autoPreviewChoice
        ? `自动预览已${preview ? "启用" : "禁用"}`
        : `预览模式已切换为 ${previewModeLabel(previewMode)}`;
    ctx.ui.notify(`${changed}。当前预览模式：${previewModeLabel(previewMode)}。`);
  } catch (error) {
    ctx.ui.notify(`更新 xpi-diagram 配置失败：${(error as Error).message}`, "error");
  }
}

export default function xpiDiagram(pi: ExtensionAPI): void {
  const reviewManager = registerDiagramTool(pi);
  pi.registerCommand("xpi-diagram", {
    description: "配置图表预览或重新打开最新图表",
    handler: async (_args, ctx) => {
      await handleDiagramCommand(ctx, reviewManager);
    },
  });
}
