import { describe, it, expect } from 'vitest';
import { generateId } from '../lib/id';

describe('generateId', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('returns non-empty string', () => {
    expect(generateId().length).toBeGreaterThan(0);
  });
});
