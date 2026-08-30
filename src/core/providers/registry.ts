import type { BuiltInProviderId, ProviderPlugin } from "./contracts";

type ProviderModule = { default: ProviderPlugin };

const modules = import.meta.glob<ProviderModule>("/src/providers/*/index.ts", {
  eager: true,
});

const plugins = Object.values(modules).map((module) => module.default);
const byId = new Map(plugins.map((plugin) => [plugin.definition.id, plugin]));

if (byId.size !== plugins.length) {
  throw new Error("Provider registry contains duplicate IDs");
}

export const providerRegistry = {
  all(): readonly ProviderPlugin[] {
    return plugins;
  },
  get(id: BuiltInProviderId): ProviderPlugin {
    const plugin = byId.get(id);
    if (!plugin) throw new Error(`Unknown provider: ${id}`);
    return plugin;
  },
  match(url: string): ProviderPlugin | undefined {
    const parsed = new URL(url);
    return plugins.find((plugin) =>
      plugin.definition.matches.some((pattern) => matchPattern(parsed, pattern)),
    );
  },
};

function matchPattern(url: URL, pattern: string): boolean {
  const match = /^(https?):\/\/([^/]+)\/\*$/.exec(pattern);
  if (!match) return false;
  const [, protocol, host] = match;
  if (`${protocol}:` !== url.protocol) return false;
  if (host?.startsWith("*.")) {
    const suffix = host.slice(2);
    return url.hostname === suffix || url.hostname.endsWith(`.${suffix}`);
  }
  return url.hostname === host;
}
