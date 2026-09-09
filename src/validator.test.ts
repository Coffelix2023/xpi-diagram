import { describe, expect, it } from "vitest";
import type { DiagramType } from "./contracts.js";
import { validateDiagramArtifact } from "./validator.js";

const DESC_ELEMENT_PATTERN = /<desc[\s\S]*?<\/desc>/;
const ACCESSIBILITY_ERROR_PATTERN = /role=img|title and desc/i;
const REMOTE_REFERENCE_PATTERN = /remote reference|non-inline reference/i;
const EXECUTABLE_ATTRIBUTE_PATTERN = /executable attribute/i;
const IFRAME_PATTERN = /iframe/i;
const SCRIPT_PATTERN = /script/i;

function markers(attribute: string, count: number): string {
  return Array.from(
    {
      length: count,
    },
    (_, index) => `<g ${attribute}="${index + 1}"></g>`,
  ).join("");
}

function validDiagram(
  type: DiagramType,
  options: {
    edges?: number;
    lanes?: number;
    nodes?: number;
    steps?: number;
  } = {},
): string {
  const slug = type.replaceAll("-", "_");
  return `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<svg role="img" aria-labelledby="${slug}-title ${slug}-desc" data-diagram-type="${type}">
<title id="${slug}-title">${type}</title>
<desc id="${slug}-desc">A representative ${type} diagram.</desc>
${markers("data-diagram-node", options.nodes ?? 2)}
${markers("data-diagram-edge", options.edges ?? 1)}
${markers("data-diagram-lane", options.lanes ?? (type === "process" ? 2 : 0))}
${markers("data-diagram-step", options.steps ?? (type === "process" ? 2 : 0))}
</svg>
</body></html>`;
}

describe("validateDiagramArtifact", () => {
  it.each([
    "architecture",
    "process",
    "sequence",
    "state-machine",
    "entity-relationship",
  ] as const)("accepts a representative %s diagram", async (type) => {
    const result = await validateDiagramArtifact({
      diagramId: `${type}-example`,
      html: validDiagram(type),
      type,
    });

    expect(result).toEqual({
      diagnostics: [],
      status: "passed",
    });
  });

  it("reports missing accessible SVG metadata", async () => {
    const html = validDiagram("architecture")
      .replace('role="img"', "")
      .replace(DESC_ELEMENT_PATTERN, "");
    const result = await validateDiagramArtifact({
      diagramId: "bad-accessibility",
      html,
      type: "architecture",
    });

    expect(result.status).toBe("failed");
    expect(result.diagnostics.map(({ message }) => message).join(" ")).toMatch(
      ACCESSIBILITY_ERROR_PATTERN,
    );
  });

  it("rejects unsafe references, event handlers, and scripts", async () => {
    const html = validDiagram("architecture").replace(
      "</svg>",
      '<image href="https://example.com/tracker.svg" onclick="steal()"></image><iframe src="local.html"></iframe><script>alert(1)</script></svg>',
    );
    const result = await validateDiagramArtifact({
      diagramId: "unsafe",
      html,
      type: "architecture",
    });

    expect(result.status).toBe("failed");
    const messages = result.diagnostics.map(({ message }) => message).join(" ");
    expect(messages).toMatch(REMOTE_REFERENCE_PATTERN);
    expect(messages).toMatch(EXECUTABLE_ATTRIBUTE_PATTERN);
    expect(messages).toMatch(IFRAME_PATTERN);
    expect(messages).toMatch(SCRIPT_PATTERN);
  });

  it("rejects type metadata that differs from the request", async () => {
    const result = await validateDiagramArtifact({
      diagramId: "wrong-type",
      html: validDiagram("architecture").replace(
        'data-diagram-type="architecture"',
        'data-diagram-type="sequence"',
      ),
      type: "architecture",
    });

    expect(result.status).toBe("failed");
    expect(result.diagnostics).toContainEqual({
      code: "diagram-type-mismatch",
      message: 'SVG data-diagram-type must be "architecture"; found "sequence".',
    });
  });

  it("enforces type-specific complexity limits", async () => {
    const architecture = await validateDiagramArtifact({
      diagramId: "too-many-nodes",
      html: validDiagram("architecture", {
        nodes: 10,
      }),
      type: "architecture",
    });
    const sequence = await validateDiagramArtifact({
      diagramId: "too-many-lifelines",
      html: validDiagram("sequence", {
        nodes: 6,
      }),
      type: "sequence",
    });
    const process = await validateDiagramArtifact({
      diagramId: "too-many-lanes",
      html: validDiagram("process", {
        lanes: 7,
      }),
      type: "process",
    });

    expect(architecture.diagnostics).toContainEqual({
      code: "node-budget-exceeded",
      message: "architecture allows at most 9 data-diagram-node elements; found 10.",
    });
    expect(sequence.diagnostics).toContainEqual({
      code: "node-budget-exceeded",
      message: "sequence allows at most 5 data-diagram-node elements; found 6.",
    });
    expect(process.diagnostics).toContainEqual({
      code: "lane-budget-exceeded",
      message: "process allows at most 6 distinct data-diagram-lane values; found 7.",
    });
  });
});
