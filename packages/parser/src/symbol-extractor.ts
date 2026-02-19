/**
 * Symbol extraction utilities for different programming languages.
 * Extracts function, class, and interface names from code chunks for better indexing.
 */

export interface ExtractedSymbols {
  functions: string[];
  classes: string[];
  interfaces: string[];
}

interface LanguageExtractors {
  functions: (content: string) => string[];
  classes?: (content: string) => string[];
  interfaces?: (content: string) => string[];
}

const LANGUAGE_EXTRACTORS: Record<string, LanguageExtractors> = {
  typescript: {
    functions: extractTSFunctions,
    classes: extractTSClasses,
    interfaces: extractTSInterfaces,
  },
  tsx: {
    functions: extractTSFunctions,
    classes: extractTSClasses,
    interfaces: extractTSInterfaces,
  },
  javascript: { functions: extractJSFunctions, classes: extractJSClasses },
  jsx: { functions: extractJSFunctions, classes: extractJSClasses },
  python: { functions: extractPythonFunctions, classes: extractPythonClasses },
  py: { functions: extractPythonFunctions, classes: extractPythonClasses },
  php: {
    functions: extractPHPFunctions,
    classes: extractPHPClasses,
    interfaces: extractPHPInterfaces,
  },
  vue: { functions: extractVueFunctions, classes: extractVueComponents },
  go: { functions: extractGoFunctions, interfaces: extractGoInterfaces },
  java: {
    functions: extractJavaFunctions,
    classes: extractJavaClasses,
    interfaces: extractJavaInterfaces,
  },
  csharp: {
    functions: extractCSharpFunctions,
    classes: extractCSharpClasses,
    interfaces: extractCSharpInterfaces,
  },
  cs: {
    functions: extractCSharpFunctions,
    classes: extractCSharpClasses,
    interfaces: extractCSharpInterfaces,
  },
  ruby: { functions: extractRubyFunctions, classes: extractRubyClasses },
  rb: { functions: extractRubyFunctions, classes: extractRubyClasses },
  rust: { functions: extractRustFunctions },
  rs: { functions: extractRustFunctions },
};

/**
 * Extract symbols (functions, classes, interfaces) from code content.
 *
 * @param content - The code content to extract symbols from
 * @param language - The programming language of the content
 * @returns Extracted symbols organized by type
 */
export function extractSymbols(content: string, language: string): ExtractedSymbols {
  const extractors = LANGUAGE_EXTRACTORS[language.toLowerCase()];
  if (!extractors) {
    return { functions: [], classes: [], interfaces: [] };
  }
  return {
    functions: extractors.functions(content),
    classes: extractors.classes?.(content) ?? [],
    interfaces: extractors.interfaces?.(content) ?? [],
  };
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
  const arrowMatches = content.matchAll(
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
  );
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
  const functionMatches = content.matchAll(
    /(?:public|private|protected)?\s*function\s+(\w+)\s*\(/g,
  );
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
  const methodMatches = content.matchAll(
    /(?:public|private|protected)\s+(?:static\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/g,
  );
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
  const methodMatches = content.matchAll(
    /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/g,
  );
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

// Vue Functions
function extractVueFunctions(content: string): string[] {
  const names = new Set<string>();

  // Extract script content from Vue SFC
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return [];

  const scriptContent = scriptMatch[1];

  // Composition API: const/function name = ...
  const compositionMatches = scriptContent.matchAll(/(?:const|function)\s+(\w+)\s*=/g);
  for (const match of compositionMatches) {
    names.add(match[1]);
  }

  // Options API methods
  const methodMatches = scriptContent.matchAll(/(\w+)\s*\([^)]*\)\s*{/g);
  for (const match of methodMatches) {
    names.add(match[1]);
  }

  return Array.from(names);
}

// Vue Components
function extractVueComponents(content: string): string[] {
  const names = new Set<string>();

  // Extract component name from filename convention or export
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return [];

  const scriptContent = scriptMatch[1];

  // export default { name: 'ComponentName' }
  const nameMatch = scriptContent.match(/name:\s*['"](\w+)['"]/);
  if (nameMatch) {
    names.add(nameMatch[1]);
  }

  // defineComponent or <script setup> components
  const defineComponentMatch = scriptContent.match(/defineComponent\s*\(/);
  if (defineComponentMatch) {
    names.add('VueComponent');
  }

  return Array.from(names);
}
