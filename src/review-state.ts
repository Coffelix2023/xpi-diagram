import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Value } from "typebox/value";
import { diagramIdSchema } from "./contracts.js";

const REVIEW_STATE_FILE = "review.json";

export interface DiagramReviewState {
  confirmedVersion: number | null;
  currentVersion: number;
  latestFeedback?: {
    feedback: string;
    status: "pending" | "sent";
    submittedAt: string;
    version: number;
  };
  updatedAt: string;
}

function statePath(projectRoot: string, diagramId: string): string {
  if (!Value.Check(diagramIdSchema, diagramId)) {
    throw new Error(`Unsafe diagram ID: ${diagramId}`);
  }
  const root = resolve(projectRoot);
  const target = join(root, ".pi", "diagram", diagramId, REVIEW_STATE_FILE);
  const projectRelative = relative(root, target);
  if (projectRelative.startsWith("..") || projectRelative.startsWith("/")) {
    throw new Error("Diagram review state escaped the project directory");
  }
  return target;
}

export async function readDiagramReviewState(
  projectRoot: string,
  diagramId: string,
): Promise<DiagramReviewState | null> {
  try {
    return JSON.parse(
      await readFile(statePath(projectRoot, diagramId), "utf8"),
    ) as DiagramReviewState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeDiagramReviewState(
  projectRoot: string,
  diagramId: string,
  state: DiagramReviewState,
): Promise<void> {
  const target = statePath(projectRoot, diagramId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), {
    recursive: true,
  });
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, target);
  } finally {
    await rm(temporary, {
      force: true,
    });
  }
}
