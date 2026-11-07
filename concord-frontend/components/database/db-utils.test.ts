import { describe, it, expect } from 'vitest';
import { connectionTestMessage, isRemotePostgresConnection } from './db-utils';

// DBX-5: the connection-test sentence must follow what the test
// actually did. The pre-DBX-5 client hardcoded the workspace message
// for every result, which would have misreported a real remote test.
describe('connectionTestMessage', () => {
  it('workspace results keep the workspace sentence', () => {
    const m = connectionTestMessage({ connected: true, scope: 'workspace', remoteContacted: false, datasets: 3 });
    expect(m.kind).toBe('ok');
    expect(m.msg).toContain('Workspace copy readable');
    expect(m.msg).toContain('3 dataset(s)');
    expect(m.msg).toContain('No remote server was contacted');
  });

  it('a remote success names the host and the server version', () => {
    const m = connectionTestMessage({ connected: true, scope: 'remote', remoteContacted: true, stage: 'ok', hostname: 'db.example.com', serverVersion: '16.2', latencyMs: 41 });
    expect(m.kind).toBe('ok');
    expect(m.msg).toContain('Connected to db.example.com');
    expect(m.msg).toContain('PostgreSQL 16.2');
    expect(m.msg).toContain('41 ms');
  });

  it('a guard refusal is reported as refused before dialing', () => {
    const m = connectionTestMessage({ connected: false, scope: 'remote', remoteContacted: false, stage: 'guard', error: 'private_address: host resolves to a private address' });
    expect(m.kind).toBe('err');
    expect(m.msg).toContain('refused before dialing');
  });

  it('an auth refusal is about the credentials, not the network', () => {
    const m = connectionTestMessage({ connected: false, scope: 'remote', remoteContacted: true, stage: 'auth', error: 'password authentication failed for user "svc"' });
    expect(m.kind).toBe('err');
    expect(m.msg).toContain('refused those credentials');
  });

  it('a credentials-stage refusal carries the server message', () => {
    const m = connectionTestMessage({ connected: false, scope: 'remote', remoteContacted: false, stage: 'credentials', error: 'The stored password could not be read' });
    expect(m.kind).toBe('err');
    expect(m.msg).toContain('could not be read');
  });

  it('a connect failure names the host it could not reach', () => {
    const m = connectionTestMessage({ connected: false, scope: 'remote', remoteContacted: true, stage: 'connect', hostname: 'db.example.com', error: 'connect ETIMEDOUT' });
    expect(m.kind).toBe('err');
    expect(m.msg).toContain('Could not reach db.example.com');
  });

  it('a not-wired engine reports its own message, not a fake connection', () => {
    const m = connectionTestMessage({ connected: false, scope: 'remote', remoteContacted: false, remoteTest: 'not_wired_for_engine', message: 'Remote connection tests are wired for PostgreSQL so far' });
    expect(m.kind).toBe('err');
    expect(m.msg).toContain('wired for PostgreSQL so far');
  });
});

describe('isRemotePostgresConnection', () => {
  it('matches the server predicate', () => {
    expect(isRemotePostgresConnection({ engine: 'postgresql', host: 'db.example.com' })).toBe(true);
    expect(isRemotePostgresConnection({ engine: 'postgresql', host: 'local' })).toBe(false);
    expect(isRemotePostgresConnection({ engine: 'postgresql', host: '' })).toBe(false);
    expect(isRemotePostgresConnection({ engine: 'mysql', host: 'db.example.com' })).toBe(false);
    expect(isRemotePostgresConnection({ engine: 'in-memory', host: 'local' })).toBe(false);
  });
});
