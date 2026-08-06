import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
export type DiagnosticKind = 'action' | 'event' | 'error';
export type DiagnosticErrorType =
  | 'supabase'
  | 'network'
  | 'validation'
  | 'authorization'
  | 'filesystem'
  | 'process'
  | 'ipc'
  | 'shutdown'
  | 'unknown';

export type DiagnosticDetails = Readonly<Record<string, unknown>>;

export interface DiagnosticPaths {
  readonly rootDir: string;
  readonly sessionDir: string;
  readonly eventsFile: string;
  readonly errorsFile: string;
  readonly latestSessionFile: string;
}

export interface DiagnosticsLogger {
  readonly sessionId: string;
  readonly paths: DiagnosticPaths;
  action(name: string, details?: DiagnosticDetails): void;
  info(category: string, name: string, details?: DiagnosticDetails): void;
  warn(category: string, name: string, details?: DiagnosticDetails): void;
  error(
    category: string,
    name: string,
    error: unknown,
    details?: DiagnosticDetails,
    explicitType?: DiagnosticErrorType
  ): void;
  close(reason?: string): void;
}

export interface DiagnosticsLoggerOptions {
  readonly rootDir: string;
  readonly appVersion: string;
  readonly packaged: boolean;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly pid?: number;
  readonly platform?: string;
  readonly arch?: string;
  readonly maxEventBytes?: number;
  readonly maxErrorBytes?: number;
}

interface SerializedError {
  readonly type: DiagnosticErrorType;
  readonly name: string;
  readonly message: string;
  readonly code?: string | number;
  readonly stack?: string;
}

const SENSITIVE_KEY = /key|token|secret|password|authorization|credential|cookie|session/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const SENSITIVE_QUERY_PATTERN = /([?&](?:key|token|secret|password|signature)=)[^&#\s]+/gi;
const MAX_STRING_LENGTH = 4_000;
const DEFAULT_MAX_EVENT_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ERROR_BYTES = 5 * 1024 * 1024;

function sanitizeString(value: string): string {
  const redacted = value
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(SENSITIVE_QUERY_PATTERN, '$1[REDACTED]');
  if (redacted.length <= MAX_STRING_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_STRING_LENGTH)}…[truncated:${redacted.length}]`;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (depth >= 6) return '[MAX_DEPTH]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeValue(entry, seen, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeValue(entry, seen, depth + 1);
  }
  return result;
}

export function sanitizeDiagnostics(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>());
}

function errorProperty(error: unknown, key: string): unknown {
  if (!error || typeof error !== 'object') return undefined;
  return (error as Record<string, unknown>)[key];
}

export function classifyDiagnosticError(
  error: unknown,
  explicitType?: DiagnosticErrorType
): DiagnosticErrorType {
  if (explicitType) return explicitType;
  const message = String(errorProperty(error, 'message') ?? error ?? '').toLowerCase();
  const code = String(errorProperty(error, 'code') ?? '').toLowerCase();
  const combined = `${message} ${code}`;

  if (/supabase|storage|bucket|row.level|rls|postgres/.test(combined)) return 'supabase';
  if (/unauthorized|forbidden|permission|jwt|401|403/.test(combined)) return 'authorization';
  if (/fetch|network|timeout|timed out|econn|enotfound|dns|socket/.test(combined)) return 'network';
  if (/enoent|eacces|eperm|file|directory|path/.test(combined)) return 'filesystem';
  if (/spawn|child process|process exited|stdin|stdout/.test(combined)) return 'process';
  if (/ipc|sender|channel/.test(combined)) return 'ipc';
  if (/shutdown|quit|closing|drain/.test(combined)) return 'shutdown';
  if (/invalid|missing|required|boş|eksik|geçersiz/.test(combined)) return 'validation';
  return 'unknown';
}

function serializeError(error: unknown, explicitType?: DiagnosticErrorType): SerializedError {
  const name = String(
    errorProperty(error, 'name') ?? (error instanceof Error ? error.name : 'Error')
  );
  const message = String(errorProperty(error, 'message') ?? error ?? 'Unknown error');
  const code =
    errorProperty(error, 'code') ??
    errorProperty(error, 'statusCode') ??
    errorProperty(error, 'status');
  const stack = errorProperty(error, 'stack');
  return {
    type: classifyDiagnosticError(error, explicitType),
    name: sanitizeString(name),
    message: sanitizeString(message),
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    ...(typeof stack === 'string' ? { stack: sanitizeString(stack) } : {}),
  };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'unnamed';
}

export function createDiagnosticsLogger(options: DiagnosticsLoggerOptions): DiagnosticsLogger {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const pid = options.pid ?? process.pid;
  const id = (options.createId ?? randomUUID)()
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12);
  const sessionId = `${startedAt.toISOString().replace(/[:.]/g, '-')}-${pid}-${id}`;
  const dayDir = path.join(options.rootDir, 'sessions', startedAt.toISOString().slice(0, 10));
  const sessionDir = path.join(dayDir, safeName(sessionId));
  const paths: DiagnosticPaths = {
    rootDir: options.rootDir,
    sessionDir,
    eventsFile: path.join(sessionDir, 'events.jsonl'),
    errorsFile: path.join(sessionDir, 'errors.jsonl'),
    latestSessionFile: path.join(options.rootDir, 'latest-session.json'),
  };

  fs.mkdirSync(sessionDir, { recursive: true });
  const readmePath = path.join(options.rootDir, 'README.txt');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      [
        'Ctrl2Phone diagnostics',
        '',
        '- latest-session.json: points to the newest session files.',
        '- sessions/YYYY-MM-DD/<session>/events.jsonl: ordered user actions and runtime events.',
        '- sessions/YYYY-MM-DD/<session>/errors.jsonl: errors only, including classified error type.',
        '- Credentials, tokens, JWTs and secret-looking fields are redacted automatically.',
        '- Each line is an independent JSON object and can be read even after a crash.',
        '',
      ].join('\r\n'),
      'utf8'
    );
  }
  fs.writeFileSync(
    paths.latestSessionFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        sessionId,
        startedAt: startedAt.toISOString(),
        eventsFile: paths.eventsFile,
        errorsFile: paths.errorsFile,
      },
      null,
      2
    ),
    'utf8'
  );

  let sequence = 0;
  let eventBytes = 0;
  let errorBytes = 0;
  let closed = false;
  const maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
  const maxErrorBytes = options.maxErrorBytes ?? DEFAULT_MAX_ERROR_BYTES;

  const append = (
    level: DiagnosticLevel,
    kind: DiagnosticKind,
    category: string,
    name: string,
    details?: DiagnosticDetails,
    error?: SerializedError
  ): void => {
    if (closed) return;
    try {
      const record = {
        schemaVersion: 1,
        timestamp: now().toISOString(),
        sequence: ++sequence,
        sessionId,
        level,
        kind,
        category: safeName(category),
        name: safeName(name),
        ...(details ? { details: sanitizeDiagnostics(details) } : {}),
        ...(error ? { error } : {}),
      };
      const line = `${JSON.stringify(record)}\n`;
      const bytes = Buffer.byteLength(line, 'utf8');
      if (kind === 'error') {
        if (errorBytes + bytes <= maxErrorBytes) {
          fs.appendFileSync(paths.errorsFile, line, 'utf8');
          errorBytes += bytes;
        }
        if (eventBytes + bytes <= maxEventBytes) {
          fs.appendFileSync(paths.eventsFile, line, 'utf8');
          eventBytes += bytes;
        }
        return;
      }
      if (eventBytes + bytes <= maxEventBytes) {
        fs.appendFileSync(paths.eventsFile, line, 'utf8');
        eventBytes += bytes;
      }
    } catch {
      // Diagnostics must never crash or recursively log through the application.
    }
  };

  const logger: DiagnosticsLogger = {
    sessionId,
    paths,
    action: (name, details) => append('info', 'action', 'user', name, details),
    info: (category, name, details) => append('info', 'event', category, name, details),
    warn: (category, name, details) => append('warn', 'event', category, name, details),
    error: (category, name, error, details, explicitType) =>
      append('error', 'error', category, name, details, serializeError(error, explicitType)),
    close: (reason = 'shutdown') => {
      if (closed) return;
      append('info', 'event', 'lifecycle', 'session_end', { reason });
      closed = true;
    },
  };

  logger.info('lifecycle', 'session_start', {
    appVersion: options.appVersion,
    packaged: options.packaged,
    pid,
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    eventsFile: paths.eventsFile,
    errorsFile: paths.errorsFile,
  });
  return logger;
}
