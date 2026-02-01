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

    it('should extract constructor calls (new expression)', () => {
      const content = `function createDB(dir) {
  const db = new VectorDB(dir);
  db.initialize();
  return db;
}`.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'VectorDB', line: 2 })
      );
      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'initialize', line: 3 })
      );
    });

    it('should extract namespaced constructor calls (new ns.Foo())', () => {
      const content = `
function create() {
  const instance = new ns.MyClass();
  return instance;
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(
        expect.objectContaining({ symbol: 'MyClass' })
      );
    });
  });

  describe('extractCallSites - PHP', () => {
    it('should extract PHP function calls', () => {
      const content = `<?php
function process() {
    helper_function();
    another_call();
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const funcNode = parseResult.tree!.rootNode.namedChild(1)!; // Skip php_tag
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'helper_function' }));
      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'another_call' }));
    });

    it('should extract PHP method calls', () => {
      const content = `<?php
class Controller {
    public function index() {
        $this->validate($request);
        $user->save();
    }
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const classNode = parseResult.tree!.rootNode.namedChild(1)!;
      const callSites = extractCallSites(classNode);

      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'validate' }));
      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'save' }));
    });

    it('should extract PHP static method calls', () => {
      const content = `<?php
function getData() {
    $user = User::find(1);
    $items = Collection::where('active', true)->get();
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const funcNode = parseResult.tree!.rootNode.namedChild(1)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'find' }));
      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'where' }));
      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'get' }));
    });
  });

  describe('extractCallSites - Python', () => {
    it('should extract Python function calls', () => {
      const content = `
def process():
    helper_function()
    another_call()
      `.trim();

      const parseResult = parseAST(content, 'python');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'helper_function' }));
      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'another_call' }));
    });

    it('should extract Python method calls', () => {
      const content = `
def process(user):
    user.save()
    self.validate(data)
      `.trim();

      const parseResult = parseAST(content, 'python');
      const funcNode = parseResult.tree!.rootNode.namedChild(0)!;
      const callSites = extractCallSites(funcNode);

      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'save' }));
      expect(callSites).toContainEqual(expect.objectContaining({ symbol: 'validate' }));
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

    it('should extract Python regular imports', () => {
      const content = `
import os
import sys
import pathlib
      `.trim();

      const parseResult = parseAST(content, 'python');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['os']).toContain('os');
      expect(importedSymbols['sys']).toContain('sys');
      expect(importedSymbols['pathlib']).toContain('pathlib');
    });

    it('should extract Python aliased regular imports', () => {
      const content = `
import numpy as np
import pandas as pd
      `.trim();

      const parseResult = parseAST(content, 'python');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['numpy']).toContain('np');
      expect(importedSymbols['pandas']).toContain('pd');
    });

    it('should extract Python dotted module imports', () => {
      const content = `
import os.path
import xml.etree.ElementTree
      `.trim();

      const parseResult = parseAST(content, 'python');
      const importedSymbols = extractImportedSymbols(parseResult.tree!.rootNode);

      expect(importedSymbols['os.path']).toContain('os.path');
      expect(importedSymbols['xml.etree.ElementTree']).toContain('xml.etree.ElementTree');
    });
  });

  describe('extractExports - PHP', () => {
    it('should extract class exports', () => {
      const content = `<?php
namespace App\\Models;

class User {
    public function getName() {}
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const exports = extractExports(parseResult.tree!.rootNode, 'php');

      expect(exports).toContain('User');
    });

    it('should extract multiple classes in one file', () => {
      const content = `<?php
class User {
    public function getName() {}
}

class Product {
    public function getPrice() {}
}

class Order {
    public function getTotal() {}
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const exports = extractExports(parseResult.tree!.rootNode, 'php');

      expect(exports).toContain('User');
      expect(exports).toContain('Product');
      expect(exports).toContain('Order');
      expect(exports).toHaveLength(3);
    });

    it('should extract trait exports', () => {
      const content = `<?php
namespace App\\Traits;

trait HasTimestamps {
    public function created() {}
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const exports = extractExports(parseResult.tree!.rootNode, 'php');

      expect(exports).toContain('HasTimestamps');
    });

    it('should extract interface exports', () => {
      const content = `<?php
namespace App\\Contracts;

interface Repository {
    public function find($id);
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const exports = extractExports(parseResult.tree!.rootNode, 'php');

      expect(exports).toContain('Repository');
    });

    it('should extract top-level function exports', () => {
      const content = `<?php
function helper_function() {
    return true;
}

function another_helper() {
    return false;
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const exports = extractExports(parseResult.tree!.rootNode, 'php');

      expect(exports).toContain('helper_function');
      expect(exports).toContain('another_helper');
    });

    it('should extract namespaced exports', () => {
      const content = `<?php
namespace App\\Services;

class AuthService {
    public function login() {}
}

trait Authenticatable {
    public function authenticate() {}
}

interface AuthProvider {
    public function check();
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const exports = extractExports(parseResult.tree!.rootNode, 'php');

      expect(exports).toContain('AuthService');
      expect(exports).toContain('Authenticatable');
      expect(exports).toContain('AuthProvider');
    });

    it('should return empty array for empty PHP file', () => {
      const content = `<?php
// Just a comment
      `.trim();

      const parseResult = parseAST(content, 'php');
      const exports = extractExports(parseResult.tree!.rootNode, 'php');

      expect(exports).toHaveLength(0);
    });

    it('should handle mixed PHP declarations', () => {
      const content = `<?php
namespace App;

class User {}
trait HasUuid {}
interface Searchable {}

function helper() {
    return true;
}
      `.trim();

      const parseResult = parseAST(content, 'php');
      const exports = extractExports(parseResult.tree!.rootNode, 'php');

      expect(exports).toContain('User');
      expect(exports).toContain('HasUuid');
      expect(exports).toContain('Searchable');
      expect(exports).toContain('helper');
      expect(exports).toHaveLength(4);
    });
  });

  describe('extractExports - Python', () => {
    it('should extract class exports', () => {
      const content = `
class User:
    def __init__(self):
        pass
      `.trim();

      const parseResult = parseAST(content, 'python');
      const exports = extractExports(parseResult.tree!.rootNode, 'python');

      expect(exports).toContain('User');
    });

    it('should extract multiple classes in one file', () => {
      const content = `
class User:
    pass

class Product:
    pass

class Order:
    pass
      `.trim();

      const parseResult = parseAST(content, 'python');
      const exports = extractExports(parseResult.tree!.rootNode, 'python');

      expect(exports).toContain('User');
      expect(exports).toContain('Product');
      expect(exports).toContain('Order');
      expect(exports).toHaveLength(3);
    });

    it('should extract function exports', () => {
      const content = `
def validate_email(email):
    return '@' in email

def validate_phone(phone):
    return len(phone) == 10
      `.trim();

      const parseResult = parseAST(content, 'python');
      const exports = extractExports(parseResult.tree!.rootNode, 'python');

      expect(exports).toContain('validate_email');
      expect(exports).toContain('validate_phone');
    });

    it('should extract async function exports', () => {
      const content = `
async def fetch_user(user_id):
    return await db.get(user_id)

async def save_user(user):
    return await db.save(user)
      `.trim();

      const parseResult = parseAST(content, 'python');
      const exports = extractExports(parseResult.tree!.rootNode, 'python');

      expect(exports).toContain('fetch_user');
      expect(exports).toContain('save_user');
    });

    it('should extract mixed classes and functions', () => {
      const content = `
class UserService:
    def get_user(self):
        pass

def helper_function():
    return True

class ProductService:
    pass

async def async_helper():
    pass
      `.trim();

      const parseResult = parseAST(content, 'python');
      const exports = extractExports(parseResult.tree!.rootNode, 'python');

      expect(exports).toContain('UserService');
      expect(exports).toContain('helper_function');
      expect(exports).toContain('ProductService');
      expect(exports).toContain('async_helper');
      expect(exports).toHaveLength(4);
    });

    it('should return empty array for empty Python file', () => {
      const content = `
# Just a comment
      `.trim();

      const parseResult = parseAST(content, 'python');
      const exports = extractExports(parseResult.tree!.rootNode, 'python');

      expect(exports).toHaveLength(0);
    });

    it('should NOT export nested functions (only top-level)', () => {
      const content = `
def outer_function():
    def inner_function():
        pass
    return inner_function

class MyClass:
    def method(self):
        def nested():
            pass
        return nested
      `.trim();

      const parseResult = parseAST(content, 'python');
      const exports = extractExports(parseResult.tree!.rootNode, 'python');

      // Should only export top-level outer_function and MyClass
      expect(exports).toContain('outer_function');
      expect(exports).toContain('MyClass');
      expect(exports).not.toContain('inner_function');
      expect(exports).not.toContain('nested');
      expect(exports).not.toContain('method');
      expect(exports).toHaveLength(2);
    });
  });

  describe('extractExports - Regression tests', () => {
    it('should still handle JavaScript/TypeScript exports correctly', () => {
      const content = `
export function validateEmail(email: string): boolean {
  return email.includes('@');
}

export class UserService {
  getUser() {}
}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      // Test without language parameter (defaults to JS/TS)
      const exports = extractExports(parseResult.tree!.rootNode);

      expect(exports).toContain('validateEmail');
      expect(exports).toContain('UserService');
    });

    it('should handle explicit typescript language parameter', () => {
      const content = `
export const API_URL = 'https://api.example.com';
export default function main() {}
      `.trim();

      const parseResult = parseAST(content, 'typescript');
      const exports = extractExports(parseResult.tree!.rootNode, 'typescript');

      expect(exports).toContain('API_URL');
      expect(exports).toContain('default');
    });
  });
});

