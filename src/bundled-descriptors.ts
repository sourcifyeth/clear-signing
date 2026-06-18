/**
 * Bundled ERC-20 / ERC-721 template descriptors and the helper that adapts
 * them to a concrete deployment.
 *
 * Why the descriptors are committed as TypeScript `const`s (in `./bundled/*`)
 * rather than imported JSON:
 *   - `import descriptor from "./erc20.json" with { type: "json" }` import
 *     attributes caused build/tooling trouble in this project.
 *   - Plain TS bundles as code in every target (ESM, CJS, React Native,
 *     browser) with no `resolveJsonModule`, no esbuild JSON loader, and no
 *     import-attribute support required.
 *   - The objects get compile-time `Descriptor` typing for free.
 */

import type { Descriptor, TokenStandard } from "./types.js";
import { erc20Descriptor } from "./bundled/erc20.js";
import { erc721Descriptor } from "./bundled/erc721.js";

const templates: Record<TokenStandard, Descriptor> = {
  erc20: erc20Descriptor,
  erc721: erc721Descriptor,
};

/**
 * Builds a deployment-bound descriptor for a trusted token by cloning the
 * bundled template for `standard` and injecting
 * `context.contract.deployments = [{ chainId, address }]`, so the resulting
 * descriptor passes the library's deployment-binding check.
 */
export function buildBundledTokenDescriptor(
  standard: TokenStandard,
  chainId: number,
  address: string,
): Descriptor {
  const descriptor = structuredClone(templates[standard]);
  descriptor.context = {
    ...descriptor.context,
    contract: {
      ...descriptor.context?.contract,
      deployments: [{ chainId, address }],
    },
  };
  return descriptor;
}
