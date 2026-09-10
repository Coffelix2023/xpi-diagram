import { describe, expect, it, vi } from "vitest";
import { type BrowserPreviewLauncher, openBrowserPreview } from "./browser-preview.js";

describe("browser preview", () => {
  it.each([
    [
      "darwin",
      "open",
      [
        "/tmp/diagram.html",
      ],
    ],
    [
      "linux",
      "xdg-open",
      [
        "/tmp/diagram.html",
      ],
    ],
    [
      "win32",
      "cmd.exe",
      [
        "/d",
        "/c",
        "start",
        "",
        "/tmp/diagram.html",
      ],
    ],
  ] as const)(
    "uses parameterized native arguments on %s",
    async (platform, command, args) => {
      const launch = vi.fn<BrowserPreviewLauncher>(async () => undefined);

      await expect(
        openBrowserPreview("/tmp/diagram.html", {
          launch,
          platform,
        }),
      ).resolves.toEqual({
        path: "/tmp/diagram.html",
        status: "opened",
      });
      expect(launch).toHaveBeenCalledWith(command, args);
    },
  );

  it("reports an unknown platform without launching a process", async () => {
    const launch = vi.fn<BrowserPreviewLauncher>(async () => undefined);

    await expect(
      openBrowserPreview("/tmp/diagram.html", {
        launch,
        platform: "freebsd" as NodeJS.Platform,
      }),
    ).resolves.toMatchObject({
      path: "/tmp/diagram.html",
      status: "unavailable",
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it("preserves the artifact path when browser launch fails", async () => {
    const launch = vi.fn<BrowserPreviewLauncher>(async () => {
      throw new Error("xdg-open missing");
    });

    await expect(
      openBrowserPreview("/tmp/diagram.html", {
        launch,
        platform: "linux",
      }),
    ).resolves.toMatchObject({
      diagnostic: "Could not open browser preview: xdg-open missing",
      path: "/tmp/diagram.html",
      status: "failed",
    });
  });
});
