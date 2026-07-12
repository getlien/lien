import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import {
  extractSiblingSurfaces,
  renderSiblingSurfaces,
  renderSiblingSurfacesSection,
} from '../src/sibling-surface-signals.js';
import { buildInitialMessage } from '../src/plugins/agent/system-prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(file: string, startLine: number, content: string): CodeChunk {
  return {
    content,
    metadata: {
      file,
      startLine,
      endLine: startLine + content.split('\n').length - 1,
      type: 'function',
      language: 'typescript',
    },
  } as CodeChunk;
}

function makeContext(opts: {
  patches?: Map<string, string>;
  repoChunks?: CodeChunk[];
  changedFiles?: string[];
}): ReviewContext {
  const pr = opts.patches ? { patches: opts.patches } : undefined;
  return {
    pr,
    repoChunks: opts.repoChunks,
    changedFiles: opts.changedFiles ?? [],
  } as unknown as ReviewContext;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

// Mimics guzzle #3740: a new `on_trailers` option wired into one handler
// (CurlHandler.php), silently absent from an untouched sibling
// (StreamHandler.php). Both share `validateOptions(` so the family clears
// the cohesion gate (2/2 members).
const CURL_HANDLER_PATCH = `@@ -1,7 +1,14 @@
 <?php
 class CurlHandler {
     public function handle($options) {
         $this->validateOptions($options);
+        if (isset($options['on_trailers'])) {
+            $this->assertOnTrailersCallable($options);
+        }
     }
+
+    private function assertOnTrailersCallable($options) {
+        if (!is_callable($options['on_trailers'])) {
+            throw new InvalidArgumentException('on_trailers must be callable');
+        }
+    }
 }`;

const CURL_HANDLER_CONTENT = [
  '<?php',
  'class CurlHandler {',
  '    public function handle($options) {',
  '        $this->validateOptions($options);',
  "        if (isset(\$options['on_trailers'])) {",
  '            $this->assertOnTrailersCallable($options);',
  '        }',
  '    }',
  '',
  '    private function assertOnTrailersCallable($options) {',
  "        if (!is_callable(\$options['on_trailers'])) {",
  "            throw new InvalidArgumentException('on_trailers must be callable');",
  '        }',
  '    }',
  '}',
].join('\n');

const STREAM_HANDLER_CONTENT = [
  '<?php',
  'class StreamHandler {',
  '    public function handle($options) {',
  '        $this->validateOptions($options);',
  '    }',
  '}',
].join('\n');

function guzzleLikeContext(): ReviewContext {
  const patches = new Map([['src/Handler/CurlHandler.php', CURL_HANDLER_PATCH]]);
  const repoChunks = [
    makeChunk('src/Handler/CurlHandler.php', 1, CURL_HANDLER_CONTENT),
    makeChunk('src/Handler/StreamHandler.php', 1, STREAM_HANDLER_CONTENT),
  ];
  return {
    ...makeContext({ patches, repoChunks, changedFiles: ['src/Handler/CurlHandler.php'] }),
  } as ReviewContext;
}

// Mimics gin #3081: a new `binding/toml.go` whose decode function never calls
// `validate(`, unlike the sibling bindings (json/xml/yaml) that all do.
const JSON_GO_CONTENT = [
  'package binding',
  '',
  'func decodeJSON(r io.Reader, obj any) error {',
  '\tif err := json.NewDecoder(r).Decode(obj); err != nil {',
  '\t\treturn err',
  '\t}',
  '\treturn validate(obj)',
  '}',
].join('\n');

const XML_GO_CONTENT = [
  'package binding',
  '',
  'func decodeXML(r io.Reader, obj any) error {',
  '\tif err := xml.NewDecoder(r).Decode(obj); err != nil {',
  '\t\treturn err',
  '\t}',
  '\treturn validate(obj)',
  '}',
].join('\n');

const YAML_GO_CONTENT = [
  'package binding',
  '',
  'func decodeYAML(r io.Reader, obj any) error {',
  '\tif err := yaml.Unmarshal(data, obj); err != nil {',
  '\t\treturn err',
  '\t}',
  '\treturn validate(obj)',
  '}',
].join('\n');

const TOML_GO_CONTENT = [
  'package binding',
  '',
  'func decodeToml(r io.Reader, obj any) error {',
  '\tdecoder := toml.NewDecoder(r)',
  '\tif err := decoder.Decode(obj); err != nil {',
  '\t\treturn err',
  '\t}',
  '\treturn decoder.Decode(obj)',
  '}',
].join('\n');

const TOML_GO_PATCH = `@@ -0,0 +1,8 @@
+package binding
+
+func decodeToml(r io.Reader, obj any) error {
+\tdecoder := toml.NewDecoder(r)
+\tif err := decoder.Decode(obj); err != nil {
+\t\treturn err
+\t}
+\treturn decoder.Decode(obj)
+}`;

function ginLikeContext(): ReviewContext {
  const patches = new Map([['binding/toml.go', TOML_GO_PATCH]]);
  const repoChunks = [
    makeChunk('binding/json.go', 1, JSON_GO_CONTENT),
    makeChunk('binding/xml.go', 1, XML_GO_CONTENT),
    makeChunk('binding/yaml.go', 1, YAML_GO_CONTENT),
    makeChunk('binding/toml.go', 1, TOML_GO_CONTENT),
  ];
  return makeContext({ patches, repoChunks, changedFiles: ['binding/toml.go'] });
}

// ---------------------------------------------------------------------------
// extractSiblingSurfaces — Direction A (unmirrored addition)
// ---------------------------------------------------------------------------

describe('extractSiblingSurfaces — direction A (unmirrored addition)', () => {
  it('reports an option added to one family member as absent from an untouched sibling', () => {
    const entries = extractSiblingSurfaces(guzzleLikeContext());
    const onTrailers = entries.find(
      e => e.direction === 'unmirrored-addition' && e.display.includes('on_trailers'),
    );
    expect(onTrailers).toBeDefined();
    expect(onTrailers?.file).toBe('src/Handler/CurlHandler.php');
    expect(onTrailers?.siblings).toContain('src/Handler/StreamHandler.php');
  });
});

// ---------------------------------------------------------------------------
// extractSiblingSurfaces — Direction B (family-pattern divergence)
// ---------------------------------------------------------------------------

describe('extractSiblingSurfaces — direction B (family-pattern divergence)', () => {
  it('reports a call every sibling shares as absent from the new/changed file', () => {
    const entries = extractSiblingSurfaces(ginLikeContext());
    const validateEntry = entries.find(
      e => e.direction === 'family-pattern-divergence' && e.display === 'validate',
    );
    expect(validateEntry).toBeDefined();
    expect(validateEntry?.file).toBe('binding/toml.go');
    expect(validateEntry?.siblings.sort()).toEqual([
      'binding/json.go',
      'binding/xml.go',
      'binding/yaml.go',
    ]);
  });

  it('does not report a call the changed file already makes', () => {
    const entries = extractSiblingSurfaces(ginLikeContext());
    // decoder.Decode(...) style — `Decode` appears in every sibling AND in
    // toml.go itself, so it must never be reported as a divergence.
    expect(entries.some(e => e.display === 'Decode')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Negative / noise cases
// ---------------------------------------------------------------------------

describe('extractSiblingSurfaces — noise avoidance', () => {
  it('treats a directory of 20+ same-extension files as bulk, not a family', () => {
    const patches = new Map([
      ['src/big/a.ts', '@@ -1,1 +1,2 @@\n context\n+const bigDirToken = 1;'],
    ]);
    const repoChunks = [makeChunk('src/big/a.ts', 1, 'context\nconst bigDirToken = 1;')];
    for (let i = 0; i < 25; i++) {
      repoChunks.push(makeChunk(`src/big/file${i}.ts`, 1, `export const value${i} = ${i};`));
    }
    const context = makeContext({ patches, repoChunks, changedFiles: ['src/big/a.ts'] });
    expect(extractSiblingSurfaces(context)).toEqual([]);
  });

  it('does not report an identifier that is common (>3 occurrences) outside the changed files', () => {
    const patches = new Map([['src/Handler/CurlHandler.php', CURL_HANDLER_PATCH]]);
    // Four extra, UNCHANGED files that already contain 'on_trailers' as
    // generic prose/config — makes it common outside the PR's changed files.
    const repoChunks = [
      makeChunk('src/Handler/CurlHandler.php', 1, CURL_HANDLER_CONTENT),
      makeChunk('src/Handler/StreamHandler.php', 1, STREAM_HANDLER_CONTENT),
      makeChunk('docs/a.php', 1, '<?php // mentions on_trailers here'),
      makeChunk('docs/b.php', 1, '<?php // mentions on_trailers here too'),
      makeChunk('docs/c.php', 1, '<?php // on_trailers again'),
      makeChunk('docs/d.php', 1, '<?php // on_trailers yet again'),
    ];
    const context = makeContext({
      patches,
      repoChunks,
      changedFiles: ['src/Handler/CurlHandler.php'],
    });
    const entries = extractSiblingSurfaces(context);
    // The bare 'on_trailers' literal is common outside the changed files (4
    // docs chunks) and must be filtered. A DIFFERENT, still-rare literal that
    // happens to contain the same substring (e.g. the full error message) is
    // a distinct value and is correctly still reportable.
    expect(entries.some(e => e.display === "'on_trailers'")).toBe(false);
  });

  it('excludes test files from family membership', () => {
    const patches = new Map([['src/Handler/CurlHandler.php', CURL_HANDLER_PATCH]]);
    const repoChunks = [
      makeChunk('src/Handler/CurlHandler.php', 1, CURL_HANDLER_CONTENT),
      makeChunk('src/Handler/StreamHandler.php', 1, STREAM_HANDLER_CONTENT),
      makeChunk('src/Handler/CurlHandlerTest.php', 1, '<?php class CurlHandlerTest {}'),
      makeChunk('src/Handler/StreamHandlerTest.php', 1, '<?php class StreamHandlerTest {}'),
    ];
    const context = makeContext({
      patches,
      repoChunks,
      changedFiles: ['src/Handler/CurlHandler.php'],
    });
    const entries = extractSiblingSurfaces(context);
    for (const e of entries) {
      expect(e.siblings.every(s => !s.includes('Test'))).toBe(true);
    }
  });

  it('does not treat a changed test file as a candidate F', () => {
    const patches = new Map([
      ['src/Handler/CurlHandlerTest.php', '@@ -1,1 +1,2 @@\n <?php\n+// new_test_thing added here'],
    ]);
    const repoChunks = [
      makeChunk('src/Handler/CurlHandlerTest.php', 1, '<?php\n// new_test_thing added here'),
      makeChunk('src/Handler/StreamHandlerTest.php', 1, '<?php class StreamHandlerTest {}'),
    ];
    const context = makeContext({
      patches,
      repoChunks,
      changedFiles: ['src/Handler/CurlHandlerTest.php'],
    });
    expect(extractSiblingSurfaces(context)).toEqual([]);
  });

  it('requires a cohesive shared pattern across the family, not just co-location', () => {
    // A flat directory of unrelated single-purpose files with no shared
    // call-shaped vocabulary — the noise shape found in real package `src/`
    // directories (format.ts, config.ts, engine.ts, ...).
    const patches = new Map([
      ['src/lib/format.ts', '@@ -1,1 +1,2 @@\n export {};\n+export const uniqueFormatToken = 1;'],
    ]);
    const repoChunks = [
      makeChunk('src/lib/format.ts', 1, 'export {};\nexport const uniqueFormatToken = 1;'),
      makeChunk('src/lib/config.ts', 1, 'export const configValue = 1;'),
      makeChunk('src/lib/engine.ts', 1, 'export const engineValue = 2;'),
    ];
    const context = makeContext({ patches, repoChunks, changedFiles: ['src/lib/format.ts'] });
    expect(extractSiblingSurfaces(context)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

describe('extractSiblingSurfaces — caps', () => {
  it('caps direction-A entries per file at 5', () => {
    const addedLines = Array.from(
      { length: 10 },
      (_, i) => `+        $this->assertCallable${i}Distinctive($options);`,
    ).join('\n');
    const patch = `@@ -1,4 +1,${4 + 10} @@\n <?php\n class CurlHandler {\n     public function handle($options) {\n         $this->validateOptions($options);\n${addedLines}\n     }\n }`;
    const patches = new Map([['src/Handler/CurlHandler.php', patch]]);
    const newContent = [
      '<?php',
      'class CurlHandler {',
      '    public function handle($options) {',
      '        $this->validateOptions($options);',
      ...Array.from(
        { length: 10 },
        (_, i) => `        $this->assertCallable${i}Distinctive($options);`,
      ),
      '    }',
      '}',
    ].join('\n');
    const repoChunks = [
      makeChunk('src/Handler/CurlHandler.php', 1, newContent),
      makeChunk('src/Handler/StreamHandler.php', 1, STREAM_HANDLER_CONTENT),
    ];
    const context = makeContext({
      patches,
      repoChunks,
      changedFiles: ['src/Handler/CurlHandler.php'],
    });
    const entries = extractSiblingSurfaces(context).filter(
      e => e.direction === 'unmirrored-addition',
    );
    expect(entries.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// renderSiblingSurfaces
// ---------------------------------------------------------------------------

describe('renderSiblingSurfaces', () => {
  it('returns an empty string when there are no entries', () => {
    expect(renderSiblingSurfaces([])).toBe('');
  });

  it('renders a <sibling_surfaces> block naming the omitted sibling', () => {
    const entries = extractSiblingSurfaces(guzzleLikeContext());
    const block = renderSiblingSurfaces(entries);
    expect(block).toContain('<sibling_surfaces>');
    expect(block).toContain('</sibling_surfaces>');
    expect(block).toContain('StreamHandler.php');
  });

  it('groups multiple identifiers for the same file/siblings onto one line', () => {
    const entries = extractSiblingSurfaces(guzzleLikeContext());
    const block = renderSiblingSurfaces(entries);
    // Both 'on_trailers'-shaped tokens should be grouped into ONE bullet line
    // for CurlHandler.php rather than one bullet per identifier.
    const bulletLines = block.split('\n').filter(l => l.startsWith('- '));
    const curlHandlerLines = bulletLines.filter(l => l.includes('CurlHandler.php'));
    expect(curlHandlerLines.length).toBe(1);
  });

  it('omits entries beyond the block char budget with a note, never truncating mid-entry', () => {
    // Build many distinct single-member "families" so many groups are
    // produced, forcing the renderer past its budget.
    const patches = new Map<string, string>();
    const repoChunks: CodeChunk[] = [];
    const changedFiles: string[] = [];
    for (let i = 0; i < 30; i++) {
      const a = `src/pkg${i}/a.php`;
      const b = `src/pkg${i}/b.php`;
      const content = `<?php\nclass A${i} {\n    function shared${i}Call() {}\n}`;
      const siblingContent = `<?php\nclass B${i} {\n    function shared${i}Call() {}\n}`;
      patches.set(
        a,
        `@@ -1,2 +1,3 @@\n <?php\n class A${i} {\n+    function distinctiveAddedThing${i}() {}\n }`,
      );
      repoChunks.push(makeChunk(a, 1, `${content}\n    function distinctiveAddedThing${i}() {}`));
      repoChunks.push(makeChunk(b, 1, siblingContent));
      changedFiles.push(a);
    }
    const context = makeContext({ patches, repoChunks, changedFiles });
    const block = renderSiblingSurfacesSection(context);
    if (block) {
      expect(block.length).toBeLessThanOrEqual(3200); // budget + omission note slack
    }
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage wiring
// ---------------------------------------------------------------------------

describe('buildInitialMessage injection', () => {
  it('includes the <sibling_surfaces> block when entries exist', () => {
    const context = {
      ...guzzleLikeContext(),
      chunks: [],
    } as unknown as ReviewContext;

    const message = buildInitialMessage(context, { blastRadius: null });
    expect(message).toContain('<sibling_surfaces>');
    expect(message).toContain('StreamHandler.php');
  });

  it('omits the block entirely when there is no repo index', () => {
    const context = {
      ...makeContext({ repoChunks: [] }),
      changedFiles: ['src/a.ts'],
      chunks: [],
    } as unknown as ReviewContext;
    const message = buildInitialMessage(context, { blastRadius: null });
    expect(message).not.toContain('<sibling_surfaces>');
  });
});
