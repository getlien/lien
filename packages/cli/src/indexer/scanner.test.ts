import { describe, it, expect } from 'vitest';
import { detectLanguage } from './scanner.js';

describe('detectLanguage', () => {
  it('should detect TypeScript files', () => {
    expect(detectLanguage('test.ts')).toBe('typescript');
    expect(detectLanguage('Component.tsx')).toBe('typescript');
    expect(detectLanguage('/path/to/file.ts')).toBe('typescript');
  });

  it('should detect JavaScript files', () => {
    expect(detectLanguage('test.js')).toBe('javascript');
    expect(detectLanguage('Component.jsx')).toBe('javascript');
    expect(detectLanguage('index.mjs')).toBe('javascript');
    expect(detectLanguage('config.cjs')).toBe('javascript');
  });

  it('should detect Python files', () => {
    expect(detectLanguage('script.py')).toBe('python');
    expect(detectLanguage('__init__.py')).toBe('python');
  });

  it('should detect Rust files', () => {
    expect(detectLanguage('main.rs')).toBe('rust');
    expect(detectLanguage('lib.rs')).toBe('rust');
  });

  it('should detect Go files', () => {
    expect(detectLanguage('main.go')).toBe('go');
    expect(detectLanguage('server.go')).toBe('go');
  });

  it('should detect Java files', () => {
    expect(detectLanguage('Main.java')).toBe('java');
    expect(detectLanguage('Application.java')).toBe('java');
  });

  it('should detect C files', () => {
    expect(detectLanguage('main.c')).toBe('c');
    expect(detectLanguage('utils.c')).toBe('c');
    expect(detectLanguage('header.h')).toBe('c'); // .h defaults to C
  });

  it('should detect C++ files', () => {
    expect(detectLanguage('main.cpp')).toBe('cpp');
    expect(detectLanguage('utils.cc')).toBe('cpp');
    expect(detectLanguage('header.hpp')).toBe('cpp');
    expect(detectLanguage('header.cxx')).toBe('cpp');
  });

  it('should detect PHP files', () => {
    expect(detectLanguage('index.php')).toBe('php');
    expect(detectLanguage('Router.php')).toBe('php');
  });

  it('should detect Vue files', () => {
    expect(detectLanguage('App.vue')).toBe('vue');
    expect(detectLanguage('UserList.vue')).toBe('vue');
  });

  it('should detect Ruby files', () => {
    expect(detectLanguage('app.rb')).toBe('ruby');
    expect(detectLanguage('script.rb')).toBe('ruby');
  });

  it('should detect Swift files', () => {
    expect(detectLanguage('Main.swift')).toBe('swift');
    expect(detectLanguage('ViewController.swift')).toBe('swift');
  });

  it('should detect Kotlin files', () => {
    expect(detectLanguage('Main.kt')).toBe('kotlin');
    expect(detectLanguage('Activity.kt')).toBe('kotlin');
  });

  it('should detect C# files', () => {
    expect(detectLanguage('Program.cs')).toBe('csharp');
    expect(detectLanguage('Controller.cs')).toBe('csharp');
  });

  it('should detect Scala files', () => {
    expect(detectLanguage('Main.scala')).toBe('scala');
    expect(detectLanguage('App.scala')).toBe('scala');
  });

  it('should return unknown for unrecognized extensions', () => {
    expect(detectLanguage('file.txt')).toBe('unknown');
    expect(detectLanguage('image.png')).toBe('unknown');
    expect(detectLanguage('data.json')).toBe('unknown');
  });

  it('should handle files without extensions', () => {
    expect(detectLanguage('Makefile')).toBe('unknown');
    expect(detectLanguage('README')).toBe('unknown');
  });

  it('should handle paths with multiple dots', () => {
    expect(detectLanguage('file.test.ts')).toBe('typescript');
    expect(detectLanguage('component.spec.js')).toBe('javascript');
  });

  it('should be case-insensitive', () => {
    expect(detectLanguage('File.TS')).toBe('typescript');
    expect(detectLanguage('Script.PY')).toBe('python');
    expect(detectLanguage('Main.JAVA')).toBe('java');
  });

  it('should handle relative and absolute paths', () => {
    expect(detectLanguage('../src/index.ts')).toBe('typescript');
    expect(detectLanguage('/usr/local/bin/script.py')).toBe('python');
    expect(detectLanguage('./components/Button.tsx')).toBe('typescript');
  });
});

