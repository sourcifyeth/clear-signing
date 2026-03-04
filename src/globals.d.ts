/**
 * Minimal ambient declarations for globals that are available in React Native
 * (and browsers) but are not part of the ES2022 lib.
 *
 * Kept intentionally narrow so we don't accidentally depend on DOM-only APIs.
 */

declare function fetch(
  url: string,
): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

declare class URL {
  constructor(url: string, base?: string);
  toString(): string;
  readonly href: string;
}
