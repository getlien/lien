import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  encodeRequest,
  encodeResponse,
  parseRequest,
  parseResponse,
} from './protocol.js';

describe('protocol encode/parse round-trip', () => {
  it('round-trips a valid request', () => {
    const original = {
      v: PROTOCOL_VERSION as 1,
      session_id: 'abc-123',
      file_path: 'src/foo.ts',
      cwd: '/repo',
    };
    const encoded = encodeRequest(original);
    expect(encoded.endsWith('\n')).toBe(true);
    expect(parseRequest(encoded)).toEqual(original);
  });

  it('round-trips a response with a string annotation', () => {
    const original = {
      v: PROTOCOL_VERSION as 1,
      annotation: 'Lien impact for foo.ts:\n  • etc.',
    };
    expect(parseResponse(encodeResponse(original))).toEqual(original);
  });

  it('round-trips a null-annotation response', () => {
    const original = { v: PROTOCOL_VERSION as 1, annotation: null };
    expect(parseResponse(encodeResponse(original))).toEqual(original);
  });

  it('rejects requests with a missing or wrong protocol version', () => {
    expect(parseRequest('{"session_id":"a","file_path":"b","cwd":"c"}')).toBeNull();
    expect(parseRequest('{"v":2,"session_id":"a","file_path":"b","cwd":"c"}')).toBeNull();
  });

  it('rejects requests with missing fields', () => {
    expect(parseRequest('{"v":1,"file_path":"b","cwd":"c"}')).toBeNull();
    expect(parseRequest('{"v":1,"session_id":"a","cwd":"c"}')).toBeNull();
    expect(parseRequest('{"v":1,"session_id":"a","file_path":"b"}')).toBeNull();
  });

  it('returns null on unparseable input rather than throwing', () => {
    expect(parseRequest('not json')).toBeNull();
    expect(parseRequest('')).toBeNull();
    expect(parseResponse('not json')).toBeNull();
  });

  it('rejects responses with a non-string, non-null annotation', () => {
    expect(parseResponse('{"v":1,"annotation":42}')).toBeNull();
    expect(parseResponse('{"v":1,"annotation":{"oops":true}}')).toBeNull();
  });
});
