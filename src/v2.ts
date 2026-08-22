import type { V2Plugin } from "./index.ts"
import legacyPlugin from "./index.ts"

const plugin = legacyPlugin as typeof legacyPlugin & { readonly v2?: V2Plugin }

if (plugin.v2 === undefined) {
  throw new Error("@beremaran/opencode-subagent-throttle: OpenCode 2 adapter is unavailable")
}

export default plugin.v2
