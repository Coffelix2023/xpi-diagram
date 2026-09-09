import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import xpiDiagram from "./index.js";

const VISUAL_EXPLANATION_PATTERN = /visual explanation/i;
const PROSE_OR_TABLE_PATTERN = /prose|table/i;
const SUPPORTED_TYPES_PATTERN =
  /architecture.*process.*sequence.*state-machine.*entity-relationship/i;
const COMMAND_DESCRIPTION_PATTERN = /configure.*latest/i;

const STYLE_PATTERN = /style|profile/i;
const REVIEW_PATTERN = /waits for review|review result/i;
const REOPEN_PATTERN = /reopen|pending tool|busy/i;
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
