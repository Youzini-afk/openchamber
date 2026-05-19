import { buildSmartSearchConfigResponse, normalizeSmartSearchPatch, redactSmartSearchPayload, redactSmartSearchSecrets, resolveSmartSearchBinary } from './config.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;

const makeEndpointError = (message, status = 500, details = undefined) => {
  const error = new Error(message);
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
};

const appendWithLimit = (current, chunk, limitBytes) => {
  const next = current + chunk;
  if (Buffer.byteLength(next, 'utf8') <= limitBytes) {
    return { value: next, truncated: false };
  }
  const buffer = Buffer.from(next, 'utf8').subarray(0, limitBytes);
  return { value: buffer.toString('utf8'), truncated: true };
};

const parseJsonOutput = (stdout) => {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        throw makeEndpointError('Smart Search returned invalid JSON output.', 502);
      }
    }
    throw makeEndpointError('Smart Search returned non-JSON output.', 502);
  }
};

export const createSmartSearchRuntime = (dependencies = {}) => {
  const {
    fsPromises,
    path,
    spawn,
    env = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES,
  } = dependencies;

  if (!fsPromises || !path || !spawn) {
    throw new Error('createSmartSearchRuntime requires fsPromises, path, and spawn dependencies.');
  }

  let doctorInFlight = null;
  let writeQueue = Promise.resolve();

  const resolveSpawnCommand = (args) => {
    const binary = resolveSmartSearchBinary(env);
    if (process.platform === 'win32' && /\.cmd$|\.bat$/i.test(binary)) {
      return { command: 'cmd.exe', args: ['/d', '/s', '/c', binary, ...args] };
    }
    return { command: binary, args };
  };

  const killProcessTree = (child) => {
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => undefined);
      return;
    }
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  };

  const runCli = (args, options = {}) => new Promise((resolve, reject) => {
    const childEnv = {
      ...env,
      PYTHONIOENCODING: env.PYTHONIOENCODING || 'utf-8',
      PYTHONUTF8: env.PYTHONUTF8 || '1',
    };
    const spawnCommand = resolveSpawnCommand(args);
    const child = spawn(spawnCommand.command, spawnCommand.args, {
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    const limitBytes = options.outputLimitBytes ?? outputLimitBytes;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      reject(makeEndpointError('Smart Search command timed out.', 504));
    }, options.timeoutMs ?? timeoutMs);

    child.stdout?.on('data', (chunk) => {
      const result = appendWithLimit(stdout, chunk.toString('utf8'), limitBytes);
      stdout = result.value;
      stdoutTruncated = stdoutTruncated || result.truncated;
      if (stdoutTruncated) killProcessTree(child);
    });
    child.stderr?.on('data', (chunk) => {
      const result = appendWithLimit(stderr, chunk.toString('utf8'), limitBytes);
      stderr = result.value;
      stderrTruncated = stderrTruncated || result.truncated;
      if (stderrTruncated) killProcessTree(child);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(makeEndpointError('Smart Search CLI is not available. Install @konbakuyomu/smart-search or set SMART_SEARCH_BIN.', 503, redactSmartSearchSecrets(error.message)));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutTruncated || stderrTruncated) {
        reject(makeEndpointError('Smart Search command output exceeded the safety limit.', 502));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });

  const getPathInfo = async () => {
    const result = await runCli(['config', 'path', '--format', 'json'], { timeoutMs: 20_000, outputLimitBytes: 256 * 1024 });
    const parsed = parseJsonOutput(result.stdout);
    if (!parsed || typeof parsed !== 'object' || !parsed.config_file) {
      throw makeEndpointError('Smart Search config path response was invalid.', 502);
    }
    return parsed;
  };

  const readRawConfig = async (configFile) => {
    try {
      const raw = await fsPromises.readFile(configFile, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error && error.code === 'ENOENT') return {};
      if (error instanceof SyntaxError) {
        throw makeEndpointError('Smart Search config file contains invalid JSON. Fix it before saving from OpenChamber.', 409);
      }
      throw error;
    }
  };

  const writeRawConfig = async (configFile, data) => {
    await fsPromises.mkdir(path.dirname(configFile), { recursive: true });
    const tempFile = `${configFile}.openchamber-${process.pid}-${Date.now()}.tmp`;
    let mode = 0o600;
    try {
      const stat = await fsPromises.stat(configFile);
      mode = stat.mode & 0o777;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    try {
      await fsPromises.writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode });
      await fsPromises.rename(tempFile, configFile);
      if (fsPromises.chmod) {
        await Promise.resolve(fsPromises.chmod(configFile, mode)).catch(() => undefined);
      }
    } catch (error) {
      if (fsPromises.rm) {
        await Promise.resolve(fsPromises.rm(tempFile, { force: true })).catch(() => undefined);
      }
      throw error;
    }
  };

  const loadConfig = async () => {
    const pathInfo = await getPathInfo();
    const raw = await readRawConfig(pathInfo.config_file);
    return buildSmartSearchConfigResponse({ pathInfo, fileValues: raw, env });
  };

  const patchConfig = async (payload) => {
    const run = async () => {
      const patch = normalizeSmartSearchPatch(payload);
      const envControlled = [...Object.keys(patch.set), ...patch.unset].filter((key) => env[key] !== undefined);
      if (envControlled.length > 0) {
        throw makeEndpointError(`Cannot edit Smart Search keys controlled by environment variables: ${envControlled.join(', ')}`, 409);
      }
      const pathInfo = await getPathInfo();
      const raw = await readRawConfig(pathInfo.config_file);
      for (const key of patch.unset) {
        delete raw[key];
      }
      for (const [key, value] of Object.entries(patch.set)) {
        raw[key] = value;
      }
      await writeRawConfig(pathInfo.config_file, raw);
      return loadConfig();
    };
    writeQueue = writeQueue.then(run, run);
    return writeQueue;
  };

  const getStatus = async () => {
    try {
      const [pathInfo, versionResult] = await Promise.all([
        getPathInfo(),
        runCli(['--version'], { timeoutMs: 10_000, outputLimitBytes: 64 * 1024 }).catch((error) => ({ error })),
      ]);
      const version = versionResult && !versionResult.error ? versionResult.stdout.trim() : '';
      return {
        ok: true,
        available: true,
        binary: resolveSmartSearchBinary(env),
        version,
        path: pathInfo,
      };
    } catch (error) {
      return {
        ok: false,
        available: false,
        binary: resolveSmartSearchBinary(env),
        error: redactSmartSearchSecrets(error?.message || 'Smart Search is not available.'),
      };
    }
  };

  const runDoctor = async () => {
    if (doctorInFlight) return doctorInFlight;
    doctorInFlight = (async () => {
      const result = await runCli(['doctor', '--format', 'json'], { timeoutMs, outputLimitBytes });
      const parsed = parseJsonOutput(result.stdout);
      return {
        ok: Boolean(parsed?.ok),
        exitCode: result.code,
        signal: result.signal,
        result: redactSmartSearchPayload(parsed),
        stderr: result.stderr ? redactSmartSearchSecrets(result.stderr).slice(0, 4000) : '',
      };
    })().finally(() => {
      doctorInFlight = null;
    });
    return doctorInFlight;
  };

  return {
    getStatus,
    loadConfig,
    patchConfig,
    runDoctor,
  };
};
