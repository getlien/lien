import { describe, it, expect } from 'vitest';
import { chunkByAST } from './chunker.js';

describe('Python AST Chunking', () => {
  it('should chunk Python functions', () => {
    const content = `
def hello_world():
    print("Hello, world!")

def add_numbers(a, b):
    return a + b
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.symbolName).toBe('hello_world');
    expect(chunks[0].metadata.symbolType).toBe('function');
    expect(chunks[1].metadata.symbolName).toBe('add_numbers');
    expect(chunks[1].metadata.symbolType).toBe('function');
  });
  
  it('should extract Python class methods', () => {
    const content = `
class Calculator:
    def add(self, a, b):
        return a + b
    
    def subtract(self, a, b):
        return a - b
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.symbolName).toBe('add');
    expect(chunks[0].metadata.symbolType).toBe('method');
    expect(chunks[0].metadata.parentClass).toBe('Calculator');
    expect(chunks[1].metadata.symbolName).toBe('subtract');
    expect(chunks[1].metadata.symbolType).toBe('method');
    expect(chunks[1].metadata.parentClass).toBe('Calculator');
  });
  
  it('should handle async functions', () => {
    const content = `
async def fetch_data():
    await asyncio.sleep(1)
    return "data"
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('fetch_data');
    expect(chunks[0].metadata.symbolType).toBe('function');
  });
  
  it('should extract Python imports', () => {
    const content = `
import os
from pathlib import Path

def use_path():
    return Path.home()
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    const functionChunk = chunks.find(c => c.metadata.symbolName === 'use_path');
    expect(functionChunk).toBeDefined();
    expect(functionChunk?.metadata.imports).toBeDefined();
    expect(functionChunk?.metadata.imports?.length).toBeGreaterThan(0);
    // Check that at least one import is captured
    expect(functionChunk?.metadata.imports?.some(imp => imp.includes('os') || imp.includes('pathlib'))).toBe(true);
  });
  
  it('should calculate complexity for Python functions', () => {
    const content = `
def complex_function(x):
    if x > 0:
        return 1
    elif x < 0:
        return -1
    else:
        return 0
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.complexity).toBeDefined();
    expect(chunks[0].metadata.complexity).toBeGreaterThan(1);
  });
  
  it('should extract function parameters', () => {
    const content = `
def greet(name: str, age: int = 25):
    return f"Hello {name}, you are {age}"
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.parameters).toBeDefined();
    expect(chunks[0].metadata.parameters?.length).toBe(2);
  });
  
  it('should handle __init__ method', () => {
    const content = `
class Person:
    def __init__(self, name):
        self.name = name
    
    def greet(self):
        return f"Hello, {self.name}"
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    expect(chunks).toHaveLength(2);
    const initMethod = chunks.find(c => c.metadata.symbolName === '__init__');
    expect(initMethod).toBeDefined();
    expect(initMethod?.metadata.symbolType).toBe('method');
    expect(initMethod?.metadata.parentClass).toBe('Person');
  });
  
  it('should handle methods in top-level classes', () => {
    const content = `
class Outer:
    def outer_method(self):
        pass
    
    def another_method(self):
        return True
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    // Should extract methods from the class
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some(c => c.metadata.symbolName === 'outer_method')).toBe(true);
    expect(chunks.some(c => c.metadata.symbolName === 'another_method')).toBe(true);
  });
  
  it('should extract signature for Python functions', () => {
    const content = `
def calculate_sum(numbers: list[int]) -> int:
    return sum(numbers)
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.signature).toBeDefined();
    expect(chunks[0].metadata.signature).toContain('calculate_sum');
  });
  
  it('should handle multiline function definitions', () => {
    const content = `
def long_function(
    param1: str,
    param2: int,
    param3: bool
) -> dict:
    return {"p1": param1, "p2": param2, "p3": param3}
`;
    
    const chunks = chunkByAST('test.py', content.trim());
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.symbolName).toBe('long_function');
    expect(chunks[0].metadata.parameters?.length).toBe(3);
  });
});

