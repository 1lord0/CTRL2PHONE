import { app, safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ActionWorkflowStateStore,
  PersistedActionWorkflowState,
} from './actionWorkflowRuntime';

interface EncryptedStateEnvelope {
  version: 1;
  ciphertext: string;
}

function isState(value: unknown): value is PersistedActionWorkflowState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<PersistedActionWorkflowState>;
  return (
    state.version === 1 &&
    typeof state.supabaseUrl === 'string' &&
    typeof state.deviceId === 'string' &&
    Boolean(state.auth) &&
    typeof state.auth?.accessToken === 'string' &&
    typeof state.auth?.refreshToken === 'string' &&
    (state.channelId === undefined || typeof state.channelId === 'string') &&
    (state.inviteToken === undefined || typeof state.inviteToken === 'string') &&
    (state.inviteExpiresAt === undefined || typeof state.inviteExpiresAt === 'string')
  );
}

export function createElectronActionWorkflowStateStore(): ActionWorkflowStateStore {
  const resolvePath = () => path.join(app.getPath('userData'), 'action-workflow-state.json');

  return {
    load() {
      const filePath = resolvePath();
      if (!fs.existsSync(filePath)) return null;
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('action_secure_storage_unavailable');
      }
      const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8')) as EncryptedStateEnvelope;
      if (envelope.version !== 1 || typeof envelope.ciphertext !== 'string') {
        throw new Error('action_state_envelope_invalid');
      }
      const plaintext = safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
      const state: unknown = JSON.parse(plaintext);
      if (!isState(state)) throw new Error('action_state_invalid');
      return state;
    },
    save(state) {
      if (!isState(state)) throw new Error('action_state_invalid');
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('action_secure_storage_unavailable');
      }
      const filePath = resolvePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const ciphertext = safeStorage.encryptString(JSON.stringify(state)).toString('base64');
      const envelope: EncryptedStateEnvelope = { version: 1, ciphertext };
      fs.writeFileSync(filePath, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
    },
  };
}
