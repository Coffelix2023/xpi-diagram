import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  DiagramArtifact,
  DiagramType,
  ValidationDiagnostic,
  ValidationStatus,
} from "./contracts.js";

const execFileAsync = promisify(execFile);
const SELF_CHECK_PATH = fileURLToPath(
  new URL(
    "../docs/references/diagram-design/skills/diagram-design/scripts/self_check.py",
    import.meta.url,
  ),
);
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const TAG_PATTERN = /<([a-z][\w:-]*)\b([^>]*)>/gi;
const ATTRIBUTE_PATTERN =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const REMOTE_CSS_PATTERN = /url\(\s*["']?(?:https?:)?\/\//i;
const WHITESPACE_PATTERN = /\s+/;
const PYTHON_DIAGNOSTIC_PATTERN = /^\s*-\s+(.+)$/gm;
const FORBIDDEN_TAGS = new Set([
  "base",
  "embed",
  "iframe",
  "object",
]);
const REFERENCE_ATTRIBUTES = new Set([
  "action",
  "formaction",
  "href",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);

interface ParsedTag {
  attributes: Map<string, string>;
  name: string;
}

interface ValidationResult {
  diagnostics: ValidationDiagnostic[];
  status: ValidationStatus;
}

interface ComplexityBudget {
  edges?: number;
  lanes?: number;
  nodes?: number;
  steps?: number;
}

const COMPLEXITY_BUDGETS = {
  architecture: {
    edges: 12,
    nodes: 9,
  },
  "entity-relationship": {
    edges: 12,
    nodes: 8,
  },
  process: {
    edges: 12,
    lanes: 6,
    steps: 12,
  },
  sequence: {
    edges: 12,
    nodes: 5,
  },
  "state-machine": {
    edges: 12,
    nodes: 9,
  },
} satisfies Record<DiagramType, ComplexityBudget>;

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1]?.toLowerCase();
    if (name) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
}

function parseTags(html: string): ParsedTag[] {
  const source = html.replace(HTML_COMMENT_PATTERN, "");
  return Array.from(source.matchAll(TAG_PATTERN), (match) => ({
    attributes: parseAttributes(match[2] ?? ""),
    name: (match[1] ?? "").toLowerCase(),
  }));
}

function isApprovedReference(
  tag: ParsedTag,
  attribute: string,
  value: string,
): boolean {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.startsWith("#") ||
    normalized.toLowerCase().startsWith("data:image/")
  ) {
    return true;
  }
  if (tag.name !== "link" || attribute !== "href") {
    return false;
  }
  const rel = tag.attributes.get("rel")?.toLowerCase().split(WHITESPACE_PATTERN) ?? [];
  if (!rel.includes("stylesheet")) {
    return false;
  }
  try {
    const url = new URL(normalized);
    return (
      url.protocol === "https:" &&
      url.hostname === "fonts.googleapis.com" &&
      url.pathname === "/css2"
    );
  } catch {
    return false;
  }
}

function validateSafety(tags: ParsedTag[], html: string): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  for (const tag of tags) {
    if (FORBIDDEN_TAGS.has(tag.name)) {
      diagnostics.push({
        code: "forbidden-element",
        message: `<${tag.name}> is not allowed in a diagram file.`,
      });
    }
    for (const [name, value] of tag.attributes) {
      if (name.startsWith("on") || name === "srcdoc") {
        diagnostics.push({
          code: "executable-attribute",
          message: `Executable attribute ${name} is not allowed on <${tag.name}>.`,
        });
      }
      if (REFERENCE_ATTRIBUTES.has(name) && !isApprovedReference(tag, name, value)) {
        diagnostics.push({
          code: "non-inline-reference",
          message: `Non-inline reference ${name}="${value.slice(0, 80)}" is not allowed on <${tag.name}>.`,
        });
      }
    }
  }
  if (REMOTE_CSS_PATTERN.test(html)) {
    diagnostics.push({
      code: "remote-css-reference",
      message: "Remote CSS url() references are not allowed.",
    });
  }
  return diagnostics;
}

function markerValues(tags: ParsedTag[], marker: string): string[] {
  return tags.flatMap((tag) =>
    tag.attributes.has(marker)
      ? [
          tag.attributes.get(marker) ?? "",
        ]
      : [],
  );
}

interface BudgetDiagnosticOptions {
  count: number;
  diagnostics: ValidationDiagnostic[];
  dimension: keyof ComplexityBudget;
  maximum: number | undefined;
  type: DiagramType;
}

function addBudgetDiagnostic({
  count,
  diagnostics,
  dimension,
  maximum,
  type,
}: BudgetDiagnosticOptions): void {
  if (maximum === undefined || count <= maximum) {
    return;
  }
  diagnostics.push({
    code: `${dimension.slice(0, -1)}-budget-exceeded`,
    message:
      dimension === "lanes"
        ? `${type} allows at most ${maximum} distinct data-diagram-lane values; found ${count}.`
        : `${type} allows at most ${maximum} data-diagram-${dimension.slice(0, -1)} elements; found ${count}.`,
  });
}

function validateMetadataAndBudget(
  tags: ParsedTag[],
  artifact: DiagramArtifact,
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  const svg = tags.find(
    (tag) => tag.name === "svg" && tag.attributes.get("aria-hidden") !== "true",
  );
  const actualType = svg?.attributes.get("data-diagram-type") ?? "";
  if (actualType !== artifact.type) {
    diagnostics.push({
      code: "diagram-type-mismatch",
      message: `SVG data-diagram-type must be "${artifact.type}"; found "${actualType || "missing"}".`,
    });
  }

  const budget: ComplexityBudget = COMPLEXITY_BUDGETS[artifact.type];
  const nodes = markerValues(tags, "data-diagram-node").length;
  const edges = markerValues(tags, "data-diagram-edge").length;
  addBudgetDiagnostic({
    count: nodes,
    diagnostics,
    dimension: "nodes",
    maximum: budget.nodes,
    type: artifact.type,
  });
  addBudgetDiagnostic({
    count: edges,
    diagnostics,
    dimension: "edges",
    maximum: budget.edges,
    type: artifact.type,
  });

  const laneCount = new Set(markerValues(tags, "data-diagram-lane")).size;
  const stepCount = new Set(markerValues(tags, "data-diagram-step")).size;
  addBudgetDiagnostic({
    count: laneCount,
    diagnostics,
    dimension: "lanes",
    maximum: budget.lanes,
    type: artifact.type,
  });
  addBudgetDiagnostic({
    count: stepCount,
    diagnostics,
    dimension: "steps",
    maximum: budget.steps,
    type: artifact.type,
  });

  if (artifact.type === "state-machine" && edges > Math.min(12, nodes * 2)) {
    diagnostics.push({
      code: "transition-budget-exceeded",
      message: `state-machine allows at most twice as many transitions as states; found ${edges} transitions for ${nodes} states.`,
    });
  }
  return diagnostics;
}

async function runDiagramDesignCheck(html: string): Promise<ValidationResult> {
  const directory = await mkdtemp(join(tmpdir(), "xpi-diagram-check-"));
  const path = join(directory, "artifact.html");
  try {
    await writeFile(path, html, "utf8");
    await execFileAsync(
      "python3",
      [
        SELF_CHECK_PATH,
        path,
      ],
      {
        maxBuffer: 64 * 1024,
      },
    );
    return {
      diagnostics: [],
      status: "passed",
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
    };
    if (failure.code === "ENOENT") {
      return {
        status: "incomplete",
        diagnostics: [
          {
            code: "diagram-design-check-unavailable",
            message: "python3 is unavailable; diagram-design validation is incomplete.",
          },
        ],
      };
    }
    const messages = Array.from(
      failure.stdout?.matchAll(PYTHON_DIAGNOSTIC_PATTERN) ?? [],
      (match) => match[1],
    ).filter((message): message is string => Boolean(message));
    return {
      diagnostics: (messages.length > 0
        ? messages
        : [
            failure.message,
          ]
      ).map((message) => ({
        code: "diagram-design-check",
        message: message.slice(0, 500),
      })),
      status: "failed",
    };
  } finally {
    await rm(directory, {
      force: true,
      recursive: true,
    });
  }
}

export async function validateDiagramArtifact(
  artifact: DiagramArtifact,
): Promise<ValidationResult> {
  const tags = parseTags(artifact.html);
  const localDiagnostics = [
    ...validateSafety(tags, artifact.html),
    ...validateMetadataAndBudget(tags, artifact),
  ];
  const designCheck = await runDiagramDesignCheck(artifact.html);
  const diagnostics = [
    ...localDiagnostics,
    ...designCheck.diagnostics,
  ];
  const status =
    localDiagnostics.length > 0 || designCheck.status === "failed"
      ? "failed"
      : designCheck.status;
  return {
    diagnostics,
    status,
  };
}
