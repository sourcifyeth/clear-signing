/**
 * Bundled ERC-20 / ERC-721 / ERC-2612 template descriptors and the helpers
 * that adapt them to a concrete deployment.
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

import type { Descriptor, TokenStandard, TypedDataDomain } from "./types.js";
import { erc20Descriptor } from "./bundled/erc20.js";
import { erc721Descriptor } from "./bundled/erc721.js";
import { erc2612PermitDescriptor } from "./bundled/erc2612-permit.js";

// An ERC-2612 token is an ERC-20 token. Its calls use the ERC-20 template.
const calldataTemplates: Record<TokenStandard, Descriptor> = {
  erc20: erc20Descriptor,
  erc721: erc721Descriptor,
  erc2612: erc20Descriptor,
};

/** The `encodeType` of the ERC-2612 `Permit` message. */
export const ERC2612_PERMIT_ENCODE_TYPE =
  "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)";

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
  const descriptor = structuredClone(calldataTemplates[standard]);
  descriptor.context = {
    ...descriptor.context,
    contract: {
      ...descriptor.context?.contract,
      deployments: [{ chainId, address }],
    },
  };
  return descriptor;
}

/**
 * Builds a descriptor for an ERC-2612 `Permit` message of a trusted token by
 * cloning the bundled Permit template and injecting
 * `context.eip712.deployments = [{ chainId, address }]` and
 * `context.eip712.domain = domain`, so the resulting descriptor passes the
 * library's EIP-712 binding check.
 */
export function buildBundledPermitDescriptor(
  chainId: number,
  address: string,
  domain: TypedDataDomain,
): Descriptor {
  const descriptor = structuredClone(erc2612PermitDescriptor);
  descriptor.context = {
    ...descriptor.context,
    eip712: {
      ...descriptor.context?.eip712,
      deployments: [{ chainId, address }],
      domain: Object.fromEntries(
        Object.entries(domain).filter(([, value]) => value !== undefined),
      ),
    },
  };
  return descriptor;
}
