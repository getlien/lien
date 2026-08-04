import { describe, it, expect, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { checkRootSafety, formatUnsafeRootMessage } from './unsafe-root.js';

describe('checkRootSafety (#1025)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses the filesystem root', () => {
    const result = checkRootSafety('/');

    expect(result.unsafe).toBe(true);
    expect(result.unsafe && result.kind).toBe('filesystem-root');
  });

  it('refuses the home directory exactly', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/Users/fakehome');

    const result = checkRootSafety('/Users/fakehome');

    expect(result.unsafe).toBe(true);
    expect(result.unsafe && result.kind).toBe('home');
  });

  it('does NOT refuse a project directory that lives directly under $HOME (no over-refusal)', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/Users/fakehome');

    const result = checkRootSafety('/Users/fakehome/myproject');

    expect(result.unsafe).toBe(false);
  });

  it('does NOT refuse an ordinary project directory unrelated to $HOME', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/Users/fakehome');

    const result = checkRootSafety('/code/some-repo');

    expect(result.unsafe).toBe(false);
  });

  it('resolves relative paths before comparing', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/Users/fakehome');
    vi.spyOn(process, 'cwd').mockReturnValue('/Users/fakehome');

    // A relative '.' resolves against process.cwd(), which we've mocked to
    // be the home directory itself.
    const result = checkRootSafety('.');

    expect(result.unsafe).toBe(true);
    expect(result.resolved).toBe('/Users/fakehome');
  });

  it('always reports the resolved absolute path', () => {
    const result = checkRootSafety('/some/project');

    expect(result.resolved).toBe(path.resolve('/some/project'));
  });
});

describe('formatUnsafeRootMessage', () => {
  it('names the path and mentions the override flag for a home refusal', () => {
    const message = formatUnsafeRootMessage({
      unsafe: true,
      kind: 'home',
      resolved: '/Users/fakehome',
    });

    expect(message).toContain('/Users/fakehome');
    expect(message).toContain('your home directory');
    expect(message).toContain('--allow-unsafe-root');
  });

  it('names the path and mentions the override flag for a filesystem-root refusal', () => {
    const message = formatUnsafeRootMessage({
      unsafe: true,
      kind: 'filesystem-root',
      resolved: '/',
    });

    expect(message).toContain('a filesystem root');
    expect(message).toContain('--allow-unsafe-root');
  });
});
