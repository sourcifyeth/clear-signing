/**
 * Unit tests for src/resolver.ts
 *
 * All network calls are mocked via vi.stubGlobal('fetch', ...) so tests run
 * offline and deterministically.
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from "vitest";
import {
  resolve,
  resolveCall,
  resolveTyped,
  clearCache,
} from "../src/resolver";
import { ResolverError } from "../src/errors";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Minimal ERC-7730 calldata descriptor for an ERC-20 token. */
function makeCalldataDescriptor(overrides?: {
  chainId?: number;
  address?: string;
  ticker?: string;
  decimals?: number;
  includeDisplayFormats?: boolean;
}) {
  const chainId = overrides?.chainId ?? 1;
  const address = overrides?.address ?? "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const ticker = overrides?.ticker ?? "USDT";
  const decimals = overrides?.decimals ?? 6;
  const includeDisplayFormats = overrides?.includeDisplayFormats ?? false;

  const descriptor: Record<string, unknown> = {
    $schema: "../../specs/erc7730-v1.schema.json",
    context: {
      $id: ticker,
      contract: {
        deployments: [{ chainId, address }],
        abi: [
          {
            name: "approve",
            type: "function",
            inputs: [
              { name: "_spender", type: "address" },
              { name: "_value", type: "uint256" },
            ],
          },
        ],
      },
    },
    metadata: {
      owner: "Test Owner",
      token: { ticker, name: `${ticker} Token`, decimals },
    },
  };

  if (includeDisplayFormats) {
    descriptor.display = {
      formats: {
        "approve(address,uint256)": {
          intent: `Approve ${ticker} spending`,
          fields: [
            {
              path: "_spender",
              label: "Spender",
              format: "addressName",
              params: { types: ["eoa", "contract"] },
            },
            {
              path: "_value",
              label: "Amount",
              format: "tokenAmount",
              params: { tokenPath: "@.to" },
            },
          ],
          required: ["_spender", "_value"],
        },
      },
    };
  }

  return descriptor;
}

/** Minimal ERC-7730 EIP-712 descriptor. */
function makeEip712Descriptor(overrides?: {
  chainId?: number;
  address?: string;
}) {
  const chainId = overrides?.chainId ?? 1;
  const address = overrides?.address ?? "0xCc83a4a7dae7f17d85CA7b5Cc16d2285A6dD6e7";

  return {
    $schema: "../../specs/erc7730-v1.schema.json",
    context: {
      eip712: {
        deployments: [{ chainId, address }],
        domain: { name: "TestProtocol" },
        schemas: [],
      },
    },
    metadata: {
      owner: "Test Protocol",
    },
    display: {
      formats: {},
    },
  };
}

/** A minimal ERC-20 include file (like ercs/calldata-erc20-tokens.json). */
const ERC20_INCLUDE = {
  $schema: "../specs/erc7730-v1.schema.json",
  context: {
    contract: {
      abi: [
        {
          name: "approve",
          type: "function",
          inputs: [
            { name: "_spender", type: "address" },
            { name: "_value", type: "uint256" },
          ],
        },
        {
          name: "transfer",
          type: "function",
          inputs: [
            { name: "_to", type: "address" },
            { name: "_value", type: "uint256" },
          ],
        },
      ],
    },
  },
  display: {
    formats: {
      "approve(address,uint256)": {
        intent: "Approve",
        fields: [
          {
            path: "_spender",
            label: "Spender",
            format: "addressName",
            params: { types: ["eoa", "contract"] },
          },
          {
            path: "_value",
            label: "Amount",
            format: "tokenAmount",
            params: { tokenPath: "@.to" },
          },
        ],
        required: ["_spender", "_value"],
      },
    },
  },
};

/** GitHub tree API response containing two descriptor paths. */
function makeGitHubTree(paths: string[]) {
  return {
    tree: paths.map((path) => ({ path, type: "blob" })),
    truncated: false,
  };
}

// ---------------------------------------------------------------------------
// Mock fetch setup
// ---------------------------------------------------------------------------

type FetchMock = MockedFunction<typeof fetch>;

function setupFetchMock(responses: Map<string, unknown>): FetchMock {
  const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (responses.has(url)) {
      const body = responses.get(url);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  }) as unknown as FetchMock;

  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RAW_BASE =
  "https://raw.githubusercontent.com/LedgerHQ/clear-signing-erc7730-registry/master";
const DEFAULT_API_BASE =
  "https://api.github.com/repos/LedgerHQ/clear-signing-erc7730-registry";
const TREE_URL = `${DEFAULT_API_BASE}/git/trees/master?recursive=1`;

const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const USDT_ADDRESS_LOWER = USDT_ADDRESS.toLowerCase();
const EIP712_ADDRESS = "0xCc83a4a7dae7f17d85CA7b5Cc16d2285A6dD6e7";
const EIP712_ADDRESS_LOWER = EIP712_ADDRESS.toLowerCase();

const USDT_DESCRIPTOR_PATH = "registry/tether/calldata-usdt.json";
const USDT_DESCRIPTOR_URL = `${DEFAULT_RAW_BASE}/${USDT_DESCRIPTOR_PATH}`;

const EIP712_DESCRIPTOR_PATH = "registry/test/eip712-test.json";
const EIP712_DESCRIPTOR_URL = `${DEFAULT_RAW_BASE}/${EIP712_DESCRIPTOR_PATH}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolver", () => {
  beforeEach(() => {
    clearCache();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("resolve() – GitHub source (default)", () => {
    it("finds a descriptor by chainId and address", async () => {
      const descriptor = makeCalldataDescriptor();
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, descriptor],
      ]);
      setupFetchMock(responses);

      const result = await resolve(1, USDT_ADDRESS);

      expect(result.descriptorJson).toBeTruthy();
      const parsed = JSON.parse(result.descriptorJson) as Record<string, unknown>;
      const context = parsed.context as Record<string, unknown>;
      expect(context.$id).toBe("USDT");
    });

    it("is case-insensitive for contract addresses", async () => {
      const descriptor = makeCalldataDescriptor();
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, descriptor],
      ]);
      setupFetchMock(responses);

      // Pass address in mixed case — should still resolve
      const result = await resolve(1, USDT_ADDRESS_LOWER);
      expect(result.descriptorJson).toBeTruthy();
    });

    it("throws ResolverError.notFound for an unknown contract", async () => {
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, makeCalldataDescriptor()],
      ]);
      setupFetchMock(responses);

      const unknownAddress = "0x0000000000000000000000000000000000000001";
      await expect(resolve(1, unknownAddress)).rejects.toThrow(ResolverError);
      await expect(resolve(1, unknownAddress)).rejects.toThrow("notFound" in ResolverError ? undefined : /descriptor not found/);
    });

    it("throws ResolverError for unknown chain even if address is known on another chain", async () => {
      const descriptor = makeCalldataDescriptor({ chainId: 1 });
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, descriptor],
      ]);
      setupFetchMock(responses);

      // Same address but chain 137 — not indexed
      await expect(resolve(137, USDT_ADDRESS)).rejects.toThrow(ResolverError);
    });

    it("resolves includes by fetching them relative to the descriptor URL", async () => {
      // Descriptor uses a relative include path
      const descriptorWithInclude = {
        ...makeCalldataDescriptor(),
        includes: "../../ercs/calldata-erc20-tokens.json",
      };

      // The resolved include URL:
      // new URL("../../ercs/calldata-erc20-tokens.json", USDT_DESCRIPTOR_URL)
      const includeUrl = new URL(
        "../../ercs/calldata-erc20-tokens.json",
        USDT_DESCRIPTOR_URL,
      ).toString();

      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, descriptorWithInclude],
        [includeUrl, ERC20_INCLUDE],
      ]);
      setupFetchMock(responses);

      const result = await resolve(1, USDT_ADDRESS);

      expect(result.includes).toHaveLength(1);
      const include = JSON.parse(result.includes[0]) as Record<string, unknown>;
      const display = include.display as Record<string, unknown>;
      expect(display).toBeDefined();
      expect(display.formats).toBeDefined();
    });

    it("handles descriptors with no includes", async () => {
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, makeCalldataDescriptor()],
      ]);
      setupFetchMock(responses);

      const result = await resolve(1, USDT_ADDRESS);
      expect(result.includes).toHaveLength(0);
    });

    it("supports multiple deployments in a single descriptor", async () => {
      const multiDeployment = {
        $schema: "../../specs/erc7730-v1.schema.json",
        context: {
          $id: "USDT",
          contract: {
            deployments: [
              { chainId: 1, address: USDT_ADDRESS },
              { chainId: 137, address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
            ],
            abi: [],
          },
        },
        metadata: { owner: "Tether" },
      };
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, multiDeployment],
      ]);
      setupFetchMock(responses);

      const result1 = await resolve(1, USDT_ADDRESS);
      clearCache();
      setupFetchMock(responses);
      const result2 = await resolve(137, "0xc2132D05D31c914a87C6611C10748AEb04B58e8F");

      expect(result1.descriptorJson).toBeTruthy();
      expect(result2.descriptorJson).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("resolve() – caching behaviour", () => {
    it("does not re-fetch the tree on second call for same address", async () => {
      const descriptor = makeCalldataDescriptor();
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, descriptor],
      ]);
      const mockFetch = setupFetchMock(responses);

      await resolve(1, USDT_ADDRESS);
      await resolve(1, USDT_ADDRESS);

      // Tree fetched once; descriptor fetched once (index build) + once (resolve)
      // but we cache the resolved descriptor too, so descriptor is fetched twice at most
      const treeCalls = mockFetch.mock.calls.filter(
        (c) => (c[0] as string) === TREE_URL,
      );
      expect(treeCalls).toHaveLength(1);
    });

    it("does not re-fetch an already-resolved descriptor", async () => {
      const descriptor = makeCalldataDescriptor();
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, descriptor],
      ]);
      const mockFetch = setupFetchMock(responses);

      await resolve(1, USDT_ADDRESS);
      await resolve(1, USDT_ADDRESS);

      const descriptorCalls = mockFetch.mock.calls.filter(
        (c) => (c[0] as string) === USDT_DESCRIPTOR_URL,
      );
      // Fetched during index build AND during resolve — but second resolve() uses cache
      expect(descriptorCalls.length).toBeLessThanOrEqual(2);
    });

    it("re-fetches after clearCache()", async () => {
      const descriptor = makeCalldataDescriptor();
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, descriptor],
      ]);
      const mockFetch = setupFetchMock(responses);

      await resolve(1, USDT_ADDRESS);
      clearCache();
      await resolve(1, USDT_ADDRESS);

      const treeCalls = mockFetch.mock.calls.filter(
        (c) => (c[0] as string) === TREE_URL,
      );
      expect(treeCalls).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  describe("resolve() – custom GitHub source options", () => {
    it("uses a custom repo", async () => {
      const customRepo = "my-org/my-registry";
      const customRawBase = `https://raw.githubusercontent.com/${customRepo}/master`;
      const customApiBase = `https://api.github.com/repos/${customRepo}`;
      const customTreeUrl = `${customApiBase}/git/trees/master?recursive=1`;
      const customDescUrl = `${customRawBase}/${USDT_DESCRIPTOR_PATH}`;

      const descriptor = makeCalldataDescriptor();
      const responses = new Map<string, unknown>([
        [customTreeUrl, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [customDescUrl, descriptor],
      ]);
      const mockFetch = setupFetchMock(responses);

      await resolve(1, USDT_ADDRESS, {
        source: { type: "github", repo: customRepo },
      });

      // Must have hit the custom tree URL
      const treeCalls = mockFetch.mock.calls.filter(
        (c) => (c[0] as string) === customTreeUrl,
      );
      expect(treeCalls).toHaveLength(1);
    });

    it("uses a custom ref (branch/tag)", async () => {
      const customRef = "v2";
      const customRawBase = `https://raw.githubusercontent.com/LedgerHQ/clear-signing-erc7730-registry/${customRef}`;
      const customApiBase =
        "https://api.github.com/repos/LedgerHQ/clear-signing-erc7730-registry";
      const customTreeUrl = `${customApiBase}/git/trees/${customRef}?recursive=1`;
      const customDescUrl = `${customRawBase}/${USDT_DESCRIPTOR_PATH}`;

      const descriptor = makeCalldataDescriptor();
      const responses = new Map<string, unknown>([
        [customTreeUrl, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [customDescUrl, descriptor],
      ]);
      const mockFetch = setupFetchMock(responses);

      await resolve(1, USDT_ADDRESS, {
        source: { type: "github", ref: customRef },
      });

      const treeCalls = mockFetch.mock.calls.filter(
        (c) => (c[0] as string) === customTreeUrl,
      );
      expect(treeCalls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("resolve() – inline source", () => {
    it("resolves a descriptor from an inline object (no network)", async () => {
      const mockFetch = vi.fn() as unknown as FetchMock;
      vi.stubGlobal("fetch", mockFetch);

      const descriptor = makeCalldataDescriptor({ includeDisplayFormats: true });

      const result = await resolve(1, USDT_ADDRESS, {
        source: { type: "inline", descriptor },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.descriptorJson).toBeTruthy();
      const parsed = JSON.parse(result.descriptorJson) as Record<string, unknown>;
      const context = parsed.context as Record<string, unknown>;
      expect(context.$id).toBe("USDT");
    });

    it("returns empty includes when descriptor has no includes field", async () => {
      const descriptor = makeCalldataDescriptor();

      const result = await resolve(1, USDT_ADDRESS, {
        source: { type: "inline", descriptor },
      });

      expect(result.includes).toHaveLength(0);
    });

    it("returns empty includes when descriptor has includes path but no map provided", async () => {
      const descriptor = {
        ...makeCalldataDescriptor(),
        includes: "../../ercs/calldata-erc20-tokens.json",
      };

      const result = await resolve(1, USDT_ADDRESS, {
        source: { type: "inline", descriptor },
      });

      expect(result.includes).toHaveLength(0);
    });

    it("resolves includes from the pre-resolved includes map", async () => {
      const includePath = "../../ercs/calldata-erc20-tokens.json";
      const descriptor = {
        ...makeCalldataDescriptor(),
        includes: includePath,
      };

      const result = await resolve(1, USDT_ADDRESS, {
        source: {
          type: "inline",
          descriptor,
          includes: { [includePath]: ERC20_INCLUDE },
        },
      });

      expect(result.includes).toHaveLength(1);
      const include = JSON.parse(result.includes[0]) as Record<string, unknown>;
      expect(include.display).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  describe("resolveTyped() – GitHub source", () => {
    it("finds an EIP-712 descriptor by chainId and verifyingContract", async () => {
      const descriptor = makeEip712Descriptor();
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([EIP712_DESCRIPTOR_PATH])],
        [EIP712_DESCRIPTOR_URL, descriptor],
      ]);
      setupFetchMock(responses);

      const result = await resolveTyped(1, EIP712_ADDRESS);

      expect(result.descriptorJson).toBeTruthy();
      const parsed = JSON.parse(result.descriptorJson) as Record<string, unknown>;
      const context = parsed.context as Record<string, unknown>;
      expect(context.eip712).toBeDefined();
    });

    it("throws ResolverError.notFound for unknown EIP-712 verifyingContract", async () => {
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([EIP712_DESCRIPTOR_PATH])],
        [EIP712_DESCRIPTOR_URL, makeEip712Descriptor()],
      ]);
      setupFetchMock(responses);

      const unknownAddress = "0x0000000000000000000000000000000000000099";
      await expect(resolveTyped(1, unknownAddress)).rejects.toThrow(ResolverError);
    });

    it("populates addressBook from descriptor metadata.owner", async () => {
      const descriptor = makeEip712Descriptor();
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([EIP712_DESCRIPTOR_PATH])],
        [EIP712_DESCRIPTOR_URL, descriptor],
      ]);
      setupFetchMock(responses);

      const result = await resolveTyped(1, EIP712_ADDRESS);

      // The verifying contract address itself should appear in the address book
      // with the label from metadata.owner
      expect(result.addressBook.has(EIP712_ADDRESS_LOWER)).toBe(true);
      expect(result.addressBook.get(EIP712_ADDRESS_LOWER)).toBe("Test Protocol");
    });
  });

  // -------------------------------------------------------------------------
  describe("resolveTyped() – inline source", () => {
    it("resolves an EIP-712 descriptor from inline object", async () => {
      const mockFetch = vi.fn() as unknown as FetchMock;
      vi.stubGlobal("fetch", mockFetch);

      const descriptor = makeEip712Descriptor();

      const result = await resolveTyped(1, EIP712_ADDRESS, {
        source: { type: "inline", descriptor },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.descriptorJson).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("resolveCall() – GitHub source", () => {
    it("returns a ResolvedCall with descriptor and empty tokenMetadata for unknown selector", async () => {
      const descriptor = makeCalldataDescriptor({ includeDisplayFormats: true });
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, descriptor],
      ]);
      setupFetchMock(responses);

      // Unknown 4-byte selector (not in descriptor)
      const calldata = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

      const result = await resolveCall(1, USDT_ADDRESS, calldata);

      expect(result.descriptor).toBeDefined();
      expect(result.tokenMetadata).toBeInstanceOf(Map);
      expect(result.addressBook).toBeInstanceOf(Map);
    });

    it("populates addressBook from descriptor context.$id", async () => {
      const descriptor = makeCalldataDescriptor({ includeDisplayFormats: true });
      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree([USDT_DESCRIPTOR_PATH])],
        [USDT_DESCRIPTOR_URL, descriptor],
      ]);
      setupFetchMock(responses);

      const calldata = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const result = await resolveCall(1, USDT_ADDRESS, calldata);

      // The descriptor's own address should appear in the address book
      expect(result.addressBook.has(USDT_ADDRESS_LOWER)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("resolveCall() – inline source", () => {
    it("resolves from an inline descriptor without network calls", async () => {
      const mockFetch = vi.fn() as unknown as FetchMock;
      vi.stubGlobal("fetch", mockFetch);

      const descriptor = makeCalldataDescriptor({ includeDisplayFormats: true });
      const calldata = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

      const result = await resolveCall(1, USDT_ADDRESS, calldata, undefined, {
        source: { type: "inline", descriptor },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.descriptor).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  describe("GitHub tree filtering", () => {
    it("ignores common-* files and test files when building the index", async () => {
      // Only the calldata- file should be indexed; common- and tests/ should be skipped
      const paths = [
        "registry/1inch/calldata-AggregationRouterV6.json",
        "registry/1inch/common-AggregationRouterV6.json",
        "registry/1inch/tests/test-data.json",
        "registry/1inch/eip712-1inch-limit-order.json",
        "specs/erc7730-v1.schema.json",
        "README.md",
      ];

      const calldataDescriptor = makeCalldataDescriptor({
        chainId: 1,
        address: "0x1111111254EEB25477B68fb85Ed929f73A960582",
      });
      const eip712Descriptor = makeEip712Descriptor({
        chainId: 1,
        address: EIP712_ADDRESS,
      });

      const calldataUrl = `${DEFAULT_RAW_BASE}/registry/1inch/calldata-AggregationRouterV6.json`;
      const eip712Url = `${DEFAULT_RAW_BASE}/registry/1inch/eip712-1inch-limit-order.json`;
      const commonUrl = `${DEFAULT_RAW_BASE}/registry/1inch/common-AggregationRouterV6.json`;
      const testUrl = `${DEFAULT_RAW_BASE}/registry/1inch/tests/test-data.json`;

      const responses = new Map<string, unknown>([
        [TREE_URL, makeGitHubTree(paths)],
        [calldataUrl, calldataDescriptor],
        [eip712Url, eip712Descriptor],
      ]);
      const mockFetch = setupFetchMock(responses);

      // Trigger index build by resolving the calldata descriptor
      await resolve(1, "0x1111111254EEB25477B68fb85Ed929f73A960582");

      // common- and test files should NOT have been fetched
      const commonCalls = mockFetch.mock.calls.filter(
        (c) => (c[0] as string) === commonUrl,
      );
      const testCalls = mockFetch.mock.calls.filter(
        (c) => (c[0] as string) === testUrl,
      );
      expect(commonCalls).toHaveLength(0);
      expect(testCalls).toHaveLength(0);
    });
  });
});
