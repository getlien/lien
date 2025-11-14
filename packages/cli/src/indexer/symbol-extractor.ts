/**
 * Symbol extraction utilities for different programming languages.
 * Extracts function, class, and interface names from code chunks for better indexing.
 */

export interface ExtractedSymbols {
  functions: string[];
  classes: string[];
  interfaces: string[];
}

/**
 * Extract symbols (functions, classes, interfaces) from code content.
 * 
 * @param content - The code content to extract symbols from
 * @param language - The programming language of the content
 * @returns Extracted symbols organized by type
 */
export function extractSymbols(
  content: string,
  language: string
): ExtractedSymbols {
  const symbols: ExtractedSymbols = {
    functions: [],
    classes: [],
    interfaces: [],
  };
  
  const normalizedLang = language.toLowerCase();
  
  switch (normalizedLang) {
    case 'typescript':
    case 'tsx':
      symbols.functions = extractTSFunctions(content);
      symbols.classes = extractTSClasses(content);
      symbols.interfaces = extractTSInterfaces(content);
      break;
    
    case 'javascript':
    case 'jsx':
      symbols.functions = extractJSFunctions(content);
      symbols.classes = extractJSClasses(content);
      break;
    
    case 'python':
    case 'py':
      symbols.functions = extractPythonFunctions(content);
      symbols.classes = extractPythonClasses(content);
      break;
    
    case 'php':
      symbols.functions = extractPHPFunctions(content);
      symbols.classes = extractPHPClasses(content);
      symbols.interfaces = extractPHPInterfaces(content);
      break;
    
    case 'go':
      symbols.functions = extractGoFunctions(content);
      symbols.interfaces = extractGoInterfaces(content);
      break;
    
    case 'java':
      symbols.functions = extractJavaFunctions(content);
      symbols.classes = extractJavaClasses(content);
      symbols.interfaces = extractJavaInterfaces(content);
      break;
    
    case 'csharp':
    case 'cs':
      symbols.functions = extractCSharpFunctions(content);
      symbols.classes = extractCSharpClasses(content);
      symbols.interfaces = extractCSharpInterfaces(content);
      break;
    
    case 'ruby':
    case 'rb':
      symbols.functions = extractRubyFunctions(content);
      symbols.classes = extractRubyClasses(content);
      break;
    
    case 'rust':
    case 'rs':
      symbols.functions = extractRustFunctions(content);
      break;
  }
  
  return symbols;
}

// TypeScript / JavaScript Functions
function extractTSFunctions(content: string): string[] {
  const names = new Set<string>();
  
  // Regular functions: function name(...) or async function name(...)
  const functionMatches = content.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g);
  for (const match of functionMatches) {
    names.add(match[1]);
  }
  
  // Arrow functions: const/let/var name = (...) =>
  const arrowMatches = content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
  for (const match of arrowMatches) {
    names.add(match[1]);
  }
  
  // Method definitions: name(...) { or async name(...) {
  const methodMatches = content.matchAll(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/g);
  for (const match of methodMatches) {
    // Exclude common keywords
    if (!['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
      names.add(match[1]);
    }
  }
  
  // Export function
  const exportMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g);
  for (const match of exportMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractJSFunctions(content: string): string[] {
  return extractTSFunctions(content); // Same patterns
}

function extractTSClasses(content: string): string[] {
  const names = new Set<string>();
  
  // Class declarations: class Name or export class Name
  const classMatches = content.matchAll(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g);
  for (const match of classMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractJSClasses(content: string): string[] {
  return extractTSClasses(content); // Same patterns
}

function extractTSInterfaces(content: string): string[] {
  const names = new Set<string>();
  
  // Interface declarations: interface Name or export interface Name
  const interfaceMatches = content.matchAll(/(?:export\s+)?interface\s+(\w+)/g);
  for (const match of interfaceMatches) {
    names.add(match[1]);
  }
  
  // Type aliases: type Name = or export type Name =
  const typeMatches = content.matchAll(/(?:export\s+)?type\s+(\w+)\s*=/g);
  for (const match of typeMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

// Python Functions
function extractPythonFunctions(content: string): string[] {
  const names = new Set<string>();
  
  // Function definitions: def name(...):
  const functionMatches = content.matchAll(/def\s+(\w+)\s*\(/g);
  for (const match of functionMatches) {
    names.add(match[1]);
  }
  
  // Async functions: async def name(...):
  const asyncMatches = content.matchAll(/async\s+def\s+(\w+)\s*\(/g);
  for (const match of asyncMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractPythonClasses(content: string): string[] {
  const names = new Set<string>();
  
  // Class definitions: class Name or class Name(Base):
  const classMatches = content.matchAll(/class\s+(\w+)(?:\s*\(|:)/g);
  for (const match of classMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

// PHP Functions
function extractPHPFunctions(content: string): string[] {
  const names = new Set<string>();
  
  // Function definitions: function name(...) or public function name(...)
  const functionMatches = content.matchAll(/(?:public|private|protected)?\s*function\s+(\w+)\s*\(/g);
  for (const match of functionMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractPHPClasses(content: string): string[] {
  const names = new Set<string>();
  
  // Class definitions: class Name or abstract class Name
  const classMatches = content.matchAll(/(?:abstract\s+)?class\s+(\w+)/g);
  for (const match of classMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractPHPInterfaces(content: string): string[] {
  const names = new Set<string>();
  
  // Interface definitions: interface Name
  const interfaceMatches = content.matchAll(/interface\s+(\w+)/g);
  for (const match of interfaceMatches) {
    names.add(match[1]);
  }
  
  // Trait definitions: trait Name
  const traitMatches = content.matchAll(/trait\s+(\w+)/g);
  for (const match of traitMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

// Go Functions
function extractGoFunctions(content: string): string[] {
  const names = new Set<string>();
  
  // Function definitions: func Name(...) or func (r *Receiver) Name(...)
  const functionMatches = content.matchAll(/func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/g);
  for (const match of functionMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractGoInterfaces(content: string): string[] {
  const names = new Set<string>();
  
  // Interface definitions: type Name interface {
  const interfaceMatches = content.matchAll(/type\s+(\w+)\s+interface\s*\{/g);
  for (const match of interfaceMatches) {
    names.add(match[1]);
  }
  
  // Struct definitions: type Name struct {
  const structMatches = content.matchAll(/type\s+(\w+)\s+struct\s*\{/g);
  for (const match of structMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

// Java Functions
function extractJavaFunctions(content: string): string[] {
  const names = new Set<string>();
  
  // Method definitions: public/private/protected return_type name(...)
  const methodMatches = content.matchAll(/(?:public|private|protected)\s+(?:static\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/g);
  for (const match of methodMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractJavaClasses(content: string): string[] {
  const names = new Set<string>();
  
  // Class definitions: public class Name or abstract class Name
  const classMatches = content.matchAll(/(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/g);
  for (const match of classMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractJavaInterfaces(content: string): string[] {
  const names = new Set<string>();
  
  // Interface definitions: public interface Name
  const interfaceMatches = content.matchAll(/(?:public\s+)?interface\s+(\w+)/g);
  for (const match of interfaceMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

// C# Functions
function extractCSharpFunctions(content: string): string[] {
  const names = new Set<string>();
  
  // Method definitions: public/private/protected return_type Name(...)
  const methodMatches = content.matchAll(/(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/g);
  for (const match of methodMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractCSharpClasses(content: string): string[] {
  const names = new Set<string>();
  
  // Class definitions: public class Name or abstract class Name
  const classMatches = content.matchAll(/(?:public|internal)?\s*(?:abstract\s+)?class\s+(\w+)/g);
  for (const match of classMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractCSharpInterfaces(content: string): string[] {
  const names = new Set<string>();
  
  // Interface definitions: public interface Name
  const interfaceMatches = content.matchAll(/(?:public|internal)?\s*interface\s+(\w+)/g);
  for (const match of interfaceMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

// Ruby Functions
function extractRubyFunctions(content: string): string[] {
  const names = new Set<string>();
  
  // Method definitions: def name or def self.name
  const methodMatches = content.matchAll(/def\s+(?:self\.)?(\w+)/g);
  for (const match of methodMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

function extractRubyClasses(content: string): string[] {
  const names = new Set<string>();
  
  // Class definitions: class Name or class Name < Base
  const classMatches = content.matchAll(/class\s+(\w+)/g);
  for (const match of classMatches) {
    names.add(match[1]);
  }
  
  // Module definitions: module Name
  const moduleMatches = content.matchAll(/module\s+(\w+)/g);
  for (const match of moduleMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

// Rust Functions
function extractRustFunctions(content: string): string[] {
  const names = new Set<string>();
  
  // Function definitions: fn name(...) or pub fn name(...)
  const functionMatches = content.matchAll(/(?:pub\s+)?fn\s+(\w+)\s*\(/g);
  for (const match of functionMatches) {
    names.add(match[1]);
  }
  
  // Struct definitions: struct Name {
  const structMatches = content.matchAll(/(?:pub\s+)?struct\s+(\w+)/g);
  for (const match of structMatches) {
    names.add(match[1]);
  }
  
  // Trait definitions: trait Name {
  const traitMatches = content.matchAll(/(?:pub\s+)?trait\s+(\w+)/g);
  for (const match of traitMatches) {
    names.add(match[1]);
  }
  
  return Array.from(names);
}

