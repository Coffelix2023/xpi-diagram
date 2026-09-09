import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const VERSION = "0.1.0";

export default function xpiDiagram(pi: ExtensionAPI): void {
  pi.registerCommand("xpi-diagram", {
    description: "Show xpi-diagram status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`xpi-diagram ${VERSION} loaded`);
    },
  });
}
