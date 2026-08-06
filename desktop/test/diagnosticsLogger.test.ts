import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyDiagnosticError,
  createDiagnosticsLogger,
  sanitizeDiagnostics,
} from '../src/main/diagnosticsLogger';

describe('diagnostics logger', () => {
  let rootDir = '';

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl2phone-diagnostics-test-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('writes ordered action and classified error records with a latest-session pointer', () => {
    const timestamps = [
      '2026-08-06T10:00:00.000Z',
      '2026-08-06T10:00:00.001Z',
      '2026-08-06T10:00:00.002Z',
    ];
    let clock = 0;
    const logger = createDiagnosticsLogger({
      rootDir,
      appVersion: '1.0.0-test',
      packaged: true,
      pid: 42,
      createId: () => 'fixed-session',
      now: () => new Date(timestamps[Math.min(clock++, timestamps.length - 1)]),
    });

    logger.action('ui.click', { controlId: 'saveSettings' });
    logger.error(
      'supabase',
      'image_upload_failed',
      { message: 'new row violates row-level security policy', statusCode: 403 },
      { bucket: 'screenshots', supabaseKey: 'secret-value' }
    );

    const latest = JSON.parse(fs.readFileSync(logger.paths.latestSessionFile, 'utf8'));
    const events = fs
      .readFileSync(latest.eventsFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const errors = fs
      .readFileSync(latest.errorsFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(events.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(events[1]).toMatchObject({ kind: 'action', name: 'ui.click' });
    expect(errors).toHaveLength(1);
    expect(errors[0].error.type).toBe('supabase');
    expect(errors[0].details.supabaseKey).toBe('[REDACTED]');
    expect(fs.readFileSync(latest.errorsFile, 'utf8')).not.toContain('secret-value');
  });

  it('redacts JWTs, bearer values and sensitive object fields', () => {
    const sanitized = JSON.stringify(
      sanitizeDiagnostics({
        authorization: 'Bearer very-secret',
        text: 'Bearer hidden eyJabcdefgh.abcdefgh.abcdefgh',
        url: 'https://example.test/a?token=hidden&safe=1',
      })
    );

    expect(sanitized).not.toContain('very-secret');
    expect(sanitized).not.toContain('eyJabcdefgh');
    expect(sanitized).not.toContain('token=hidden');
    expect(sanitized).toContain('[REDACTED]');
  });

  it.each([
    ['fetch failed: ECONNREFUSED', 'network'],
    ['new row violates row-level security policy', 'supabase'],
    ['Unauthorized 401', 'authorization'],
    ['ENOENT file missing', 'filesystem'],
    ['required value is missing', 'validation'],
  ])('classifies %s as %s', (message, expected) => {
    expect(classifyDiagnosticError(new Error(message))).toBe(expected);
  });
});
