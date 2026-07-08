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

const DEFAULT_BACKEND: ParserBackend = 'legacy';

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
