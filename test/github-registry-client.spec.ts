import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchRegistryFilePaths,
  fetchRegistryFile,
} from "../src/github-registry-client";
import { DEFAULT_REPO, DEFAULT_REF } from "../src/github-registry-index";

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetch(responses: Map<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (responses.has(url)) {
        return new Response(JSON.stringify(responses.get(url)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// fetchRegistryFilePaths
// ---------------------------------------------------------------------------

describe("fetchRegistryFilePaths", () => {
  const TREE_URL =
    "https://api.github.com/repos/LedgerHQ/clear-signing-erc7730-registry/git/trees/master?recursive=1";

  it("returns only calldata-* and eip712-* files under registry/", async () => {
    mockFetch(
      new Map([
        [
          TREE_URL,
          {
            truncated: false,
            tree: [
              { path: "registry/tether/calldata-usdt.json", type: "blob" },
              { path: "registry/uniswap/eip712-uniswap.json", type: "blob" },
              { path: "registry/tether/common-tether.json", type: "blob" },
              { path: "registry/tether/tests/test-data.json", type: "blob" },
              { path: "specs/erc7730-v1.schema.json", type: "blob" },
              { path: "README.md", type: "blob" },
            ],
          },
        ],
      ]),
    );

    const paths = await fetchRegistryFilePaths({ repo: DEFAULT_REPO, ref: DEFAULT_REF });

    expect(paths).toEqual([
      "registry/tether/calldata-usdt.json",
      "registry/uniswap/eip712-uniswap.json",
    ]);
  });

  it("excludes tree entries that are not blobs", async () => {
    mockFetch(
      new Map([
        [
          TREE_URL,
          {
            truncated: false,
            tree: [
              { path: "registry/tether", type: "tree" },
              { path: "registry/tether/calldata-usdt.json", type: "blob" },
            ],
          },
        ],
      ]),
    );

    const paths = await fetchRegistryFilePaths({ repo: DEFAULT_REPO, ref: DEFAULT_REF });
    expect(paths).toEqual(["registry/tether/calldata-usdt.json"]);
  });

  it("uses a custom repo and ref when provided", async () => {
    const customTreeUrl =
      "https://api.github.com/repos/my-org/my-registry/git/trees/v2?recursive=1";

    mockFetch(
      new Map([
        [
          customTreeUrl,
          {
            truncated: false,
            tree: [
              { path: "registry/foo/calldata-foo.json", type: "blob" },
            ],
          },
        ],
      ]),
    );

    const paths = await fetchRegistryFilePaths({ repo: "my-org/my-registry", ref: "v2" });
    expect(paths).toEqual(["registry/foo/calldata-foo.json"]);
  });

  it("throws on a non-2xx response", async () => {
    mockFetch(new Map());

    await expect(
      fetchRegistryFilePaths({ repo: DEFAULT_REPO, ref: DEFAULT_REF }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

// ---------------------------------------------------------------------------
// fetchRegistryFile
// ---------------------------------------------------------------------------

describe("fetchRegistryFile", () => {
  it("fetches a descriptor by repo-relative path using the default source", async () => {
    const url =
      "https://raw.githubusercontent.com/LedgerHQ/clear-signing-erc7730-registry/master/registry/tether/calldata-usdt.json";
    const body = { context: { contract: {} } };

    mockFetch(new Map([[url, body]]));

    const result = await fetchRegistryFile("registry/tether/calldata-usdt.json", {
      repo: DEFAULT_REPO,
      ref: DEFAULT_REF,
    });
    expect(result).toEqual(body);
  });

  it("fetches from a custom repo/ref", async () => {
    const url =
      "https://raw.githubusercontent.com/my-org/my-registry/v2/registry/tether/calldata-usdt.json";
    const body = { context: {} };

    mockFetch(new Map([[url, body]]));

    const result = await fetchRegistryFile("registry/tether/calldata-usdt.json", {
      repo: "my-org/my-registry",
      ref: "v2",
    });
    expect(result).toEqual(body);
  });

  it("throws on a non-2xx response", async () => {
    mockFetch(new Map());

    await expect(
      fetchRegistryFile("registry/missing/calldata-missing.json", {
        repo: DEFAULT_REPO,
        ref: DEFAULT_REF,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
