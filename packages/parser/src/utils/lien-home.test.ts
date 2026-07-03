import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import { getLienHome } from './lien-home.js';

describe('getLienHome', () => {
  const originalEnv = process.env.LIEN_HOME;

  beforeEach(() => {
    delete process.env.LIEN_HOME;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LIEN_HOME;
    } else {
      process.env.LIEN_HOME = originalEnv;
    }
  });

  it('falls back to os.homedir() when LIEN_HOME is unset', () => {
    expect(getLienHome()).toBe(os.homedir());
  });

  it('prefers LIEN_HOME when set', () => {
    process.env.LIEN_HOME = '/tmp/fake-lien-home';
    expect(getLienHome()).toBe('/tmp/fake-lien-home');
  });

  it('ignores an empty LIEN_HOME and falls back to os.homedir()', () => {
    process.env.LIEN_HOME = '';
    expect(getLienHome()).toBe(os.homedir());
  });
});
