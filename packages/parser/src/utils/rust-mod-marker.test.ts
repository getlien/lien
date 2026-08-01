import { describe, it, expect } from 'vitest';
import { markRustModSpecifier, hasRustModMarker, stripRustModMarker } from './rust-mod-marker.js';

describe('rust-mod-marker (#1021)', () => {
  it('marks a specifier so hasRustModMarker recognizes it', () => {
    const marked = markRustModSpecifier('src/thing');
    expect(hasRustModMarker(marked)).toBe(true);
  });

  it('round-trips: stripping a marked specifier returns the original', () => {
    const original = 'src/engine/helpers';
    expect(stripRustModMarker(markRustModSpecifier(original))).toBe(original);
  });

  it('does not flag an ordinary, unmarked specifier', () => {
    expect(hasRustModMarker('src/thing')).toBe(false);
    expect(hasRustModMarker('crate::auth::AuthService')).toBe(false);
    expect(hasRustModMarker('')).toBe(false);
  });

  it('stripRustModMarker is a no-op on an unmarked specifier', () => {
    expect(stripRustModMarker('src/thing')).toBe('src/thing');
  });

  it('the marker is not itself a plain ASCII path -- guards against collision with a real specifier', () => {
    const marked = markRustModSpecifier('src/thing');
    // The marker's char code should be a Private-Use-Area code point
    // (0xE000-0xF8FF), well outside the ASCII range any real import
    // specifier is written in.
    expect(marked.charCodeAt(0)).toBeGreaterThanOrEqual(0xe000);
    expect(marked.charCodeAt(0)).toBeLessThanOrEqual(0xf8ff);
  });
});
