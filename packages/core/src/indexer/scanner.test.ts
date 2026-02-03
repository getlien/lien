import { describe, it, expect } from 'vitest';
import { detectFileType, detectLanguage } from './scanner.js';

describe('detectFileType', () => {
  it('should export detectLanguage as a backwards-compat alias', () => {
    expect(detectLanguage).toBe(detectFileType);
  });

  it('should detect TypeScript files', () => {
    expect(detectFileType('test.ts')).toBe('typescript');
    expect(detectFileType('Component.tsx')).toBe('typescript');
    expect(detectFileType('/path/to/file.ts')).toBe('typescript');
  });

  it('should detect JavaScript files', () => {
    expect(detectFileType('test.js')).toBe('javascript');
    expect(detectFileType('Component.jsx')).toBe('javascript');
    expect(detectFileType('index.mjs')).toBe('javascript');
    expect(detectFileType('config.cjs')).toBe('javascript');
  });

  it('should detect Python files', () => {
    expect(detectFileType('script.py')).toBe('python');
    expect(detectFileType('__init__.py')).toBe('python');
  });

  it('should detect Rust files', () => {
    expect(detectFileType('main.rs')).toBe('rust');
    expect(detectFileType('lib.rs')).toBe('rust');
  });

  it('should detect Go files', () => {
    expect(detectFileType('main.go')).toBe('go');
    expect(detectFileType('server.go')).toBe('go');
  });

  it('should detect Java files', () => {
    expect(detectFileType('Main.java')).toBe('java');
    expect(detectFileType('Application.java')).toBe('java');
  });

  it('should detect C files', () => {
    expect(detectFileType('main.c')).toBe('c');
    expect(detectFileType('utils.c')).toBe('c');
    expect(detectFileType('header.h')).toBe('c'); // .h defaults to C
  });

  it('should detect C++ files', () => {
    expect(detectFileType('main.cpp')).toBe('cpp');
    expect(detectFileType('utils.cc')).toBe('cpp');
    expect(detectFileType('header.hpp')).toBe('cpp');
    expect(detectFileType('header.cxx')).toBe('cpp');
  });

  it('should detect PHP files', () => {
    expect(detectFileType('index.php')).toBe('php');
    expect(detectFileType('Router.php')).toBe('php');
  });

  it('should detect Vue files', () => {
    expect(detectFileType('App.vue')).toBe('vue');
    expect(detectFileType('UserList.vue')).toBe('vue');
  });

  it('should detect Ruby files', () => {
    expect(detectFileType('app.rb')).toBe('ruby');
    expect(detectFileType('script.rb')).toBe('ruby');
  });

  it('should detect Swift files', () => {
    expect(detectFileType('Main.swift')).toBe('swift');
    expect(detectFileType('ViewController.swift')).toBe('swift');
  });

  it('should detect Kotlin files', () => {
    expect(detectFileType('Main.kt')).toBe('kotlin');
    expect(detectFileType('Activity.kt')).toBe('kotlin');
  });

  it('should detect C# files', () => {
    expect(detectFileType('Program.cs')).toBe('csharp');
    expect(detectFileType('Controller.cs')).toBe('csharp');
  });

  it('should detect Scala files', () => {
    expect(detectFileType('Main.scala')).toBe('scala');
    expect(detectFileType('App.scala')).toBe('scala');
  });

  it('should detect Liquid files', () => {
    expect(detectFileType('product.liquid')).toBe('liquid');
    expect(detectFileType('theme.liquid')).toBe('liquid');
    expect(detectFileType('header.liquid')).toBe('liquid');
  });

  it('should return unknown for unrecognized extensions', () => {
    expect(detectFileType('file.txt')).toBe('unknown');
    expect(detectFileType('image.png')).toBe('unknown');
    expect(detectFileType('data.json')).toBe('unknown');
  });

  it('should handle files without extensions', () => {
    expect(detectFileType('Makefile')).toBe('unknown');
    expect(detectFileType('README')).toBe('unknown');
  });

  it('should handle paths with multiple dots', () => {
    expect(detectFileType('file.test.ts')).toBe('typescript');
    expect(detectFileType('component.spec.js')).toBe('javascript');
  });

  it('should be case-insensitive', () => {
    expect(detectFileType('File.TS')).toBe('typescript');
    expect(detectFileType('Script.PY')).toBe('python');
    expect(detectFileType('Main.JAVA')).toBe('java');
  });

  it('should handle relative and absolute paths', () => {
    expect(detectFileType('../src/index.ts')).toBe('typescript');
    expect(detectFileType('/usr/local/bin/script.py')).toBe('python');
    expect(detectFileType('./components/Button.tsx')).toBe('typescript');
  });
});

