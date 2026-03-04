/**
 * GitHub-specific client for fetching ERC-7730 descriptors from the Ledger registry.
 *
 * Registry: https://github.com/LedgerHQ/clear-signing-erc7730-registry
 */

export interface GithubSource {
  repo: string;
  ref: string;
}

/**
 * Returns the raw content base URL for a GitHub repo/ref.
 * e.g. "https://raw.githubusercontent.com/LedgerHQ/clear-signing-erc7730-registry/master"
 */
function rawBaseUrl(source: GithubSource): string {
  return `https://raw.githubusercontent.com/${source.repo}/${source.ref}`;
}

/**
 * Returns the GitHub API base URL for a repo.
 * e.g. "https://api.github.com/repos/LedgerHQ/clear-signing-erc7730-registry"
 */
function apiBaseUrl(source: GithubSource): string {
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
  source: GithubSource,
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
  source: GithubSource,
): Promise<unknown> {
  const url = `${rawBaseUrl(source)}/${repoRelativePath}`;
  return fetchJson(url);
}

/**
 * Fetches a file at an absolute URL (used for resolving relative includes).
 */
export async function fetchAbsoluteUrl(url: string): Promise<unknown> {
  return fetchJson(url);
}

/**
 * Resolves a relative include path (as it appears in a descriptor's "includes" field,
 * e.g. "../../ercs/calldata-erc20-tokens.json") against the descriptor's absolute raw URL.
 *
 * @param descriptorUrl - The absolute raw URL of the descriptor file
 * @param includePath - The relative path from the descriptor's "includes" field
 * @returns The resolved absolute URL for the include file
 */
export function resolveIncludeUrl(
  descriptorUrl: string,
  includePath: string,
): string {
  // Use the URL constructor for robust relative resolution
  return new URL(includePath, descriptorUrl).toString();
}

/**
 * Given a repo-relative descriptor path, returns its absolute raw content URL.
 */
export function descriptorUrl(
  repoRelativePath: string,
  source: GithubSource,
): string {
  return `${rawBaseUrl(source)}/${repoRelativePath}`;
}
