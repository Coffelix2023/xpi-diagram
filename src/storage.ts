import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Value } from "typebox/value";
import type { DiagramArtifact } from "./contracts.js";
import { diagramIdSchema } from "./contracts.js";

const DIAGRAM_DIRECTORY = ".pi/diagram";
const VERSION_FILE_PATTERN = /^v(\d+)\.html$/;

export interface StoredDiagramVersion {
  path: string;
  version: number;
}

function nextVersion(files: string[]): number {
  return (
    files.reduce((highest, file) => {
      const version = Number(VERSION_FILE_PATTERN.exec(file)?.[1] ?? 0);
      return Number.isSafeInteger(version) ? Math.max(highest, version) : highest;
    }, 0) + 1
  );
}

function assertInsideProject(projectRoot: string, target: string): void {
  const projectRelative = relative(projectRoot, target);
  if (projectRelative.startsWith("..") || projectRelative.startsWith("/")) {
    throw new Error("Diagram output escaped the project directory");
  }
}
async function writeNextVersion(
  projectRoot: string,
  diagramDirectory: string,
  html: string,
): Promise<StoredDiagramVersion> {
  const version = nextVersion(await readdir(diagramDirectory));
  const target = join(diagramDirectory, `v${version}.html`);
  const temporary = join(diagramDirectory, `.v${version}.${randomUUID()}.tmp`);
  assertInsideProject(projectRoot, target);
  try {
    await writeFile(temporary, html, {
      encoding: "utf8",
      flag: "wx",
    });
    await link(temporary, target);
    return {
      path: target,
      version,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return writeNextVersion(projectRoot, diagramDirectory, html);
    }
    throw error;
  } finally {
    await rm(temporary, {
      force: true,
    });
  }
}

export async function storeDiagramVersion(
  projectRoot: string,
  artifact: DiagramArtifact,
): Promise<StoredDiagramVersion> {
  if (!Value.Check(diagramIdSchema, artifact.diagramId)) {
    throw new Error(`Unsafe diagram ID: ${artifact.diagramId}`);
  }

  const resolvedProjectRoot = resolve(projectRoot);
  const canonicalProjectRoot = await realpath(resolvedProjectRoot);
  const diagramRoot = join(resolvedProjectRoot, DIAGRAM_DIRECTORY);
  const diagramDirectory = join(diagramRoot, artifact.diagramId);
  assertInsideProject(resolvedProjectRoot, diagramDirectory);
  await mkdir(diagramDirectory, {
    recursive: true,
  });
  assertInsideProject(canonicalProjectRoot, await realpath(diagramDirectory));

  return writeNextVersion(resolvedProjectRoot, diagramDirectory, artifact.html);
}
export interface LatestDiagram extends StoredDiagramVersion {
  diagramId: string;
}

export async function findLatestDiagram(
  projectRoot: string,
): Promise<LatestDiagram | null> {
  const resolvedProjectRoot = resolve(projectRoot);
  const canonicalProjectRoot = await realpath(resolvedProjectRoot);
  const diagramRoot = join(resolvedProjectRoot, DIAGRAM_DIRECTORY);
  let directories: import("node:fs").Dirent[];
  try {
    directories = await readdir(diagramRoot, {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const candidates = (
    await Promise.all(
      directories
        .filter(
          (directory) =>
            directory.isDirectory() && Value.Check(diagramIdSchema, directory.name),
        )
        .map(async (directory) => {
          const diagramDirectory = join(diagramRoot, directory.name);
          const files = await readdir(diagramDirectory);
          return (
            await Promise.all(
              files.map(async (file) => {
                const match = VERSION_FILE_PATTERN.exec(file);
                if (!match) return null;
                const version = Number(match[1]);
                if (!Number.isSafeInteger(version) || version < 1) return null;
                const path = join(diagramDirectory, file);
                assertInsideProject(resolvedProjectRoot, path);
                const canonicalPath = await realpath(path);
                assertInsideProject(canonicalProjectRoot, canonicalPath);
                const modifiedAt = (await stat(canonicalPath)).mtimeMs;
                return {
                  diagramId: directory.name,
                  modifiedAt,
                  path,
                  version,
                };
              }),
            )
          ).filter(
            (
              candidate,
            ): candidate is {
              diagramId: string;
              modifiedAt: number;
              path: string;
              version: number;
            } => candidate !== null,
          );
        }),
    )
  ).flat();
  const latest = candidates.reduce<(typeof candidates)[number] | undefined>(
    (current, candidate) =>
      !current ||
      candidate.modifiedAt > current.modifiedAt ||
      (candidate.modifiedAt === current.modifiedAt && candidate.path > current.path)
        ? candidate
        : current,
    undefined,
  );
  if (!latest) return null;
  return {
    diagramId: latest.diagramId,
    path: latest.path,
    version: latest.version,
  };
}
