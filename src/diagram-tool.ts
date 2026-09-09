import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { readDiagramConfig } from "./config.js";
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
  return `Diagram ${result.diagramId} (${result.type}) ${version}; ${result.validationStatus}; ${result.path}.${suffix}`.slice(
    0,
    2_000,
  );
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
    label: "Create Diagram",
    name: "create_diagram",
    parameters: diagramArtifactSchema,
    promptSnippet:
      "Create a governed visual explanation as a versioned HTML/SVG diagram",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const details = await createDiagramResult(ctx.cwd, params);
      if (details.validationStatus === "passed") {
        const configuration = await readDiagramConfig(
          ctx.cwd,
          ctx.isProjectTrusted?.() ?? true,
        );
        if (configuration.diagnostic) {
          ctx.ui.notify(configuration.diagnostic, "warning");
        }
        if (!configuration.config.preview) {
          details.previewStatus = "disabled";
        } else {
          await reviewManager.preview(ctx, details);
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
      "create_diagram supports architecture, process, sequence, state-machine, and entity-relationship; use prose or a table when none fits.",
      "Include data-diagram-type on the accessible SVG and data-diagram-node/data-diagram-edge markers so create_diagram can enforce the selected type budget.",
      "Report every merge, omission, or simplification in simplificationNotes; never invent facts to fill a layout.",
    ],
  });
  return reviewManager;
}
