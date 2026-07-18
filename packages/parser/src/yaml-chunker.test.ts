import { describe, it, expect } from 'vitest';
import { chunkYamlFile } from './yaml-chunker.js';

describe('chunkYamlFile', () => {
  it('splits into one chunk per top-level key with correct breadcrumb, type, and language', () => {
    const content = ['name: myapp', 'version: 1.0.0', 'description: test'].join('\n');

    const chunks = chunkYamlFile('config.yaml', content);

    expect(chunks).toHaveLength(3);
    expect(chunks.map(c => c.metadata.symbolName)).toEqual(['name', 'version', 'description']);
    chunks.forEach(chunk => {
      expect(chunk.metadata.type).toBe('config');
      expect(chunk.metadata.language).toBe('yaml');
      expect(chunk.metadata.file).toBe('config.yaml');
    });
  });

  it('carries a deep dotted breadcrumb on split pieces of an oversized nested section', () => {
    const nestedLines = Array.from(
      { length: 16 },
      (_, i) => `      ${String.fromCharCode(65 + i)}: ${i}`,
    );
    const content = ['jobs:', '  review:', '    env:', ...nestedLines].join('\n');

    const chunks = chunkYamlFile('workflow.yml', content, 5, 2);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(chunk => expect(chunk.metadata.symbolName).toMatch(/^jobs/));
    expect(chunks.some(c => c.metadata.symbolName?.includes('jobs.review.env'))).toBe(true);
  });

  it('splits an oversized top-level key into overlapping window chunks', () => {
    const nestedLines = Array.from(
      { length: 16 },
      (_, i) => `      ${String.fromCharCode(65 + i)}: ${i}`,
    );
    const content = ['jobs:', '  review:', '    env:', ...nestedLines].join('\n');
    const totalLines = 3 + nestedLines.length;

    const chunks = chunkYamlFile('workflow.yml', content, 5, 2);

    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: second window starts before the first window ends.
    expect(chunks[1].metadata.startLine).toBeLessThan(chunks[0].metadata.endLine);
    // Last window reaches the end of the file.
    expect(chunks[chunks.length - 1].metadata.endLine).toBe(totalLines);
  });

  it('yields exactly one chunk for a tiny non-empty file (#786 regression guard)', () => {
    const content = ['app:', '  name: test', '  version: 1'].join('\n');

    const chunks = chunkYamlFile('tiny.yaml', content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('app');
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(3);
  });

  it('returns an empty array for a truly empty file', () => {
    expect(chunkYamlFile('empty.yaml', '')).toEqual([]);
  });

  it('returns an empty array for a whitespace-only file', () => {
    expect(chunkYamlFile('whitespace.yaml', '   \n\t\n   \n')).toEqual([]);
  });

  it('splits multi-document files and prefixes breadcrumbs with doc[N]', () => {
    const content = [
      '---',
      'service: web',
      'port: 8080',
      '---',
      'service: worker',
      'queue: default',
    ].join('\n');

    const chunks = chunkYamlFile('multi.yaml', content);

    expect(chunks.map(c => c.metadata.symbolName)).toEqual([
      'doc[1] service',
      'doc[1] port',
      'doc[2] service',
      'doc[2] queue',
    ]);
  });

  it('does not produce an empty leading document for a leading "---"', () => {
    const content = ['---', 'key: value'].join('\n');

    const chunks = chunkYamlFile('single.yaml', content);

    // Single document -> no doc[N] prefix.
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('key');
  });

  it('does not throw on Helm/Jinja templated YAML and still yields config chunks', () => {
    const content = [
      '{{- if .Values.enabled }}',
      '{{- include "app.labels" . }}',
      '{{- end }}',
    ].join('\n');

    expect(() => chunkYamlFile('templates/deployment.yaml', content)).not.toThrow();

    const chunks = chunkYamlFile('templates/deployment.yaml', content);
    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach(chunk => expect(chunk.metadata.type).toBe('config'));
  });

  it('does not throw on templated YAML mixed with real top-level keys', () => {
    const content = [
      'apiVersion: v1',
      'kind: ConfigMap',
      'data:',
      '  {{- range $key, $val := .Values.config }}',
      '  {{ $key }}: {{ $val }}',
      '  {{- end }}',
    ].join('\n');

    expect(() => chunkYamlFile('templates/configmap.yaml', content)).not.toThrow();
    const chunks = chunkYamlFile('templates/configmap.yaml', content);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('does not treat a block-scalar body line as a top-level section boundary', () => {
    const content = ['script: |', '  fake: value', '  echo hello', 'next: value2'].join('\n');

    const chunks = chunkYamlFile('script.yaml', content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.symbolName).toBe('script');
    expect(chunks[0].content).toContain('fake: value');
    expect(chunks[1].metadata.symbolName).toBe('next');
  });

  it('creates a preamble chunk for comments before the first key, with no breadcrumb', () => {
    const content = ['# This is a config file', '# Second comment line', 'app: value'].join('\n');

    const chunks = chunkYamlFile('commented.yaml', content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.symbolName).toBeUndefined();
    expect(chunks[0].content).toBe('# This is a config file\n# Second comment line');
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(2);

    expect(chunks[1].metadata.symbolName).toBe('app');
    expect(chunks[1].metadata.startLine).toBe(3);
    expect(chunks[1].metadata.endLine).toBe(3);
  });

  it('uses 1-based startLine/endLine for a simple multi-key file', () => {
    const content = ['first: 1', 'second: 2', 'third: 3'].join('\n');

    const chunks = chunkYamlFile('lines.yaml', content);

    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(1);
    expect(chunks[1].metadata.startLine).toBe(2);
    expect(chunks[1].metadata.endLine).toBe(2);
    expect(chunks[2].metadata.startLine).toBe(3);
    expect(chunks[2].metadata.endLine).toBe(3);
  });

  it('does not crash on a top-level sequence file and yields a single chunk', () => {
    const content = ['- a', '- b'].join('\n');

    const chunks = chunkYamlFile('list.yaml', content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBeUndefined();
    expect(chunks[0].metadata.type).toBe('config');
    expect(chunks[0].content).toBe(content);
  });
});
