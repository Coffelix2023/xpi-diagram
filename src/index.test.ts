import { existsSync, mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diagramConfigPath, readDiagramConfig } from "./config.js";
import type {
  DiagramConfigPanel,
  DiagramConfigPanelResult,
  PanelTheme,
} from "./config-panel.js";
import xpiDiagram from "./index.js";

const VISUAL_EXPLANATION_PATTERN = /visual explanation/i;
const PROSE_OR_TABLE_PATTERN = /prose|table/i;
const SUPPORTED_TYPES_PATTERN =
  /architecture.*process.*sequence.*state-machine.*entity-relationship/i;
const COMMAND_DESCRIPTION_PATTERN = /配置.*最新图表/;
const STYLE_PATTERN = /style|profile/i;
const REVIEW_PATTERN = /waits for review|review result/i;
const REOPEN_PATTERN = /reopen|pending tool|busy/i;

const temporaryDirectories: string[] = [];
const originalAgentDirectory = process.env.PI_CODING_AGENT_DIR;

afterEach(async () => {
  if (originalAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDirectory;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

function globalDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "xpi-diagram-global-test-"));
  temporaryDirectories.push(directory);
  process.env.PI_CODING_AGENT_DIR = directory;
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
  it("saves the toggled preview mode to the global config and leaves no project config", async () => {
    const global = globalDirectory();
    const project = mkdtempSync(join(tmpdir(), "xpi-diagram-index-test-"));
    temporaryDirectories.push(project);
    const handler = registeredCommand();
    const ui = {
      notify: vi.fn(),
      select: vi.fn(async () => "预览模式：Glimpse"),
    };
    const ctx = {
      cwd: project,
      mode: "rpc",
      isProjectTrusted: () => true,
      ui,
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    await expect(readDiagramConfig(global)).resolves.toEqual({
      config: {
        language: "zh-CN",
        preview: true,
        previewMode: "browser",
      },
    });
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("预览模式：浏览器"));
    expect(existsSync(join(project, ".pi", "xpi-diagram.json"))).toBe(false);
  });

  it("toggles automatic preview through the legacy selector", async () => {
    const global = globalDirectory();
    const project = mkdtempSync(join(tmpdir(), "xpi-diagram-index-test-"));
    temporaryDirectories.push(project);
    const handler = registeredCommand();
    const notify = vi.fn();
    const select = vi.fn(async () => "自动预览：开");
    const ctx = {
      cwd: project,
      mode: "rpc",
      isProjectTrusted: () => true,
      ui: {
        notify,
        select,
      },
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    await expect(readDiagramConfig(global)).resolves.toEqual({
      config: {
        language: "zh-CN",
        preview: false,
        previewMode: "glimpse",
      },
    });
    expect(select).toHaveBeenCalledWith(expect.stringContaining("xpi-diagram 配置"), [
      "自动预览：开",
      "预览模式：Glimpse",
      "显示语言：简体中文",
      "重新打开最新图表",
    ]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("自动预览：关"));
  });

  it("writes the TUI panel draft only after the panel closes", async () => {
    const global = globalDirectory();
    const project = mkdtempSync(join(tmpdir(), "xpi-diagram-index-test-"));
    temporaryDirectories.push(project);
    const handler = registeredCommand();
    let panelResult: DiagramConfigPanelResult | undefined;
    const custom = vi.fn(
      async (
        factory: (
          _tui: unknown,
          theme: PanelTheme,
          _keybindings: unknown,
          done: (result: DiagramConfigPanelResult | undefined) => void,
        ) => DiagramConfigPanel,
      ) => {
        let result: DiagramConfigPanelResult | undefined;
        const panel = factory(
          undefined,
          {
            bold: (t: string) => t,
            fg: (_c: string, t: string) => t,
          },
          undefined,
          (value) => {
            result = value;
          },
        );
        panel.handleInput(" ");
        expect(result).toBeUndefined();
        panel.handleInput("\r");
        panelResult = result;
        return panel;
      },
    );
    const notify = vi.fn();
    const ctx = {
      cwd: project,
      mode: "tui",
      isProjectTrusted: () => true,
      ui: {
        notify,
        custom,
      },
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    expect(custom).toHaveBeenCalledTimes(1);
    expect(panelResult?.config).toEqual({
      language: "zh-CN",
      preview: false,
      previewMode: "glimpse",
    });
    await expect(readDiagramConfig(global)).resolves.toEqual({
      config: {
        language: "zh-CN",
        preview: false,
        previewMode: "glimpse",
      },
    });
    expect(existsSync(join(project, ".pi", "xpi-diagram.json"))).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("配置已保存"));
  });

  it("keeps the global config untouched when the TUI panel is cancelled", async () => {
    const global = globalDirectory();
    const project = mkdtempSync(join(tmpdir(), "xpi-diagram-index-test-"));
    temporaryDirectories.push(project);
    await writeFile(diagramConfigPath(global), '{"preview":false}', "utf8");
    const handler = registeredCommand();
    const custom = vi.fn(
      async (
        factory: (
          _tui: unknown,
          _theme: unknown,
          _keybindings: unknown,
          done: (result: DiagramConfigPanelResult | undefined) => void,
        ) => unknown,
      ) => {
        factory(undefined, undefined, undefined, () => undefined);
        return undefined;
      },
    );
    const notify = vi.fn();
    const ctx = {
      cwd: project,
      mode: "tui",
      isProjectTrusted: () => true,
      ui: {
        notify,
        custom,
      },
    } as unknown as ExtensionCommandContext;

    await handler("", ctx);

    await expect(readDiagramConfig(global)).resolves.toEqual({
      config: {
        language: "zh-CN",
        preview: false,
        previewMode: "glimpse",
      },
    });
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("配置已保存"));
  });
});
