import fs from 'fs';
import path from 'path';
import os from 'os';

const OPENCODE_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'opencode');
const AUTH_FILE = path.join(OPENCODE_DATA_DIR, 'auth.json');

function readAuthFile() {
  if (!fs.existsSync(AUTH_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(AUTH_FILE, 'utf8');
    const trimmed = content.trim();
    if (!trimmed) {
      return {};
    }
    return JSON.parse(trimmed);
  } catch (error) {
    console.error('Failed to read auth file:', error);
    throw new Error('Failed to read OpenCode auth configuration');
  }
}

function writeAuthFile(auth) {
  try {
    if (!fs.existsSync(OPENCODE_DATA_DIR)) {
      fs.mkdirSync(OPENCODE_DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(AUTH_FILE)) {
      const backupFile = `${AUTH_FILE}.openchamber.backup`;
      fs.copyFileSync(AUTH_FILE, backupFile);
      console.log(`Created auth backup: ${backupFile}`);
    }

    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
    console.log('Successfully wrote auth file');
  } catch (error) {
    console.error('Failed to write auth file:', error);
    throw new Error('Failed to write OpenCode auth configuration');
  }
}

function saveProviderAuth(providerId, entry = {}) {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID is required');
  }

  const key = typeof entry.key === 'string' ? entry.key.trim() : '';
  if (!key) {
    throw new Error('API key is required');
  }

  const type = typeof entry.type === 'string' && entry.type.trim() ? entry.type.trim() : 'api';
  const auth = readAuthFile();
  auth[providerId] = { type, key };
  writeAuthFile(auth);
  console.log(`Saved provider auth: ${providerId}`);
  return auth[providerId];
}

function removeProviderAuth(providerId) {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID is required');
  }

  const auth = readAuthFile();
  
  if (!auth[providerId]) {
    console.log(`Provider ${providerId} not found in auth file, nothing to remove`);
    return false;
  }

  delete auth[providerId];
  writeAuthFile(auth);
  console.log(`Removed provider auth: ${providerId}`);
  return true;
}

function getProviderAuth(providerId) {
  const auth = readAuthFile();
  return auth[providerId] || null;
}

function listProviderAuths() {
  const auth = readAuthFile();
  return Object.keys(auth);
}

export {
  readAuthFile,
  writeAuthFile,
  saveProviderAuth,
  removeProviderAuth,
  getProviderAuth,
  listProviderAuths,
  AUTH_FILE,
  OPENCODE_DATA_DIR
};
