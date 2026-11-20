import type { Descriptor } from "../types.js";

/**
 * Bundled ERC-2612 Permit descriptor.
 *
 * Transcribed verbatim from the Ethereum clear-signing registry
 * (`ercs/eip712-erc2612-permit.json`). Committed as a TypeScript `const`
 * rather than imported JSON — see the rationale in `bundled-descriptors.ts`.
 *
 * The template carries no `context.eip712.deployments` and no
 * `context.eip712.domain`; both are injected per message by
 * `buildBundledPermitDescriptor`.
 */
export const erc2612PermitDescriptor: Descriptor = {
  context: { eip712: {} },
  display: {
    formats: {
      "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)":
        {
          intent: "Authorize spending of tokens",
          fields: [
            {
              path: "spender",
              label: "Spender",
              format: "raw",
              visible: "always",
            },
            {
              path: "value",
              label: "Max spending amount",
              format: "tokenAmount",
              params: {
                tokenPath: "@.to",
                threshold:
                  "0x8000000000000000000000000000000000000000000000000000000000000000",
                message: "Unlimited",
              },
              visible: "always",
            },
            {
              path: "deadline",
              label: "Valid until",
              format: "date",
              params: { encoding: "timestamp" },
            },
            {
              path: "owner",
              label: "Owner",
              format: "addressName",
              params: {
                types: ["eoa", "wallet"],
                sources: ["local", "ens"],
              },
              visible: "always",
            },
            { label: "Nonce", path: "nonce", visible: "never" },
          ],
        },
    },
  },
} as const;
