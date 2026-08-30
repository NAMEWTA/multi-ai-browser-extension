import { defineConfig } from "wxt";
import { builtInProviderMatches } from "./src/core/providers/built-in-sites";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  manifest: {
    name: "Multi AI Workspace",
    description: "在多个真实 AI 网页中同步输入、统一发送，并排比较原生回答。",
    version: "0.0.1.3",
    version_name: "0.0.1-alpha.3",
    minimum_chrome_version: "120",
    permissions: ["storage", "tabs", "webNavigation", "declarativeNetRequestWithHostAccess"],
    host_permissions: [...builtInProviderMatches],
    action: {
      default_title: "打开 Multi AI Workspace",
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
    },
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
  },
});

export { builtInProviderMatches };
