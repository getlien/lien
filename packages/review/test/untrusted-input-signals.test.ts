import { describe, it, expect } from 'vitest';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  extractUntrustedInputSites,
  renderUntrustedInputSites,
  renderUntrustedInputSection,
} from '../src/untrusted-input-signals.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';

function ctxWithPatches(patches?: Map<string, string>): ReviewContext {
  return {
    pr: patches ? { patches } : undefined,
    changedFiles: patches ? [...patches.keys()] : [],
    chunks: [],
  } as unknown as ReviewContext;
}

// Mirrors the real PR #541 shapes: a JSON.parse cast and a parseInt(argv).
const LOAD_RESULT_PATCH =
  '@@ -36,3 +36,4 @@\n' +
  '   function loadResult(path) {\n' +
  "     const raw = fs.readFileSync(path, 'utf-8');\n" +
  '+    return JSON.parse(raw) as Partial<HarnessResult>;\n' +
  '   }';

const PARSE_FLAGS_PATCH =
  '@@ -46,2 +46,3 @@\n' +
  '   if (arg === "--votes") {\n' +
  '+    flags.votes = parseInt(argv[++i], 10);\n' +
  '   }';

// ---------------------------------------------------------------------------
// extractUntrustedInputSites
// ---------------------------------------------------------------------------

describe('extractUntrustedInputSites', () => {
  it('extracts a JSON.parse site on a + line with the right line number', () => {
    const sites = extractUntrustedInputSites(new Map([['test/assert-cli.ts', LOAD_RESULT_PATCH]]));
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ file: 'test/assert-cli.ts', line: 38, pattern: 'JSON.parse' });
    expect(sites[0].snippet).toContain('JSON.parse(raw)');
  });

  it('extracts a parseInt site', () => {
    const sites = extractUntrustedInputSites(new Map([['test/run.ts', PARSE_FLAGS_PATCH]]));
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ file: 'test/run.ts', line: 47, pattern: 'parseInt' });
  });

  it('detects multiple language constructs across files', () => {
    const patches = new Map([
      ['a.py', '@@ -1,1 +1,2 @@\n x = 1\n+cfg = json.loads(raw)'],
      ['b.go', '@@ -1,1 +1,2 @@\n y := 1\n+n, _ := strconv.Atoi(s)'],
      ['c.rs', '@@ -1,1 +1,2 @@\n let z = 1;\n+let v = env::var("KEY").unwrap();'],
    ]);
    const patterns = extractUntrustedInputSites(patches)
      .map(s => s.pattern)
      .sort();
    expect(patterns).toEqual(['env::var', 'json.loads', 'strconv.Atoi']);
  });

  it('labels a line by its most specific construct (os.getenv, not getenv)', () => {
    const sites = extractUntrustedInputSites(
      new Map([['a.py', '@@ -1,1 +1,2 @@\n x=1\n+val = os.getenv("HOME")']]),
    );
    expect(sites).toHaveLength(1);
    expect(sites[0].pattern).toBe('os.getenv');
  });

  it('ignores parse constructs on removed and context lines', () => {
    const patch =
      '@@ -1,3 +1,3 @@\n' +
      '   const ok = JSON.parse(safe);\n' + // context — unchanged, not a new site
      '-  const bad = JSON.parse(removed);\n' + // removed — gone
      '+  const renamed = compute();';
    expect(extractUntrustedInputSites(new Map([['a.ts', patch]]))).toHaveLength(0);
  });

  it('records one site per line and dedups', () => {
    const patch = '@@ -1,1 +1,2 @@\n x=1\n+const a = JSON.parse(x); const b = JSON.parse(y);';
    expect(extractUntrustedInputSites(new Map([['a.ts', patch]]))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

describe('renderUntrustedInputSites', () => {
  it('returns "" for no sites', () => {
    expect(renderUntrustedInputSites([])).toBe('');
  });

  it('renders the block listing each site with file:line and construct', () => {
    const md = renderUntrustedInputSites([
      {
        file: 'test/assert-cli.ts',
        line: 38,
        pattern: 'JSON.parse',
        snippet: 'return JSON.parse(raw)',
      },
    ]);
    expect(md).toContain('<untrusted_input_sites>');
    expect(md).toContain('</untrusted_input_sites>');
    expect(md).toContain('test/assert-cli.ts:38');
    expect(md).toContain('[JSON.parse]');
  });

  it('caps the list and notes the overflow rather than dropping silently', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      file: 'a.ts',
      line: i + 1,
      pattern: 'JSON.parse',
      snippet: `JSON.parse(x${i})`,
    }));
    const md = renderUntrustedInputSites(many);
    expect(md).toContain('[+3 more parse site(s)');
    // 12 rendered site lines + the overflow note
    expect(md.match(/\[JSON\.parse\]/g)).toHaveLength(12);
  });
});

describe('renderUntrustedInputSection', () => {
  it('returns "" when there is no diff', () => {
    expect(renderUntrustedInputSection(ctxWithPatches())).toBe('');
  });

  it('renders the block from context patches', () => {
    const section = renderUntrustedInputSection(
      ctxWithPatches(new Map([['test/assert-cli.ts', LOAD_RESULT_PATCH]])),
    );
    expect(section).toContain('<untrusted_input_sites>');
    expect(section).toContain('test/assert-cli.ts:38');
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage wiring
// ---------------------------------------------------------------------------

describe('buildInitialMessage untrusted-input injection', () => {
  it('includes the <untrusted_input_sites> block when parse sites exist', () => {
    const ctx = ctxWithPatches(new Map([['test/run.ts', PARSE_FLAGS_PATCH]]));
    const message = buildInitialMessage(ctx, { blastRadius: null });
    expect(message).toContain('<untrusted_input_sites>');
    expect(message).toContain('test/run.ts:47');
    expect(message).toContain('[parseInt]');
  });

  it('omits the block when the diff has no untrusted-input sites', () => {
    const patch = '@@ -1,1 +1,2 @@\n const x = 1;\n+const y = x + 1;';
    const ctx = ctxWithPatches(new Map([['a.ts', patch]]));
    const message = buildInitialMessage(ctx, { blastRadius: null });
    expect(message).not.toContain('<untrusted_input_sites>');
  });
});
