/**
 * Token registry helpers for the clear signing engine.
 */

import type { TokenMeta } from "./types.js";
import tokensMinJson from "./assets/tokens-min.json" with { type: "json" };

interface TokenRegistryEntry {
  symbol: string;
  decimals: number;
  name: string;
}

type TokenRegistry = Record<string, TokenRegistryEntry>;

const tokenRegistry: TokenRegistry = tokensMinJson as TokenRegistry;

// Pre-normalize keys for faster lookup
const normalizedRegistry = new Map<string, TokenMeta>();
for (const [key, entry] of Object.entries(tokenRegistry)) {
  normalizedRegistry.set(key.toLowerCase(), {
    symbol: entry.symbol,
    decimals: entry.decimals,
    name: entry.name,
  });
}

/**
 * Returns token metadata associated with a CAIP-19 identifier, if present.
 */
export function lookupTokenByCaip19(caip19: string): TokenMeta | undefined {
  const key = caip19.trim().toLowerCase();
  return normalizedRegistry.get(key);
}
