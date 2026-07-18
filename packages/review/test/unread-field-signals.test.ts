import { describe, it, expect } from 'vitest';
import type { CodeChunk } from '@liendev/parser';
import type { ReviewContext } from '../src/plugin-types.js';
import type { ReviewRule, ResolvedRules } from '../src/plugins/agent/types.js';
import {
  computeAddedFields,
  computeUnreadFieldCandidates,
  renderUnreadFieldCandidates,
  renderUnreadFieldSection,
} from '../src/unread-field-signals.js';
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
      type: 'block',
      language: 'typescript',
    },
  } as unknown as CodeChunk;
}

function makeContext(opts: {
  patches?: Map<string, string>;
  chunks?: CodeChunk[];
  repoChunks?: CodeChunk[];
}): ReviewContext {
  const pr = opts.patches ? { patches: opts.patches } : undefined;
  return {
    pr,
    chunks: opts.chunks ?? [],
    repoChunks: opts.repoChunks,
    changedFiles: [],
  } as unknown as ReviewContext;
}

function patch(...lines: string[]): string {
  return lines.join('\n');
}

function incompleteHandlingRule(): ReviewRule {
  return {
    id: 'incomplete-handling',
    name: 'Incomplete Interface/Type Handling',
    description: 'test rule',
    prompt: 'test prompt',
    triggers: { always: true },
    severity: 'error',
    category: 'logic_error',
    enabled: true,
    source: 'builtin',
  };
}

function resolvedRulesWith(...ids: string[]): ResolvedRules {
  return {
    active: ids.map(id => ({ ...incompleteHandlingRule(), id })),
    skipped: [],
  };
}

// ---------------------------------------------------------------------------
// Fixtures reused across tests
// ---------------------------------------------------------------------------

const OPTIONS_INTERFACE = ['export interface Options {', '  timeout: number;', '}'].join('\n');

// A brand-new interface — unlike variant-sweep, the containing declaration
// need not have existed before this PR (see module doc).
const OPTIONS_PATCH = patch(
  '@@ -0,0 +1,3 @@',
  '+export interface Options {',
  '+  timeout: number;',
  '+}',
);

function optionsChunks(): CodeChunk[] {
  return [makeChunk('src/options.ts', 1, OPTIONS_INTERFACE)];
}

function optionsPatches(): Map<string, string> {
  return new Map([['src/options.ts', OPTIONS_PATCH]]);
}

// ---------------------------------------------------------------------------
// computeAddedFields
// ---------------------------------------------------------------------------

describe('computeAddedFields', () => {
  it('detects a new field on a brand-new interface', () => {
    const added = computeAddedFields(
      makeContext({ patches: optionsPatches(), chunks: optionsChunks() }),
    );
    expect(added).toEqual([
      { typeName: 'Options', field: 'timeout', file: 'src/options.ts', line: 2, kind: 'interface' },
    ]);
  });

  it('detects a new field added to an EXISTING interface', () => {
    const content = [
      'export interface Options {',
      '  timeout: number;',
      '  retries: number;',
      '}',
    ].join('\n');
    const patches = new Map([
      [
        'src/options.ts',
        patch(
          '@@ -1,3 +1,4 @@',
          ' export interface Options {',
          '   timeout: number;',
          '+  retries: number;',
          ' }',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/options.ts', 1, content)];
    const added = computeAddedFields(makeContext({ patches, chunks }));
    expect(added).toEqual([
      { typeName: 'Options', field: 'retries', file: 'src/options.ts', line: 3, kind: 'interface' },
    ]);
  });

  it('detects a new property on a type-literal alias', () => {
    const content = ['export type Config = {', '  timeout: number;', '}'].join('\n');
    const patches = new Map([
      [
        'src/config.ts',
        patch('@@ -0,0 +1,3 @@', '+export type Config = {', '+  timeout: number;', '+}'),
      ],
    ]);
    const chunks = [makeChunk('src/config.ts', 1, content)];
    const added = computeAddedFields(makeContext({ patches, chunks }));
    expect(added).toEqual([
      {
        typeName: 'Config',
        field: 'timeout',
        file: 'src/config.ts',
        line: 2,
        kind: 'type-literal',
      },
    ]);
  });

  it('detects a new typed class field without merging a following property into a preceding method', () => {
    // Regression fixture: a plain top-level `;`-split (like interfaces use)
    // would merge `send()`'s body with whatever followed it, since a
    // method's closing `}` isn't followed by a `;`. Placing `timeout` right
    // after `constructor(){...}` proves the line-based depth-tracked scan
    // doesn't hide it inside the merged segment.
    const content = [
      'export class Client {',
      '  constructor() {',
      '    this.value = 1;',
      '  }',
      '  timeout: number;',
      '  send(): void {',
      '    console.log(this.timeout);',
      '  }',
      '}',
    ].join('\n');
    const patches = new Map([
      [
        'src/client.ts',
        patch(
          '@@ -1,7 +1,8 @@',
          ' export class Client {',
          '   constructor() {',
          '     this.value = 1;',
          '   }',
          '+  timeout: number;',
          '   send(): void {',
          '     console.log(this.timeout);',
          '   }',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/client.ts', 1, content)];
    const added = computeAddedFields(makeContext({ patches, chunks }));
    expect(added).toEqual([
      { typeName: 'Client', field: 'timeout', file: 'src/client.ts', line: 5, kind: 'class' },
    ]);
  });

  it('does not treat an interface method signature as a field', () => {
    const content = ['export interface Handler {', '  handle(x: string): void;', '}'].join('\n');
    const patches = new Map([
      [
        'src/handler.ts',
        patch(
          '@@ -0,0 +1,3 @@',
          '+export interface Handler {',
          '+  handle(x: string): void;',
          '+}',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/handler.ts', 1, content)];
    expect(computeAddedFields(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('does not treat a class getter as a field', () => {
    const content = [
      'export class Wrapper {',
      '  private _value: number;',
      '  get value(): number {',
      '    return this._value;',
      '  }',
      '}',
    ].join('\n');
    const patches = new Map([
      [
        'src/wrapper.ts',
        patch(
          '@@ -0,0 +1,5 @@',
          '+export class Wrapper {',
          '+  private _value: number;',
          '+  get value(): number {',
          '+    return this._value;',
          '+  }',
          '+}',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/wrapper.ts', 1, content)];
    const added = computeAddedFields(makeContext({ patches, chunks }));
    expect(added.map(a => a.field)).toEqual(['_value']);
  });

  it('does not detect an untyped inferred class field (documented v1 gap)', () => {
    const content = ['export class Foo {', '  bar = 5;', '}'].join('\n');
    const patches = new Map([
      ['src/foo.ts', patch('@@ -0,0 +1,3 @@', '+export class Foo {', '+  bar = 5;', '+}')],
    ]);
    const chunks = [makeChunk('src/foo.ts', 1, content)];
    expect(computeAddedFields(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('does not treat a same-identifier value edit as an addition', () => {
    const content = ['export interface Options {', '  timeout: number;', '}'].join('\n');
    const patches = new Map([
      [
        'src/options.ts',
        patch(
          '@@ -1,3 +1,3 @@',
          ' export interface Options {',
          '-  timeout: string;',
          '+  timeout: number;',
          ' }',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/options.ts', 1, content)];
    expect(computeAddedFields(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('treats a renamed field as an addition (overlap with rename-sweep is accepted)', () => {
    const content = ['export interface Options {', '  retries: number;', '}'].join('\n');
    const patches = new Map([
      [
        'src/options.ts',
        patch(
          '@@ -1,2 +1,2 @@',
          ' export interface Options {',
          '-  timeout: number;',
          '+  retries: number;',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/options.ts', 1, content)];
    const added = computeAddedFields(makeContext({ patches, chunks }));
    expect(added).toEqual([
      { typeName: 'Options', field: 'retries', file: 'src/options.ts', line: 2, kind: 'interface' },
    ]);
  });

  it('ignores a field declared in a test-fixture file', () => {
    const content = ['export interface Options {', '  timeout: number;', '}'].join('\n');
    const patches = new Map([['src/options.test.ts', OPTIONS_PATCH]]);
    const chunks = [makeChunk('src/options.test.ts', 1, content)];
    expect(computeAddedFields(makeContext({ patches, chunks }))).toEqual([]);
  });

  // Regression for the fixture-mining sweep's THIRD suppression gap (drizzle-kit ground truth):
  // an Ohm.js-generated grammar action-dictionary (`grammar.ohm-bundle.d.ts`) lists every
  // grammar rule as an optional handler property, most of which a given consumer legitimately
  // never implements — the same shape as a test-fixture false positive, just for generated
  // parser code. Suppressed the same way test files are.
  it('ignores a field declared in a generated .d.ts file (filename-stem marker: "-bundle")', () => {
    const content = ['export interface JSImportsActionDict {', '  ImportStmt: number;', '}'].join(
      '\n',
    );
    const patches = new Map([
      [
        'drizzle-kit/imports-checker/grammar/grammar.ohm-bundle.d.ts',
        patch(
          '@@ -0,0 +1,3 @@',
          '+export interface JSImportsActionDict {',
          '+  ImportStmt: number;',
          '+}',
        ),
      ],
    ]);
    const chunks = [
      makeChunk('drizzle-kit/imports-checker/grammar/grammar.ohm-bundle.d.ts', 1, content),
    ];
    expect(computeAddedFields(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('ignores a field declared in a generated .d.ts file (leading "@generated" marker comment)', () => {
    const content = [
      '// @generated by some-codegen-tool. DO NOT EDIT.',
      'export interface Schema {',
      '  field: number;',
      '}',
    ].join('\n');
    const patches = new Map([
      [
        'src/schema.d.ts',
        patch(
          '@@ -0,0 +1,4 @@',
          '+// @generated by some-codegen-tool. DO NOT EDIT.',
          '+export interface Schema {',
          '+  field: number;',
          '+}',
        ),
      ],
    ]);
    const chunks = [makeChunk('src/schema.d.ts', 1, content)];
    expect(computeAddedFields(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('does NOT ignore a hand-written .d.ts with no codegen marker (narrow suppression, regression)', () => {
    const content = ['export interface Schema {', '  field: number;', '}'].join('\n');
    const patches = new Map([
      [
        'src/schema.d.ts',
        patch('@@ -0,0 +1,3 @@', '+export interface Schema {', '+  field: number;', '+}'),
      ],
    ]);
    const chunks = [makeChunk('src/schema.d.ts', 1, content)];
    const added = computeAddedFields(makeContext({ patches, chunks }));
    expect(added).toEqual([
      { typeName: 'Schema', field: 'field', file: 'src/schema.d.ts', line: 2, kind: 'interface' },
    ]);
  });

  it('ignores non-TS/JS files', () => {
    const patches = new Map([['src/options.rs', OPTIONS_PATCH]]);
    const chunks = [makeChunk('src/options.rs', 1, OPTIONS_INTERFACE)];
    expect(computeAddedFields(makeContext({ patches, chunks }))).toEqual([]);
  });

  it('returns [] when there is no diff or no chunks', () => {
    expect(computeAddedFields(makeContext({}))).toEqual([]);
    expect(
      computeAddedFields(makeContext({ patches: new Map([['a.ts', 'x']]), chunks: [] })),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeUnreadFieldCandidates
// ---------------------------------------------------------------------------

describe('computeUnreadFieldCandidates', () => {
  function baseContext(repoChunks: CodeChunk[]): ReviewContext {
    return makeContext({ patches: optionsPatches(), chunks: optionsChunks(), repoChunks });
  }

  it('flags a field with no read site anywhere in the corpus (only its own declaration)', () => {
    const candidates = computeUnreadFieldCandidates(baseContext(optionsChunks()));
    expect(candidates).toEqual([
      { typeName: 'Options', field: 'timeout', file: 'src/options.ts', line: 2, kind: 'interface' },
    ]);
  });

  it('does not flag a field read via dot access elsewhere', () => {
    const consumer = 'function useOptions(o: Options): number {\n  return o.timeout * 2;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('flags a field that is only ever WRITTEN (plain assignment), never read', () => {
    const consumer = 'function setOptions(o: Options): void {\n  o.timeout = 5;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].field).toBe('timeout');
  });

  it('does not flag compound-assignment/increment usage (read-then-write counts as a read)', () => {
    const consumer = 'function bump(o: Options): void {\n  o.timeout += 1;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('does not flag a field read via bracket-string access', () => {
    const consumer = "function useOptions(o: Options): number {\n  return o['timeout'] * 2;\n}";
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('flags a field only ever written via bracket access, never read', () => {
    const consumer = "function setOptions(o: Options): void {\n  o['timeout'] = 5;\n}";
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  it('does not flag a field read via destructuring assignment', () => {
    const consumer =
      'function useOptions(o: Options): number {\n  const { timeout } = o;\n  return timeout;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('does not flag a field read via a destructured function parameter', () => {
    const consumer = 'function useOptions({ timeout }: Options): number {\n  return timeout;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('suppresses a candidate when the type is spread wholesale elsewhere (FP trap)', () => {
    const consumer = 'function clone(o: Options): Options {\n  return { ...o };\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('suppresses a candidate when the type is JSON.stringify-ed elsewhere (FP trap)', () => {
    const consumer = 'function log(o: Options): void {\n  console.log(JSON.stringify(o));\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  // Regression for the fixture-mining sweep (hono #4451 ground truth): `serviceNetworkArn`
  // (a field on a brand-new interface) is handed off wholesale via a shorthand-property object
  // literal (`{ event, requestContext, context }`), not a spread or JSON.stringify — the
  // original wholesale check missed this and would have flagged a real, actively-consumed field
  // as unread.
  it('suppresses a candidate when the type is handed off via a shorthand-property object literal (FP trap)', () => {
    const consumer = [
      'function handle(o: Options): void {',
      '  const event = 1;',
      '  const context = 2;',
      '  app.fetch(req, { event, o, context });',
      '}',
    ].join('\n');
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('does NOT suppress via a shorthand property referencing a DIFFERENT variable (regression: scoped to the annotated variable, not "any shorthand nearby")', () => {
    const consumer = [
      'function handle(o: Options): void {',
      '  const event = 1;',
      '  const context = 2;',
      '  app.fetch(req, { event, context });',
      '}',
    ].join('\n');
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  // Regression: CodeRabbit's review on this PR's own #818 found `hasShorthandHandoff` couldn't
  // tell a shorthand-property object literal (value position) from a destructuring pattern
  // (binding position) sharing the same identifier — `const { o } = wrapper;` was false-matched
  // as if `o: Options` were handed off wholesale, even though it's an unrelated destructuring
  // binding in a different scope.
  it('does NOT suppress via a destructuring ASSIGNMENT binding the same variable name elsewhere', () => {
    const consumer = [
      'function handle(o: Options): void {}',
      'function other(): void {',
      '  const { o } = wrapper;',
      '  console.log(o);',
      '}',
    ].join('\n');
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  it('does NOT suppress via a destructured FUNCTION PARAMETER sharing the same variable name elsewhere', () => {
    const consumer = [
      'function handle(o: Options): void {}',
      'function other({ o }: Wrapper): void {',
      '  console.log(o);',
      '}',
    ].join('\n');
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  // Regression: flagged as a residual gap on this PR's own review (lien-stats summary for commit
  // 15af218) after the assignment/parameter destructuring cases above were fixed — a third
  // destructuring BINDING shape, a for-of/for-in loop, wasn't excluded either.
  it('does NOT suppress via a destructured for-of BINDING sharing the same variable name elsewhere', () => {
    const consumer = [
      'function handle(o: Options): void {}',
      'function other(items: Wrapper[]): void {',
      '  for (const { o } of items) {',
      '    console.log(o);',
      '  }',
      '}',
    ].join('\n');
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  it('does NOT suppress via a destructured for-in BINDING sharing the same variable name elsewhere', () => {
    const consumer = [
      'function handle(o: Options): void {}',
      'function other(items: Record<string, Wrapper>): void {',
      '  for (const { o } in items) {',
      '    console.log(o);',
      '  }',
      '}',
    ].join('\n');
    const repoChunks = [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  // Regression for the fixture-mining sweep (zod's OG-image generator ground truth): Satori's
  // custom JSX renderer reads `HTMLAttributes.tw` exclusively via `<div tw="...">`-shaped call
  // sites — invisible to the dot/bracket/destructure read patterns, since a JSX attribute never
  // appears as any of those shapes in source text.
  it('does not flag a field read via JSX attribute usage', () => {
    const consumer = 'function Card(props: Options) {\n  return <div timeout="5s">hi</div>;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/card.tsx', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('does not flag a field read via a shorthand-boolean JSX attribute', () => {
    const consumer = 'function Card(props: Options) {\n  return <Card timeout />;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/card.tsx', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('does not flag a field read via a JSX expression-container attribute', () => {
    // A local `t` (not a dot-access on the field name itself) isolates this to the JSX pattern —
    // a dot-access read elsewhere would independently satisfy `hasReadSite` too.
    const consumer =
      'function Card(props: Options) {\n  const t = 5;\n  return <Card timeout={t} />;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/card.tsx', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('does NOT false-match a LONGER attribute name that merely starts with the field name (regression: word-boundary)', () => {
    // `timeoutMs` is a different, longer attribute name — must not false-match as a read of
    // field `timeout` (the trailing `\b` in the JSX pattern is what stops this).
    const consumer = 'function Card(props: Options) {\n  return <div timeoutMs="5">hi</div>;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/card.tsx', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  it('does NOT false-match the field name appearing only inside a masked-out attribute VALUE string', () => {
    // The field name inside a quoted attribute VALUE (not the attribute NAME) must not count as
    // a read — `maskCommentsAndProseStrings` blanks ordinary quoted strings before matching.
    const consumer =
      'function Card(props: Options) {\n  return <div className="timeoutWrapper">hi</div>;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/card.tsx', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  // Regression: CodeRabbit's review on this PR's own #818 found the JSX attribute pattern's
  // `[^<>]*` gap could wander INSIDE an earlier attribute's `{...}` expression container and
  // land on a local variable used as that attribute's VALUE, misreading it as if it were an
  // attribute NAME. `<div className={ timeout } ...>` must not count `timeout` as read when it's
  // only ever referenced as a local variable, never as an attribute name — the surrounding
  // spaces (CodeRabbit's exact reported shape) are what let the naive prefix scan's `\s` land
  // right before it.
  it('does NOT false-match a field name used as a local variable INSIDE an earlier JSX brace-expression attribute', () => {
    const consumer = [
      'function Card(props: Options) {',
      '  const timeout = 5;',
      '  return <div className={ timeout } data-x="y">hi</div>;',
      '}',
    ].join('\n');
    const repoChunks = [...optionsChunks(), makeChunk('src/card.tsx', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  it('still matches the field name as an attribute AFTER an earlier brace-expression attribute (regression: the brace-skip must not lose recall)', () => {
    const consumer =
      'function Card(props: Options) {\n  const x = 1;\n  return <div data-x={x} timeout="5s">hi</div>;\n}';
    const repoChunks = [...optionsChunks(), makeChunk('src/card.tsx', 1, consumer)];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('does NOT suppress on a bare co-occurrence of the type name and an unrelated spread (regression, found via dogfooding)', () => {
    // A docstring mentioning the type by name, plus a wholly unrelated spread
    // later in the same chunk, must not be read as "this type is spread" —
    // there is no `: Options` type annotation anywhere near the spread. An
    // earlier version matched on bare co-occurrence and false-suppressed this
    // module's OWN doc comment naming `RuleTriggers.filePatterns`.
    const consumer = [
      '// See Options.timeout for the request timeout contract.',
      'function mergeDefaults(a: Record<string, unknown>, b: Record<string, unknown>) {',
      '  return { ...a, ...b };',
      '}',
    ].join('\n');
    const repoChunks = [...optionsChunks(), makeChunk('src/unrelated.ts', 1, consumer)];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  it('suppresses a candidate when the type is re-exported by a wildcard barrel (FP trap: public API)', () => {
    const barrel = makeChunk('src/index.ts', 1, "export * from './options.js';");
    const repoChunks = [...optionsChunks(), barrel];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('suppresses a candidate when the type is named in a barrel export (FP trap: public API)', () => {
    const barrel = makeChunk('src/index.ts', 1, "export { Options } from './options.js';");
    const repoChunks = [...optionsChunks(), barrel];
    expect(computeUnreadFieldCandidates(baseContext(repoChunks))).toEqual([]);
  });

  it('does not suppress when a barrel exists but never mentions this type', () => {
    const barrel = makeChunk('src/index.ts', 1, "export { Something } from './other.js';");
    const repoChunks = [...optionsChunks(), barrel];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  it('does NOT suppress via a wildcard barrel whose specifier targets an unrelated file (regression, found via dogfooding)', () => {
    // An earlier version treated ANY `export * from` found ANYWHERE in the
    // corpus as evidence the type might be re-exported, regardless of what
    // the barrel actually points at — this suppressed every candidate in an
    // entire real codebase the moment an unrelated package had its own
    // ordinary barrel. The specifier here ('./other-module.js') shares no
    // basename with the declaring file ('options.ts'), so it must not count.
    const barrel = makeChunk('other/pkg/index.ts', 1, "export * from './other-module.js';");
    const repoChunks = [...optionsChunks(), barrel];
    const candidates = computeUnreadFieldCandidates(baseContext(repoChunks));
    expect(candidates).toHaveLength(1);
  });

  it('returns [] when there are no added fields or no repo index', () => {
    expect(computeUnreadFieldCandidates(makeContext({}))).toEqual([]);
    expect(
      computeUnreadFieldCandidates(
        makeContext({ patches: optionsPatches(), chunks: optionsChunks() }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderUnreadFieldCandidates
// ---------------------------------------------------------------------------

describe('renderUnreadFieldCandidates', () => {
  it('returns "" for no candidates', () => {
    expect(renderUnreadFieldCandidates([])).toBe('');
  });

  it('renders the block naming the type/field/file/line and kind', () => {
    const md = renderUnreadFieldCandidates([
      { typeName: 'Options', field: 'timeout', file: 'src/options.ts', line: 2, kind: 'interface' },
    ]);
    expect(md).toContain('<unread_field_candidates>');
    expect(md).toContain('</unread_field_candidates>');
    expect(md).toContain('Options.timeout (interface, added in src/options.ts:2)');
  });

  it('header does not let the match substitute for incomplete-handling’s tool calls', () => {
    const md = renderUnreadFieldCandidates([
      { typeName: 'Options', field: 'timeout', file: 'src/options.ts', line: 2, kind: 'interface' },
    ]);
    expect(md).toContain(
      'it does NOT substitute for incomplete-handling’s get_files_context / read_file / grep_codebase calls',
    );
  });

  it('caps at MAX_CANDIDATES (10) with an explicit omission note — never truncates silently', () => {
    const candidates = Array.from({ length: 13 }, (_, i) => ({
      typeName: `Type${i}`,
      field: 'value',
      file: 'src/a.ts',
      line: 1,
      kind: 'interface' as const,
    }));
    const md = renderUnreadFieldCandidates(candidates);
    expect(md).toContain('more unread field candidate(s) omitted');
    expect(md).toContain('+3 more');
  });

  it('omits the truncation note when under the cap', () => {
    const md = renderUnreadFieldCandidates([
      { typeName: 'Options', field: 'timeout', file: 'src/options.ts', line: 2, kind: 'interface' },
    ]);
    expect(md).not.toContain('omitted');
  });
});

// ---------------------------------------------------------------------------
// renderUnreadFieldSection
// ---------------------------------------------------------------------------

describe('renderUnreadFieldSection', () => {
  it("returns '' when the PR adds no field with no read site", () => {
    expect(renderUnreadFieldSection(makeContext({}))).toBe('');
  });

  it('renders candidates found from context', () => {
    const section = renderUnreadFieldSection(
      makeContext({
        patches: optionsPatches(),
        chunks: optionsChunks(),
        repoChunks: optionsChunks(),
      }),
    );
    expect(section).toContain('<unread_field_candidates>');
    expect(section).toContain('Options.timeout');
  });
});

// ---------------------------------------------------------------------------
// buildInitialMessage injection (rule-gated, mirrors variant-sweep/sibling-surface)
// ---------------------------------------------------------------------------

describe('buildInitialMessage injection (rule-gated)', () => {
  function contextWithUnreadField(): ReviewContext {
    return {
      ...makeContext({
        patches: optionsPatches(),
        chunks: optionsChunks(),
        repoChunks: optionsChunks(),
      }),
      changedFiles: ['src/options.ts'],
    } as ReviewContext;
  }

  it('includes the block when incomplete-handling is active and candidates exist', () => {
    const message = buildInitialMessage(contextWithUnreadField(), {
      blastRadius: null,
      rules: resolvedRulesWith('incomplete-handling'),
    });
    expect(message).toContain('<unread_field_candidates>');
    expect(message).toContain('Options.timeout');
  });

  it('omits the block when rules are not provided at all', () => {
    const message = buildInitialMessage(contextWithUnreadField(), { blastRadius: null });
    expect(message).not.toContain('<unread_field_candidates>');
  });

  it('omits the block when incomplete-handling is not among the active rules', () => {
    const message = buildInitialMessage(contextWithUnreadField(), {
      blastRadius: null,
      rules: resolvedRulesWith('error-swallowing'),
    });
    expect(message).not.toContain('<unread_field_candidates>');
  });

  it('omits the block when the rule is active but no candidates are found', () => {
    const consumer = 'function useOptions(o: Options): number {\n  return o.timeout * 2;\n}';
    const context = {
      ...makeContext({
        patches: optionsPatches(),
        chunks: optionsChunks(),
        repoChunks: [...optionsChunks(), makeChunk('src/consumer.ts', 1, consumer)],
      }),
      changedFiles: ['src/options.ts'],
    } as ReviewContext;
    const message = buildInitialMessage(context, {
      blastRadius: null,
      rules: resolvedRulesWith('incomplete-handling'),
    });
    expect(message).not.toContain('<unread_field_candidates>');
  });
});
