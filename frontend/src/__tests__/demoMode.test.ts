import { describe, expect, it } from 'vitest';
import { parseDemoCredentials } from '../lib/demoMode';

describe('demo mode credentials', () => {
  it('only prefills when demo mode is explicitly enabled', () => {
    expect(parseDemoCredentials(undefined, 'demo', 'P2Demo2026')).toBeNull();
    expect(parseDemoCredentials('false', 'demo', 'P2Demo2026')).toBeNull();
  });

  it('requires both username and password', () => {
    expect(parseDemoCredentials('true', '', 'P2Demo2026')).toBeNull();
    expect(parseDemoCredentials('true', 'demo', '')).toBeNull();
  });

  it('trims the username but keeps the password exact', () => {
    expect(parseDemoCredentials(' TRUE ', ' demo ', ' P2Demo2026 ')).toEqual({
      username: 'demo',
      password: ' P2Demo2026 ',
    });
  });
});
