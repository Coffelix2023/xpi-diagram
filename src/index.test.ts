import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDiagramConfig } from "./config.js";
import xpiDiagram from "./index.js";

const VISUAL_EXPLANATION_PATTERN = /visual explanation/i;
const PROSE_OR_TABLE_PATTERN = /prose|table/i;
const SUPPORTED_TYPES_PATTERN =
  /architecture.*process.*sequence.*state-machine.*entity-relationship/i;
const COMMAND_DESCRIPTION_PATTERN = /configure.*latest/i;
const STYLE_PATTERN = /style|profile/i;
const REVIEW_PATTERN = /waits for review|review result/i;
const REOPEN_PATTERN = /reopen|pending tool|busy/i;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

async function projectDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xpi-diagram-index-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function registeredCommand(): (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void> {
  const commands: Array<Record<string, unknown>> = [];
  xpiDiagram({
    on: () => undefined,
    registerCommand: (name: string, command: Record<string, unknown>) => {
      if (name === "xpi-diagram") commands.push(command);
    },
    registerTool: () => undefined,
    sendUserMessage: () => undefined,
  } as unknown as ExtensionAPI);
  const command = commands[0];
  if (!command) throw new Error("/xpi-diagram was not registered");
  return command.handler as (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<void>;
}

describe("xpi-diagram registration", () => {
  it("exposes create_diagram and the native configuration command", () => {
    const tools: Array<Record<string, unknown>> = [];
    const commands: Array<Record<string, unknown>> = [];
    const pi = {
      on: () => undefined,
      registerCommand: (_name: string, command: Record<string, unknown>) =>
        commands.push(command),
      registerTool: (tool: Record<string, unknown>) => tools.push(tool),
      sendUserMessage: () => undefined,
    } as unknown as ExtensionAPI;

    xpiDiagram(pi);

    expect(commands).toHaveLength(1);
    expect(commands[0]?.description).toMatch(COMMAND_DESCRIPTION_PATTERN);
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    if (!tool) {
      throw new Error("create_diagram was not registered");
    }
    expect(tool.name).toBe("create_diagram");
    const promptSnippet = tool.promptSnippet;
    expect(promptSnippet).toMatch(VISUAL_EXPLANATION_PATTERN);

    const guidance = (tool.promptGuidelines as string[]).join(" ");
    expect(guidance).toContain("create_diagram");
    expect(guidance).toContain("diagram-design");
    expect(guidance).toMatch(PROSE_OR_TABLE_PATTERN);
    expect(guidance).toMatch(SUPPORTED_TYPES_PATTERN);
    expect(guidance).toMatch(STYLE_PATTERN);
    expect(guidance).toMatch(REVIEW_PATTERN);
    expect(guidance).toMatch(REOPEN_PATTERN);
  });
});

describe("xpi-diagram command configuration", () => {
  it("persists the selected preview mode and keeps the preview toggle", async () => {
    const project = await projectDirectory();
    await mkdir(join(project, ".pi"), {
      recursive: true,
    });
    await writeFile(
      join(project, ".pi", "xpi-diagram.json"),
      '{"preview":false}',
      "utf8",
    );
    const handler = registeredCommand();
    const ui = {
      notify: vi.fn(),
      select: vi.fn(async () => "Preview in browser"),
    };
    const ctx = {
      cwd: project,
      isProjectTrusted: () => true,
      ui,
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    await expect(readDiagramConfig(project)).resolves.toEqual({
      trusted: true,
      config: {
        preview: false,
        previewMode: "browser",
      },
    });
    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("mode set to browser"),
    );
  });

  it("reports status including the preview mode", async () => {
    const project = await projectDirectory();
    const handler = registeredCommand();
    const notify = vi.fn();
    const ctx = {
      cwd: project,
      isProjectTrusted: () => true,
      ui: {
        notify,
        select: vi.fn(async () => "View status"),
      },
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("mode is glimpse"));
  });
});
