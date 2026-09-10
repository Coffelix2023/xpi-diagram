import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { type DiagramConfig, readDiagramConfig, writeDiagramConfig } from "./config.js";
import { DiagramConfigPanel, type DiagramConfigPanelResult } from "./config-panel.js";
import {
  DIAGRAM_TYPES,
  type DiagramResult,
  type DiagramType,
  PREVIEW_STATUSES,
  type PreviewStatus,
} from "./contracts.js";
import { previewDiagram, registerDiagramTool } from "./diagram-tool.js";
import { findLatestDiagram } from "./storage.js";

const DIAGRAM_TYPE_PATTERN = /<svg\b[^>]*\bdata-diagram-type=["']([^"']+)["']/i;

function previewModeLabel(mode: DiagramConfig["previewMode"]): string {
  return mode === "glimpse" ? "Glimpse" : "浏览器";
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

async function legacyConfigChoice(
  ctx: ExtensionCommandContext,
  config: DiagramConfig,
): Promise<DiagramConfigPanelResult | undefined> {
  const english = config.language === "en";
  const labels = english
    ? {
        auto: `Automatic preview: ${config.preview ? "on" : "off"}`,
        language: "Display language: English",
        mode: `Preview mode: ${config.previewMode === "glimpse" ? "Glimpse" : "Browser"}`,
        reopen: "Reopen latest diagram",
        title: "xpi-diagram configuration",
      }
    : {
        auto: `自动预览：${config.preview ? "开" : "关"}`,
        language: "显示语言：简体中文",
        mode: `预览模式：${previewModeLabel(config.previewMode)}`,
        reopen: "重新打开最新图表",
        title: "xpi-diagram 配置",
      };
  const choice = await ctx.ui.select(labels.title, [
    labels.auto,
    labels.mode,
    labels.language,
    labels.reopen,
  ]);
  if (!choice) return undefined;
  if (choice === labels.reopen)
    return {
      config,
      reopenLatest: true,
    };
  const nextConfig = {
    ...config,
  };
  if (choice === labels.auto) nextConfig.preview = !config.preview;
  else if (choice === labels.mode)
    nextConfig.previewMode = config.previewMode === "glimpse" ? "browser" : "glimpse";
  else if (choice === labels.language)
    nextConfig.language = config.language === "zh-CN" ? "en" : "zh-CN";
  else return undefined;
  return {
    config: nextConfig,
    reopenLatest: false,
  };
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
    const configuration = await readDiagramConfig();
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
  const configuration = await readDiagramConfig();
  if (configuration.diagnostic) ctx.ui.notify(configuration.diagnostic, "warning");
  const result: DiagramConfigPanelResult | undefined =
    ctx.mode === "tui"
      ? await ctx.ui.custom<DiagramConfigPanelResult | undefined>(
          (_tui, theme, _keybindings, done) =>
            new DiagramConfigPanel(configuration.config, theme, done),
          {
            overlay: true,
            overlayOptions: {
              margin: 2,
              maxHeight: 12,
              minWidth: 56,
            },
          },
        )
      : await legacyConfigChoice(ctx, configuration.config);
  if (!result) return;
  try {
    await writeDiagramConfig(result.config);
    if (result.reopenLatest) {
      await reopenLatest(ctx, reviewManager);
      return;
    }
    const language = result.config.language;
    ctx.ui.notify(
      language === "en"
        ? `Configuration saved. Automatic preview: ${result.config.preview ? "on" : "off"}. Preview mode: ${previewModeLabel(result.config.previewMode)}.`
        : `配置已保存。自动预览：${result.config.preview ? "开" : "关"}。预览模式：${previewModeLabel(result.config.previewMode)}。`,
    );
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
