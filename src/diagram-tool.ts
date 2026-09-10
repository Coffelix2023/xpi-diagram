import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { type BrowserPreviewResult, openBrowserPreview } from "./browser-preview.js";
import { type PreviewMode, readDiagramConfig } from "./config.js";
import {
  type DiagramArtifact,
  type DiagramResult,
  diagramArtifactSchema,
} from "./contracts.js";
import { DiagramReviewManager } from "./review-panel.js";
import { storeDiagramVersion } from "./storage.js";
import { validateDiagramArtifact } from "./validator.js";

function resultPath(diagramId: string, version?: number): string {
  return join(".pi", "diagram", diagramId, version ? `v${version}.html` : "");
}

function summary(result: DiagramResult): string {
  const version = result.version === null ? "not stored" : `v${result.version}`;
  const diagnostics = result.diagnostics
    .slice(0, 3)
    .map(({ code, message }) => `${code}: ${message}`)
    .join(" | ");
  const suffix = diagnostics ? ` Diagnostics: ${diagnostics}` : "";
  let review = "";
  if (result.review?.status === "changes_requested") {
    review = ` Review: changes requested for v${result.review.version}.\n${result.review.feedback}`;
  } else if (result.review) {
    review = ` Review: ${result.review.status} v${result.review.version}.`;
  }
  return `${`Diagram ${result.diagramId} (${result.type}) ${version}; ${result.validationStatus}; ${result.path}.${suffix}`.slice(
    0,
    2_000,
  )}${review}`;
}

export async function createDiagramResult(
  projectRoot: string,
  artifact: DiagramArtifact,
): Promise<DiagramResult> {
  if (!Value.Check(diagramArtifactSchema, artifact)) {
    throw new Error("Invalid diagram artifact parameters");
  }
  const validation = await validateDiagramArtifact(artifact);
  const stored =
    validation.status === "passed"
      ? await storeDiagramVersion(projectRoot, artifact)
      : undefined;
  const path = resultPath(artifact.diagramId, stored ? stored.version : undefined);
  return {
    diagnostics: validation.diagnostics,
    diagramId: artifact.diagramId,
    path,
    previewStatus: "not-attempted",
    simplificationNotes: artifact.simplificationNotes ?? [],
    type: artifact.type,
    validationStatus: validation.status,
    version: stored ? stored.version : null,
  };
}

export async function previewDiagram(
  context: Pick<ExtensionContext, "cwd" | "hasUI" | "mode" | "isIdle" | "ui">,
  diagram: DiagramResult,
  mode: PreviewMode,
  reviewManager: DiagramReviewManager,
  openBrowser: typeof openBrowserPreview = openBrowserPreview,
): Promise<void> {
  if (mode === "browser") {
    let result: BrowserPreviewResult;
    try {
      result = await openBrowser(join(context.cwd, diagram.path));
    } catch (error) {
      result = {
        diagnostic: `Could not open browser preview: ${(error as Error).message}`,
        path: join(context.cwd, diagram.path),
        status: "failed",
      };
    }
    diagram.previewStatus = result.status;
    if (result.diagnostic) {
      diagram.diagnostics.push({
        code: "browser-preview",
        message: result.diagnostic,
      });
    }
    if (result.status === "opened") {
      diagram.review = await reviewManager.review(context, diagram);
    }
    return;
  }
  const status = await reviewManager.preview(context, diagram);
  if (status === "opened")
    diagram.review = await reviewManager.review(context, diagram);
}

export function registerDiagramTool(
  pi: ExtensionAPI,
  reviewManager = new DiagramReviewManager(pi),
): DiagramReviewManager {
  pi.on("session_shutdown", () => {
    reviewManager.closeAll();
  });
  pi.registerTool({
    description:
      "Validate and save a self-contained HTML diagram with inline SVG. Returns bounded metadata, never the HTML body.",
    executionMode: "sequential",
    label: "Create Diagram",
    name: "create_diagram",
    parameters: diagramArtifactSchema,
    promptSnippet:
      "Create a governed visual explanation as a versioned HTML/SVG diagram",
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const details = await createDiagramResult(ctx.cwd, params);
      if (details.validationStatus === "passed") {
        const configuration = await readDiagramConfig();
        if (configuration.diagnostic) {
          ctx.ui.notify(configuration.diagnostic, "warning");
        }
        if (!configuration.config.preview) {
          details.previewStatus = "disabled";
        } else {
          onUpdate?.({
            content: [
              {
                text: "Waiting for diagram review in Pi",
                type: "text",
              },
            ],
            details,
          });
          await previewDiagram(
            ctx,
            details,
            configuration.config.previewMode,
            reviewManager,
          );
        }
      }
      return {
        content: [
          {
            text: summary(details),
            type: "text",
          },
        ],
        details,
      };
    },
    promptGuidelines: [
      "Use create_diagram only when a visual explanation communicates relationships better than concise prose or a table.",
      "Before create_diagram, apply the diagram-design skill and its selected type reference, then follow its accessibility, connector, and complexity rules.",
      "Choose the supported diagram type and layout that best express the purpose; keep colors, typography, density, and motion within diagram-design or an explicitly selected user profile.",
      "The Glimpse preview theme is separate from diagram styling; do not add a style selector or invent a brand profile. Explain the style choice when it matters.",
      "create_diagram supports architecture, process, sequence, state-machine, and entity-relationship; use prose or a table when none fits.",
      "Include data-diagram-type on the accessible SVG and data-diagram-node/data-diagram-edge markers so create_diagram can enforce the selected type budget.",
      "A successful interactive preview waits for review: confirm accepts the current version, request changes only opens feedback, and close or cancel does not confirm.",
      "Return the review result to the Agent; preserve feedback text and version. Do not send a second user message for a tool review.",
      "The /xpi-diagram reopen command does not wait for review. Without a pending tool, feedback is delivered through the host when idle or steered when busy; disabled preview, headless mode, and unavailable Glimpse return directly.",
      "Report every merge, omission, or simplification in simplificationNotes; never invent facts to fill a layout.",
    ],
  });
  return reviewManager;
}
