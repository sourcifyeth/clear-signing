/**
 * GitHub-specific client for fetching ERC-7730 descriptors from the Ledger registry.
 *
 * Registry: https://github.com/LedgerHQ/clear-signing-erc7730-registry
 */

import type { GitHubSource } from "./types";

export const DEFAULT_REPO = "LedgerHQ/clear-signing-erc7730-registry";
export const DEFAULT_REF = "master";

/**
 * Returns the raw content base URL for a GitHub repo/ref.
 * e.g. "https://raw.githubusercontent.com/LedgerHQ/clear-signing-erc7730-registry/master"
 */
function rawBaseUrl(source: GitHubSource): string {
  return `https://raw.githubusercontent.com/${source.repo}/${source.ref}`;
}

/**
 * Returns the GitHub API base URL for a repo.
 * e.g. "https://api.github.com/repos/LedgerHQ/clear-signing-erc7730-registry"
 */
function apiBaseUrl(source: GitHubSource): string {
  return `https://api.github.com/repos/${source.repo}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.json() as Promise<unknown>;
}

interface GitTreeItem {
  path: string;
  type: string;
}

interface GitTreeResponse {
  tree: GitTreeItem[];
}

/**
 * Fetches the full file tree from the GitHub API and returns all descriptor
 * file paths (relative to repo root) under the registry/ directory.
 *
 * Filters to only calldata-*.json and eip712-*.json files (skips common-*, tests/).
 */
export async function fetchRegistryFilePaths(
  source: GitHubSource,
): Promise<string[]> {
  const url = `${apiBaseUrl(source)}/git/trees/${source.ref}?recursive=1`;
  const data = (await fetchJson(url)) as GitTreeResponse;

  return data.tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((path) => {
      if (!path.startsWith("registry/") || !path.endsWith(".json")) {
        return false;
      }
      const filename = path.split("/").at(-1) ?? "";
      // Only descriptor files: calldata-* and eip712-*
      return filename.startsWith("calldata-") || filename.startsWith("eip712-");
    });
}

/**
 * Fetches a descriptor file by its repo-relative path.
 * e.g. fetchRegistryFile("registry/tether/calldata-usdt.json")
 */
export async function fetchRegistryFile(
  repoRelativePath: string,
  source: GitHubSource,
): Promise<unknown> {
  const url = `${rawBaseUrl(source)}/${repoRelativePath}`;
  return fetchJson(url);
}
