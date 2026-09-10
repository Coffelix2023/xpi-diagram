import { describe, expect, it, vi } from "vitest";
import type { DiagramConfigPanelResult } from "./config-panel.js";
import { DiagramConfigPanel } from "./config-panel.js";

const initialConfig = {
  language: "zh-CN",
  preview: true,
  previewMode: "glimpse",
} as const;

function fakeTheme() {
  return {
    bold: (text: string) => `<bold>${text}</bold>`,
    fg: (_color: string, text: string) => text,
  } as never;
}

describe("DiagramConfigPanel", () => {
  it("toggles values with Space and saves the draft with Enter", () => {
    const done = vi.fn<(result: DiagramConfigPanelResult | undefined) => void>();
    const panel = new DiagramConfigPanel(initialConfig, fakeTheme(), done);

    panel.handleInput(" ");
    expect(done).not.toHaveBeenCalled();

    panel.handleInput("\u001b[B");
    panel.handleInput(" ");
    panel.handleInput("\u001b[B");
    panel.handleInput(" ");
    panel.handleInput("\r");

    expect(done).toHaveBeenCalledWith({
      reopenLatest: false,
      config: {
        language: "en",
        preview: false,
        previewMode: "browser",
      },
    });
  });

  it("cancels without returning a config", () => {
    const done = vi.fn<(result: DiagramConfigPanelResult | undefined) => void>();
    const panel = new DiagramConfigPanel(initialConfig, fakeTheme(), done);

    panel.handleInput(" ");
    panel.handleInput("\u001b");

    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("renders translated values after switching language", () => {
    const done = vi.fn<(result: DiagramConfigPanelResult | undefined) => void>();
    const panel = new DiagramConfigPanel(initialConfig, fakeTheme(), done);

    panel.handleInput("\u001b[B");
    panel.handleInput("\u001b[B");
    panel.handleInput(" ");

    expect(panel.render(80).join("\n")).toContain("Display language: English");
    expect(panel.render(80).join("\n")).toContain("Space toggle");
  });
});
