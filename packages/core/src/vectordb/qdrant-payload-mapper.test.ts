import { describe, it, expect } from 'vitest';
import type { ChunkMetadata } from '@liendev/parser';
import { QdrantPayloadMapper } from './qdrant-payload-mapper.js';

const ORG_ID = 'test-org';
const REPO_ID = 'test-repo';
const BRANCH = 'main';
const COMMIT_SHA = 'abc123';

function createMapper(): QdrantPayloadMapper {
  return new QdrantPayloadMapper(ORG_ID, REPO_ID, BRANCH, COMMIT_SHA);
}

function createFullMetadata(): ChunkMetadata {
  return {
    file: 'src/auth.ts',
    startLine: 10,
    endLine: 50,
    type: 'function',
    language: 'typescript',
    symbols: {
      functions: ['login', 'logout'],
      classes: ['AuthService'],
      interfaces: ['AuthConfig'],
    },
    symbolName: 'login',
    symbolType: 'function',
    parentClass: 'AuthService',
    complexity: 5,
    cognitiveComplexity: 3,
    parameters: ['username: string', 'password: string'],
    signature: 'async function login(username: string, password: string): Promise<void>',
    imports: ['./utils.js', 'express'],
    exports: ['login', 'logout'],
    importedSymbols: { './utils.js': ['hash'], express: ['Router'] },
    callSites: [
      { symbol: 'hash', line: 15 },
      { symbol: 'Router', line: 20 },
    ],
    halsteadVolume: 120.5,
    halsteadDifficulty: 8.2,
    halsteadEffort: 988.1,
    halsteadBugs: 0.04,
  };
}

function createMinimalMetadata(): ChunkMetadata {
  return {
    file: 'src/index.ts',
    startLine: 1,
    endLine: 5,
    type: 'block',
    language: 'typescript',
  };
}

describe('QdrantPayloadMapper', () => {
  describe('toPayload', () => {
    it('should map basic fields', () => {
      const mapper = createMapper();
      const metadata = createFullMetadata();

      const payload = mapper.toPayload(metadata, 'const x = 1;');

      expect(payload.content).toBe('const x = 1;');
      expect(payload.file).toBe('src/auth.ts');
      expect(payload.startLine).toBe(10);
      expect(payload.endLine).toBe(50);
      expect(payload.type).toBe('function');
      expect(payload.language).toBe('typescript');
    });

    it('should map symbol fields', () => {
      const mapper = createMapper();
      const metadata = createFullMetadata();

      const payload = mapper.toPayload(metadata);

      expect(payload.functionNames).toEqual(['login', 'logout']);
      expect(payload.classNames).toEqual(['AuthService']);
      expect(payload.interfaceNames).toEqual(['AuthConfig']);
      expect(payload.symbolName).toBe('login');
      expect(payload.symbolType).toBe('function');
      expect(payload.parentClass).toBe('AuthService');
      expect(payload.parameters).toEqual(['username: string', 'password: string']);
      expect(payload.signature).toBe(
        'async function login(username: string, password: string): Promise<void>',
      );
      expect(payload.imports).toEqual(['./utils.js', 'express']);
      expect(payload.exports).toEqual(['login', 'logout']);
    });

    it('should default metrics to 0 when missing', () => {
      const mapper = createMapper();
      const metadata = createMinimalMetadata();

      const payload = mapper.toPayload(metadata);

      expect(payload.complexity).toBe(0);
      expect(payload.cognitiveComplexity).toBe(0);
      expect(payload.halsteadVolume).toBe(0);
      expect(payload.halsteadDifficulty).toBe(0);
      expect(payload.halsteadEffort).toBe(0);
      expect(payload.halsteadBugs).toBe(0);
    });

    it('should map provided metrics', () => {
      const mapper = createMapper();
      const metadata = createFullMetadata();

      const payload = mapper.toPayload(metadata);

      expect(payload.complexity).toBe(5);
      expect(payload.cognitiveComplexity).toBe(3);
      expect(payload.halsteadVolume).toBe(120.5);
      expect(payload.halsteadDifficulty).toBe(8.2);
      expect(payload.halsteadEffort).toBe(988.1);
      expect(payload.halsteadBugs).toBe(0.04);
    });

    it('should include multi-tenant fields', () => {
      const mapper = createMapper();
      const metadata = createMinimalMetadata();

      const payload = mapper.toPayload(metadata);

      expect(payload.orgId).toBe(ORG_ID);
      expect(payload.repoId).toBe(REPO_ID);
      expect(payload.branch).toBe(BRANCH);
      expect(payload.commitSha).toBe(COMMIT_SHA);
    });

    it('should JSON-encode importedSymbols and callSites', () => {
      const mapper = createMapper();
      const metadata = createFullMetadata();

      const payload = mapper.toPayload(metadata);

      expect(payload.importedSymbols).toBe(
        JSON.stringify({ './utils.js': ['hash'], express: ['Router'] }),
      );
      expect(payload.callSites).toBe(
        JSON.stringify([
          { symbol: 'hash', line: 15 },
          { symbol: 'Router', line: 20 },
        ]),
      );
    });

    it('should default importedSymbols to {} and callSites to [] when missing', () => {
      const mapper = createMapper();
      const metadata = createMinimalMetadata();

      const payload = mapper.toPayload(metadata);

      expect(payload.importedSymbols).toBe('{}');
      expect(payload.callSites).toBe('[]');
    });

    it('should default content to empty string', () => {
      const mapper = createMapper();
      const metadata = createMinimalMetadata();

      const payload = mapper.toPayload(metadata);

      expect(payload.content).toBe('');
    });
  });

  describe('fromPayload', () => {
    it('should reconstruct all fields from a full payload', () => {
      const mapper = createMapper();
      const metadata = createFullMetadata();
      const payload = mapper.toPayload(metadata, 'some content');

      const result = mapper.fromPayload(payload);

      expect(result.file).toBe('src/auth.ts');
      expect(result.startLine).toBe(10);
      expect(result.endLine).toBe(50);
      expect(result.type).toBe('function');
      expect(result.language).toBe('typescript');
      expect(result.symbols).toEqual({
        functions: ['login', 'logout'],
        classes: ['AuthService'],
        interfaces: ['AuthConfig'],
      });
      expect(result.symbolName).toBe('login');
      expect(result.symbolType).toBe('function');
      expect(result.parentClass).toBe('AuthService');
      expect(result.parameters).toEqual(['username: string', 'password: string']);
      expect(result.signature).toBe(
        'async function login(username: string, password: string): Promise<void>',
      );
      expect(result.imports).toEqual(['./utils.js', 'express']);
      expect(result.exports).toEqual(['login', 'logout']);
      expect(result.importedSymbols).toEqual({
        './utils.js': ['hash'],
        express: ['Router'],
      });
      expect(result.callSites).toEqual([
        { symbol: 'hash', line: 15 },
        { symbol: 'Router', line: 20 },
      ]);
    });

    it('should handle missing optional fields as undefined', () => {
      const mapper = createMapper();
      const payload = {
        file: 'src/index.ts',
        startLine: 1,
        endLine: 5,
        type: 'block',
        language: 'typescript',
      };

      const result = mapper.fromPayload(payload);

      expect(result.symbolName).toBeUndefined();
      expect(result.symbolType).toBeUndefined();
      expect(result.parentClass).toBeUndefined();
      expect(result.parameters).toBeUndefined();
      expect(result.signature).toBeUndefined();
      expect(result.imports).toBeUndefined();
      expect(result.complexity).toBeUndefined();
      expect(result.cognitiveComplexity).toBeUndefined();
    });

    it('should parse JSON-encoded importedSymbols and callSites', () => {
      const mapper = createMapper();
      const payload = {
        file: 'src/auth.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'typescript',
        importedSymbols: JSON.stringify({ './utils': ['hash'] }),
        callSites: JSON.stringify([{ symbol: 'hash', line: 5 }]),
        exports: ['login'],
      };

      const result = mapper.fromPayload(payload);

      expect(result.importedSymbols).toEqual({ './utils': ['hash'] });
      expect(result.callSites).toEqual([{ symbol: 'hash', line: 5 }]);
      expect(result.exports).toEqual(['login']);
    });

    it('should handle malformed JSON gracefully', () => {
      const mapper = createMapper();
      const payload = {
        file: 'src/auth.ts',
        startLine: 1,
        endLine: 10,
        type: 'function',
        language: 'typescript',
        importedSymbols: 'not-valid-json{{{',
        callSites: 'also-not-json[[[',
      };

      const result = mapper.fromPayload(payload);

      // Should fall back to defaults when JSON parse fails
      expect(result.importedSymbols).toBeUndefined();
      expect(result.callSites).toBeUndefined();
    });

    it('should return undefined for empty dependency tracking fields', () => {
      const mapper = createMapper();
      const payload = {
        file: 'src/index.ts',
        startLine: 1,
        endLine: 5,
        type: 'block',
        language: 'typescript',
        importedSymbols: '{}',
        callSites: '[]',
        exports: [],
      };

      const result = mapper.fromPayload(payload);

      expect(result.importedSymbols).toBeUndefined();
      expect(result.callSites).toBeUndefined();
      expect(result.exports).toBeUndefined();
    });
  });

  describe('round-trip', () => {
    it('should preserve all fields for full metadata', () => {
      const mapper = createMapper();
      const metadata = createFullMetadata();

      const payload = mapper.toPayload(metadata, 'function login() {}');
      const result = mapper.fromPayload(payload);

      expect(result.file).toBe(metadata.file);
      expect(result.startLine).toBe(metadata.startLine);
      expect(result.endLine).toBe(metadata.endLine);
      expect(result.type).toBe(metadata.type);
      expect(result.language).toBe(metadata.language);
      expect(result.symbols).toEqual(metadata.symbols);
      expect(result.symbolName).toBe(metadata.symbolName);
      expect(result.symbolType).toBe(metadata.symbolType);
      expect(result.parentClass).toBe(metadata.parentClass);
      expect(result.parameters).toEqual(metadata.parameters);
      expect(result.signature).toBe(metadata.signature);
      expect(result.imports).toEqual(metadata.imports);
      expect(result.exports).toEqual(metadata.exports);
      expect(result.importedSymbols).toEqual(metadata.importedSymbols);
      expect(result.callSites).toEqual(metadata.callSites);
      expect(result.orgId).toBe(ORG_ID);
      expect(result.repoId).toBe(REPO_ID);
      expect(result.branch).toBe(BRANCH);
      expect(result.commitSha).toBe(COMMIT_SHA);
    });

    it('should preserve fields for minimal metadata', () => {
      const mapper = createMapper();
      const metadata = createMinimalMetadata();

      const payload = mapper.toPayload(metadata);
      const result = mapper.fromPayload(payload);

      expect(result.file).toBe(metadata.file);
      expect(result.startLine).toBe(metadata.startLine);
      expect(result.endLine).toBe(metadata.endLine);
      expect(result.type).toBe(metadata.type);
      expect(result.language).toBe(metadata.language);
    });

    it('should preserve complex dependency data', () => {
      const mapper = createMapper();
      const metadata: ChunkMetadata = {
        file: 'src/api/routes.ts',
        startLine: 1,
        endLine: 100,
        type: 'function',
        language: 'typescript',
        exports: ['createRouter', 'middleware'],
        importedSymbols: {
          './auth': ['validateToken', 'refreshToken'],
          './db': ['query', 'transaction'],
          express: ['Router', 'Request', 'Response'],
        },
        callSites: [
          { symbol: 'validateToken', line: 10 },
          { symbol: 'query', line: 25 },
          { symbol: 'transaction', line: 30 },
          { symbol: 'Router', line: 5 },
        ],
      };

      const payload = mapper.toPayload(metadata);
      const result = mapper.fromPayload(payload);

      expect(result.exports).toEqual(metadata.exports);
      expect(result.importedSymbols).toEqual(metadata.importedSymbols);
      expect(result.callSites).toEqual(metadata.callSites);
    });
  });
});
