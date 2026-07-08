/**
 * Parser backend selection for @liendev/parser (ADR-013 / native-parser.md).
 *
 * Self-contained: parser must NOT import @liendev/core, so this mirrors the
 * validation shape of core's config/global-config.ts loadConfigFromEnv
 * (throw a clear Error naming the bad value and the valid set) without
 * depending on it.
 */

export type ParserBackend = 'native' | 'legacy';

const VALID_BACKENDS: ReadonlySet<string> = new Set(['native', 'legacy']);

// ADR-013 Phase 4-A: native is now the default. 'legacy' remains a valid
// explicit opt-out for exactly one release (Phase 4-B removes it).
const DEFAULT_BACKEND: ParserBackend = 'native';

/**
 * Resolve which parser backend to use from LIEN_PARSER, read at call time
 * (not module load) so tests can flip it between assertions.
 *
 * @throws Error if LIEN_PARSER is set to anything other than 'native' or
 *   'legacy'.
 */
export function resolveParserBackend(): ParserBackend {
  const raw = process.env.LIEN_PARSER;
  if (!raw) return DEFAULT_BACKEND;
  if (!VALID_BACKENDS.has(raw)) {
    throw new Error(
      `Invalid LIEN_PARSER environment variable: "${raw}"\n` + `Valid values: 'native', 'legacy'`,
    );
  }
  return raw as ParserBackend;
}

/**
 * True when LIEN_PARSER was left unset, i.e. the caller landed on 'native'
 * by default rather than opting into it explicitly. ast/parser.ts uses this
 * to decide whether a native binding load failure should transparently fall
 * back to legacy (default path only -- see its transitional-fallback
 * comment) or fail loud (an explicit LIEN_PARSER=native, e.g. CI's
 * test-legacy/test-native jobs or an intentional user, must see real
 * failures, not a silently masked one).
 */
export function isBackendUnset(): boolean {
  return !process.env.LIEN_PARSER;
}
