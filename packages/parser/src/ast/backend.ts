/**
 * Parser backend selection for @liendev/parser (ADR-013 / native-parser.md).
 *
 * Self-contained: parser must NOT import @liendev/core, so this mirrors the
 * validation shape of core's config/global-config.ts loadConfigFromEnv
 * (throw a clear Error naming the bad value and the valid set) without
 * depending on it.
 *
 * ADR-013 Phase 4-B: `native` (@liendev/parser-native) is now the only
 * backend -- `legacy` (node-tree-sitter) was removed one release after the
 * default flipped to native. LIEN_PARSER=native remains valid (a no-op,
 * since it's also the default) so existing explicit opt-ins don't need to
 * change.
 */

export type ParserBackend = 'native';

const VALID_BACKENDS: ReadonlySet<string> = new Set<ParserBackend>(['native']);

/**
 * LIEN_PARSER values that used to be valid but were removed -- so a user
 * (or a stale CI config) that set one gets a specific "this was removed"
 * error instead of a generic "invalid value" one.
 */
const RETIRED_BACKENDS: ReadonlySet<string> = new Set(['legacy']);

/**
 * Resolve which parser backend to use from LIEN_PARSER, read at call time
 * (not module load) so tests can flip it between assertions.
 *
 * @throws Error if LIEN_PARSER is set to a retired value ('legacy') or to
 *   anything else that isn't 'native'.
 */
export function resolveParserBackend(): ParserBackend {
  const raw = process.env.LIEN_PARSER;
  if (!raw) return 'native';
  if (VALID_BACKENDS.has(raw)) return raw as ParserBackend;

  if (RETIRED_BACKENDS.has(raw)) {
    throw new Error(
      `LIEN_PARSER=${raw} is no longer supported: the '${raw}' backend (node-tree-sitter) ` +
        `has been removed (see ADR-013). Unset LIEN_PARSER, or set it to 'native' (the only ` +
        `backend, and already the default). To keep using '${raw}', pin @liendev/parser to a ` +
        `release that still ships it.`,
    );
  }

  throw new Error(
    `Invalid LIEN_PARSER environment variable: "${raw}"\n` + `Valid values: 'native'`,
  );
}
