import { Container, Key, matchesKey } from "@earendil-works/pi-tui";
import type { DiagramConfig, PreviewMode, UiLanguage } from "./config.js";

export interface PanelTheme {
  bold(text: string): string;
  fg(color: string, text: string): string;
}

export interface DiagramConfigPanelResult {
  config: DiagramConfig;
  reopenLatest: boolean;
}

interface PanelCopy {
  automaticPreview: string;
  browser: string;
  displayLanguage: string;
  english: string;
  glimpse: string;
  hints: string;
  off: string;
  on: string;
  previewMode: string;
  reopenLatest: string;
  simplifiedChinese: string;
  title: string;
}

function copy(language: UiLanguage): PanelCopy {
  return language === "en"
    ? {
        automaticPreview: "Automatic preview",
        browser: "Browser",
        displayLanguage: "Display language",
        english: "English",
        glimpse: "Glimpse",
        hints: "Up/Down navigate  Space toggle  Enter save  Esc cancel",
        off: "off",
        on: "on",
        previewMode: "Preview mode",
        reopenLatest: "Reopen latest diagram",
        simplifiedChinese: "Simplified Chinese",
        title: "xpi-diagram configuration",
      }
    : {
        automaticPreview: "自动预览",
        browser: "浏览器",
        displayLanguage: "显示语言",
        english: "英语",
        glimpse: "Glimpse",
        hints: "上下移动  空格切换  Enter 保存  Esc 取消",
        off: "关",
        on: "开",
        previewMode: "预览模式",
        reopenLatest: "重新打开最新图表",
        simplifiedChinese: "简体中文",
        title: "xpi-diagram 配置",
      };
}

export class DiagramConfigPanel extends Container {
  private config: DiagramConfig;
  private selectedIndex = 0;
  private closed = false;

  constructor(
    initialConfig: DiagramConfig,
    private readonly theme: PanelTheme,
    private readonly done: (result: DiagramConfigPanelResult | undefined) => void,
  ) {
    super();
    this.config = {
      ...initialConfig,
    };
  }

  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(3, this.selectedIndex + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.space) || data === " ") {
      this.toggleSelected();
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.enter) || data === "\n") {
      this.close({
        reopenLatest: this.selectedIndex === 3,
        config: {
          ...this.config,
        },
      });
      return;
    }
    if (matchesKey(data, Key.escape)) this.close(undefined);
  }

  render(_width: number): string[] {
    const text = copy(this.config.language);
    const values = [
      `${text.automaticPreview}: ${this.config.preview ? text.on : text.off}`,
      `${text.previewMode}: ${this.config.previewMode === "glimpse" ? text.glimpse : text.browser}`,
      `${text.displayLanguage}: ${this.config.language === "zh-CN" ? text.simplifiedChinese : text.english}`,
      text.reopenLatest,
    ];
    return [
      this.theme.bold(this.theme.fg("accent", text.title)),
      "",
      ...values.map((value, index) =>
        index === this.selectedIndex
          ? this.theme.fg("accent", `> ${value}`)
          : `  ${this.theme.fg("text", value)}`,
      ),
      "",
      this.theme.fg("muted", text.hints),
    ];
  }

  private toggleSelected(): void {
    if (this.selectedIndex === 0) {
      this.config = {
        ...this.config,
        preview: !this.config.preview,
      };
    } else if (this.selectedIndex === 1) {
      const previewMode: PreviewMode =
        this.config.previewMode === "glimpse" ? "browser" : "glimpse";
      this.config = {
        ...this.config,
        previewMode,
      };
    } else if (this.selectedIndex === 2) {
      const language: UiLanguage = this.config.language === "zh-CN" ? "en" : "zh-CN";
      this.config = {
        ...this.config,
        language,
      };
    }
  }

  private close(result: DiagramConfigPanelResult | undefined): void {
    this.closed = true;
    this.done(result);
  }
}
