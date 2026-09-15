import { safeInternalPath } from '@/lib/safe-path';

describe('safeInternalPath', () => {
  it('accepts a plain internal path', () => {
    expect(safeInternalPath('/dashboard/projects')).toBe('/dashboard/projects');
    expect(safeInternalPath('/dashboard/projects/proj_1/overview?tab=keys')).toBe(
      '/dashboard/projects/proj_1/overview?tab=keys',
    );
  });

  it('rejects a protocol-relative URL (open redirect via //host)', () => {
    expect(safeInternalPath('//evil.example')).toBeUndefined();
    expect(safeInternalPath('//evil.example/phish')).toBeUndefined();
  });

  it('rejects an absolute URL naming another host', () => {
    expect(safeInternalPath('https://evil.example')).toBeUndefined();
    expect(safeInternalPath('http://evil.example/login')).toBeUndefined();
  });

  it('rejects a value that does not start with a single /', () => {
    expect(safeInternalPath('evil.example')).toBeUndefined();
    expect(safeInternalPath('')).toBeUndefined();
  });

  it('rejects a backslash-based host trick some browsers normalize as //', () => {
    expect(safeInternalPath('/\\evil.example')).toBeUndefined();
  });

  it('passes through null/undefined as undefined', () => {
    expect(safeInternalPath(null)).toBeUndefined();
    expect(safeInternalPath(undefined)).toBeUndefined();
  });
});
