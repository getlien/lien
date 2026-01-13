import { describe, it, expect } from 'vitest';
import { parseAST } from './parser.js';
import {
  extractImports,
  extractImportedSymbols,
  extractExports,
  extractCallSites,
} from './symbols.js';

describe('Symbol Extraction', () => {
  describe('extractImportedSymbols', () => {
    it('should extract named imports', () => {
      const content = `
import { foo, bar } from './module';
import { validateEmail } from '../utils/validate';

function test() {}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['./module']).toEqual(['foo', 'bar']);
      expect(importedSymbols['../utils/validate']).toEqual(['validateEmail']);
    });

    it('should extract default imports', () => {
      const content = `
import React from 'react';
import lodash from 'lodash';
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['react']).toEqual(['React']);
      expect(importedSymbols['lodash']).toEqual(['lodash']);
    });

    it('should extract namespace imports', () => {
      const content = `
import * as utils from './utils';
import * as fs from 'fs';
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['./utils']).toEqual(['* as utils']);
      expect(importedSymbols['fs']).toEqual(['* as fs']);
    });

    it('should extract mixed import styles', () => {
      const content = `
import React, { useState, useEffect } from 'react';
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      // Should include both default and named imports
      expect(importedSymbols['react']).toContain('React');
      expect(importedSymbols['react']).toContain('useState');
      expect(importedSymbols['react']).toContain('useEffect');
    });

    it('should handle aliased imports', () => {
      const content = `
import { foo as bar, baz as qux } from './module';
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      // Aliases should use the local name
      expect(importedSymbols['./module']).toContain('bar');
      expect(importedSymbols['./module']).toContain('qux');
    });

    it('should return empty object for files with no imports', () => {
      const content = `
function hello() {
  console.log('hi');
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(Object.keys(importedSymbols)).toHaveLength(0);
    });
  });

  describe('extractExports', () => {
    it('should extract named exports', () => {
      const content = `
export { foo, bar };
export { baz };
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode);

      expect(exports).toContain('foo');
      expect(exports).toContain('bar');
      expect(exports).toContain('baz');
    });

    it('should extract exported function declarations', () => {
      const content = `
export function validateEmail(email: string): boolean {
  return email.includes('@');
}

export async function fetchUser(id: string) {
  return await fetch('/user/' + id);
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode);

      expect(exports).toContain('validateEmail');
      expect(exports).toContain('fetchUser');
    });

    it('should extract exported const/let declarations', () => {
      const content = `
export const API_URL = 'https://api.example.com';
export let counter = 0;
export const helper = (x: number) => x * 2;
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode);

      expect(exports).toContain('API_URL');
      expect(exports).toContain('counter');
      expect(exports).toContain('helper');
    });

    it('should extract exported class and interface declarations', () => {
      const content = `
export class UserService {
  getUser() {}
}

export interface User {
  id: string;
  name: string;
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode);

      expect(exports).toContain('UserService');
      expect(exports).toContain('User');
    });

    it('should extract default exports', () => {
      const content = `
export default function main() {
  console.log('main');
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode);

      expect(exports).toContain('default');
    });

    it('should extract renamed exports', () => {
      const content = `
const internalFoo = () => {};
export { internalFoo as foo };
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode);

      // Should use the exported name, not the internal name
      expect(exports).toContain('foo');
    });

    it('should deduplicate exports', () => {
      const content = `
export function foo() {}
export { foo };
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode);

      // Should only appear once
      const fooCount = exports.filter(e => e === 'foo').length;
      expect(fooCount).toBe(1);
    });

    it('should return empty array for files with no exports', () => {
      const content = `
function internal() {}
const private = 42;
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode);

      expect(exports).toHaveLength(0);
    });

    it('should extract re-exports from another module', () => {
      const content = `
export { validateEmail, validatePhone } from './validation';
export { User as UserType } from './types';
export { default as utils } from './utils';
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode);

      expect(exports).toContain('validateEmail');
      expect(exports).toContain('validatePhone');
      expect(exports).toContain('UserType'); // aliased export
      expect(exports).toContain('utils');    // default re-export with alias
    });
  });

  describe('extractCallSites', () => {
    it('should extract direct function calls', () => {
      const content = `
function processUser(user) {
  validateEmail(user.email);
  validatePhone(user.phone);
  return user;
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'validateEmail' })
      );
      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'validatePhone' })
      );
    });

    it('should extract method calls', () => {
      const content = `
function saveUser(user) {
  database.save(user);
  logger.info('User saved');
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'save' })
      );
      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'info' })
      );
    });

    it('should include line numbers for calls', () => {
      const content = `function test() {
  foo();
  bar();
}`.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      const fooCall = callSites.find(c => c.symbol === 'foo');
      const barCall = callSites.find(c => c.symbol === 'bar');

      expect(fooCall?.line).toBe(2);
      expect(barCall?.line).toBe(3);
    });

    it('should handle nested function calls', () => {
      const content = `
function complex() {
  const result = outer(inner(value));
  return result;
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'outer' })
      );
      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'inner' })
      );
    });

    it('should handle conditional and loop calls', () => {
      const content = `
function process(items) {
  if (validate(items)) {
    for (const item of items) {
      transform(item);
    }
  }
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'validate' })
      );
      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'transform' })
      );
    });

    it('should deduplicate same-line calls', () => {
      const content = `
function test() {
  foo(); foo();
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      // Multiple calls to same symbol on same line should be deduplicated
      const fooCalls = callSites.filter(c => c.symbol === 'foo');
      expect(fooCalls).toHaveLength(1);
    });

    it('should track same symbol on different lines separately', () => {
      const content = `
function test() {
  foo();
  bar();
  foo();
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      const fooCalls = callSites.filter(c => c.symbol === 'foo');
      expect(fooCalls).toHaveLength(2);
      expect(fooCalls[0].line).not.toBe(fooCalls[1].line);
    });

    it('should return empty array for function with no calls', () => {
      const content = `
function simple() {
  const x = 1 + 2;
  return x;
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toHaveLength(0);
    });
  });

  describe('extractImports (existing)', () => {
    it('should extract import paths from TypeScript', () => {
      const content = `
import { foo } from './module';
import bar from 'library';
import * as utils from '../utils';
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const imports = extractImports(parseResult.tree!.rootNode);

      expect(imports).toContain('./module');
      expect(imports).toContain('library');
      expect(imports).toContain('../utils');
    });

    it('should extract PHP use statements', () => {
      const content = `<?php
use App\\Models\\User;
use App\\Services\\AuthService;
use Illuminate\\Http\\Request;
      `.trim();

      const parseResult = parseAST(content, 'php');
      const imports = extractImports(parseResult.tree!.rootNode);

      expect(imports).toContain('App\\Models\\User');
      expect(imports).toContain('App\\Services\\AuthService');
      expect(imports).toContain('Illuminate\\Http\\Request');
    });

    it('should extract Python import statements', () => {
      const content = `
from utils.validate import validateEmail
import os
from typing import Optional
      `.trim();

      const parseResult = parseAST(content, 'python');
      const imports = extractImports(parseResult.tree!.rootNode);

      expect(imports).toContain('from utils.validate import validateEmail');
      expect(imports).toContain('import os');
      expect(imports).toContain('from typing import Optional');
    });
  });

  describe('extractImportedSymbols - PHP', () => {
    it('should extract PHP use statement symbols', () => {
      const content = `<?php
use App\\Models\\User;
use App\\Services\\AuthService;
      `.trim();

      const parseResult = parseAST(content, 'php');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['App\\Models\\User']).toEqual(['User']);
      expect(importedSymbols['App\\Services\\AuthService']).toEqual(['AuthService']);
    });

    it('should handle PHP aliased use statements', () => {
      const content = `<?php
use App\\Services\\AuthService as Auth;
      `.trim();

      const parseResult = parseAST(content, 'php');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      // Should use the alias name
      expect(importedSymbols['App\\Services\\AuthService']).toEqual(['Auth']);
    });

    it('should handle deeply nested PHP namespaces', () => {
      const content = `<?php
use Domain\\Hobbii\\Collections\\Services\\CollectionManager;
      `.trim();

      const parseResult = parseAST(content, 'php');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['Domain\\Hobbii\\Collections\\Services\\CollectionManager']).toEqual(['CollectionManager']);
    });
  });

  describe('extractImportedSymbols - Python', () => {
    it('should extract Python from...import symbols', () => {
      const content = `
from utils.validate import validateEmail, validatePhone
      `.trim();

      const parseResult = parseAST(content, 'python');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['utils.validate']).toContain('validateEmail');
      expect(importedSymbols['utils.validate']).toContain('validatePhone');
    });

    it('should handle Python aliased imports', () => {
      const content = `
from typing import Optional as Opt
      `.trim();

      const parseResult = parseAST(content, 'python');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      // Should use the alias name
      expect(importedSymbols['typing']).toEqual(['Opt']);
    });

    it('should handle multiple Python from...import statements', () => {
      const content = `
from os import path
from json import loads, dumps
      `.trim();

      const parseResult = parseAST(content, 'python');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['os']).toEqual(['path']);
      expect(importedSymbols['json']).toContain('loads');
      expect(importedSymbols['json']).toContain('dumps');
    });
  });
});

