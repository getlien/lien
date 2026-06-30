/**
 * Deterministic discovery signal for the untrusted-input-validation rule.
 *
 * Unlike stale-duplicate (where the whole structural fact is pre-computable),
 * untrusted-input is a HYBRID: the *discovery* half — finding the sites that
 * read untrusted bytes (`JSON.parse`, `process.env`, `parseInt`, `json.loads`,
 * `strconv.Atoi`, …) — is deterministic from the diff, but the *judgement* half
 * — does the parsed value flow to a typed consumer without runtime validation —
 * is data-flow reasoning that resists determinism and stays with the LLM.
 *
 * This module pre-computes the parse sites the diff introduces/modifies and
 * injects them as an `<untrusted_input_sites>` worklist, mirroring the
 * `<deleted_exports>` / `<stale_literal_candidates>` precedents. It hands the
 * agent a concrete list to trace, which counters the silence-bias failure mode
 * (the agent investigates but emits nothing). It injects only locations — never
 * a verdict; the agent still traces each site to its consumers and judges.
 */

import type { ReviewContext } from './plugin-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UntrustedInputSite {
  file: string;
  /** New-file line number where the parse construct appears. */
  line: number;
  /** The matched untrusted-read construct, e.g. 'JSON.parse'. */
  pattern: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cap the worklist so the prompt stays compact (protects the input budget). */
const MAX_SITES = 12;
const MAX_SNIPPET_CHARS = 160;
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
/** Full-line comment / JSDoc markers — a parse keyword in prose is not a real site. */
const COMMENT_RE = /^(\/\/|\/\*|\*|#|--|<!--)/;

/**
 * Untrusted-read constructs, mirroring UNTRUSTED_INPUT_VALIDATION's trigger
 * keywords. Two ordering/shape rules keep this precise:
 *  - Call-style constructs require a following `(`, so a construct NAME that
 *    appears in a string, regex, or identifier (e.g. this module's own pattern
 *    table, `'JSON.parse'` / `/\bparseInt\b/`) is not flagged as a real site.
 *    Env-style accessors are matched bare — they're often used without a call
 *    (`process.env.X`, `os.environ[...]`, `ENV[...]`).
 *  - Most-specific first: `find()` returns the first match and some bare
 *    constructs are substrings of qualified ones (`parseInt(` ⊂
 *    `Integer.parseInt(`, `getenv(` ⊂ `os.getenv(`), so the qualified form is
 *    listed first to win the label. One site per line.
 */
const PARSE_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  // JS / TS
  { label: 'JSON.parse', re: /\bJSON\.parse\s*\(/ },
  { label: 'process.env', re: /\bprocess\.env\b/ },
  { label: 'process.argv', re: /\bprocess\.argv\b/ },
  { label: 'Integer.parseInt', re: /\bInteger\.parseInt\s*\(/ }, // before bare parseInt (Java)
  { label: 'parseInt', re: /\bparseInt\s*\(/ },
  // Python
  { label: 'json.loads', re: /\bjson\.loads\s*\(/ },
  { label: 'os.environ', re: /\bos\.environ\b/ },
  { label: 'os.getenv', re: /\bos\.getenv\s*\(/ },
  // Go
  { label: 'json.Unmarshal', re: /\bjson\.Unmarshal\s*\(/ },
  { label: 'os.Getenv', re: /\bos\.Getenv\s*\(/ },
  { label: 'strconv.Atoi', re: /\bstrconv\.Atoi\s*\(/ },
  // Java
  { label: 'System.getenv', re: /\bSystem\.getenv\s*\(/ },
  { label: 'readValue', re: /\breadValue\s*\(/ },
  // PHP
  { label: 'json_decode', re: /\bjson_decode\s*\(/ },
  // Rust
  { label: 'serde_json::from', re: /\bserde_json::from\w*\s*\(/ },
  { label: 'env::var', re: /\benv::var\s*\(/ },
  // Ruby
  { label: 'ENV[', re: /\bENV\[/ },
  // PHP / generic env (kept last — broadest)
  { label: 'getenv', re: /\bgetenv\s*\(/ },
];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Blank out the *contents* of quoted string literals so a construct NAME that
 * lives inside a string (a label in this module's own pattern table, a keyword
 * in rules.ts, a fixture asserting on the text) isn't matched as a real call or
 * access. Quote delimiters are kept so the line still tokenizes sanely. Regex
 * literals aren't stripped, but the call-style `(` requirement and the bare
 * env-accessor shapes already keep those from matching.
 */
function stripStringContents(line: string): string {
  return line
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

/**
 * Collect the untrusted-read sites the diff introduces or modifies — matches on
 * `+` lines only (added/changed code), tracking the new-file line number. One
 * site per line, labelled by its most specific construct. Returns all sites
 * (uncapped); the render layer caps and notes any overflow. Exposed for testing.
 */
export function extractUntrustedInputSites(patches: Map<string, string>): UntrustedInputSite[] {
  const sites: UntrustedInputSite[] = [];
  const seen = new Set<string>();

  for (const [file, patch] of patches) {
    let newLine = 0;
    for (const raw of patch.split('\n')) {
      const header = raw.match(HUNK_HEADER_RE);
      if (header) {
        newLine = parseInt(header[1], 10);
        continue;
      }
      if (raw.startsWith('+++') || raw.startsWith('---')) continue;
      if (raw.startsWith('\\')) continue; // "\ No newline at end of file"

      if (raw.startsWith('+')) {
        const text = raw.slice(1);
        const key = `${file}:${newLine}`;
        // A parse keyword in a comment/JSDoc line, or inside a string literal,
        // is prose/data — not a real parse site. Skip comments outright and
        // match against the string-stripped line so a construct name in a label
        // (incl. this module's own pattern table) isn't flagged.
        const probe = stripStringContents(text);
        const match = COMMENT_RE.test(text.trim())
          ? undefined
          : PARSE_PATTERNS.find(p => p.re.test(probe));
        if (match && !seen.has(key)) {
          seen.add(key);
          sites.push({
            file,
            line: newLine,
            pattern: match.label,
            snippet: text.trim().slice(0, MAX_SNIPPET_CHARS),
          });
        }
        newLine++;
      } else if (raw.startsWith('-')) {
        // a removed line does not advance the new-file counter
      } else {
        newLine++; // context line
      }
    }
  }

  return sites;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render the parse-site worklist as an `<untrusted_input_sites>` block for the
 * agent's initial message. Returns '' when there are no sites so callers can
 * append unconditionally.
 */
export function renderUntrustedInputSites(sites: UntrustedInputSite[]): string {
  if (sites.length === 0) return '';

  const lines: string[] = [];
  lines.push('<untrusted_input_sites>');
  lines.push(
    'Pre-computed: sites this PR introduced/modified that read untrusted input ' +
      '(parsed/env/argv). This is the discovery step done for you — do NOT skip it. ' +
      'For EACH site, trace the parsed value to its consumers (get_files_context / ' +
      'read_file) and check the four unguarded shapes: cast-without-validate, schema ' +
      'gap, NaN-on-parse, blank/truthy-coerce. Emit a finding for each unguarded path; ' +
      'stay silent on a site only after tracing it and confirming the value is validated. ' +
      'The list covers parse calls on changed lines; if a consumer of an unchanged parse ' +
      'site was edited, inspect that too.',
  );
  for (const s of sites.slice(0, MAX_SITES)) {
    lines.push(`    - ${s.file}:${s.line}  [${s.pattern}]  \`${s.snippet}\``);
  }
  if (sites.length > MAX_SITES) {
    lines.push(
      `    - [+${sites.length - MAX_SITES} more parse site(s) on changed lines — also scan the diff so none is missed]`,
    );
  }
  lines.push('</untrusted_input_sites>');
  return lines.join('\n');
}

/**
 * Build the `<untrusted_input_sites>` section from the review context. Returns
 * '' when there is no diff to scan.
 */
export function renderUntrustedInputSection(context: ReviewContext): string {
  const patches = context.pr?.patches;
  if (!patches || patches.size === 0) return '';
  return renderUntrustedInputSites(extractUntrustedInputSites(patches));
}
