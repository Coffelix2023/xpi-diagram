import { spawn } from "node:child_process";
import { resolve } from "node:path";

export type BrowserPreviewStatus = "opened" | "unavailable" | "failed";

export interface BrowserPreviewResult {
  diagnostic?: string;
  path: string;
  status: BrowserPreviewStatus;
}

export type BrowserPreviewLauncher = (
  command: string,
  args: readonly string[],
) => Promise<void>;

export interface BrowserPreviewOptions {
  launch?: BrowserPreviewLauncher;
  platform?: NodeJS.Platform;
}

function nativeCommand(
  platform: NodeJS.Platform,
  path: string,
):
  | {
      args: string[];
      command: string;
    }
  | undefined {
  if (platform === "darwin")
    return {
      command: "open",
      args: [
        path,
      ],
    };
  if (platform === "linux")
    return {
      command: "xdg-open",
      args: [
        path,
      ],
    };
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: [
        "/d",
        "/c",
        "start",
        "",
        path,
      ],
    };
  }
  return undefined;
}

const launchNativeBrowser: BrowserPreviewLauncher = (command, args) =>
  new Promise((resolveLaunch, rejectLaunch) => {
    try {
      const child = spawn(
        command,
        [
          ...args,
        ],
        {
          detached: true,
          stdio: "ignore",
        },
      );
      let settled = false;
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        rejectLaunch(error);
      });
      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolveLaunch();
      });
    } catch (error) {
      rejectLaunch(error);
    }
  });

export async function openBrowserPreview(
  filePath: string,
  options: BrowserPreviewOptions = {},
): Promise<BrowserPreviewResult> {
  const path = resolve(filePath);
  const platform = options.platform ?? process.platform;
  const command = nativeCommand(platform, path);
  if (!command) {
    return {
      diagnostic: `Unsupported browser preview platform: ${platform}`,
      path,
      status: "unavailable",
    };
  }

  try {
    await (options.launch ?? launchNativeBrowser)(command.command, command.args);
    return {
      path,
      status: "opened",
    };
  } catch (error) {
    return {
      diagnostic: `Could not open browser preview: ${(error as Error).message}`,
      path,
      status: "failed",
    };
  }
}
