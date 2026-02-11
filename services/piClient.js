'use strict';

const fs = require('fs/promises');
const path = require('path');
const { Client } = require('ssh2');

function escapeSingleQuotes(value) {
  return String(value).replace(/'/g, "'\\''");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildProcessPattern(remoteScriptPath) {
  const scriptName = path.posix.basename(String(remoteScriptPath || 'remote_display.py'));
  const escapedName = escapeRegex(scriptName || 'remote_display.py');

  if (!escapedName) {
    return '[r]emote_display\\.py';
  }

  const first = escapedName[0];
  const rest = escapedName.slice(1);

  if (!first || first === '\\') {
    return escapedName;
  }

  // [r]emote_display.py prevents pgrep/pkill from matching this shell command itself.
  return `[${first}]${rest}`;
}

function resolvePiConfig(config) {
  const host = String(config.host || '').trim();
  const username = String(config.username || '').trim();
  const password = String(config.password || '');

  if (!host || !username) {
    throw new Error('Pi host and username are required.');
  }

  return {
    host,
    port: Number(config.port) || 22,
    username,
    password,
    remoteScriptPath: String(config.remoteScriptPath || `/home/${username}/Valentines/pi/remote_display.py`),
    pythonCommand: String(config.pythonCommand || 'python3'),
    useSudo: Boolean(config.useSudo)
  };
}

function withConnection(config, action) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn
      .on('ready', async () => {
        try {
          const result = await action(conn);
          conn.end();
          resolve(result);
        } catch (error) {
          conn.end();
          reject(error);
        }
      })
      .on('error', (error) => {
        reject(error);
      })
      .connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: 10000
      });
  });
}

function execCommand(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      stream.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      stream.on('close', (code) => {
        exitCode = Number(code || 0);
        resolve({ stdout, stderr, exitCode });
      });
    });
  });
}

async function execOrThrow(conn, command, context) {
  const result = await execCommand(conn, command);
  if (result.exitCode !== 0) {
    throw new Error(
      `${context} failed (exit ${result.exitCode}): ${result.stderr || result.stdout || 'No output'}`
    );
  }
  return result;
}

async function testConnection(piConfig) {
  const config = resolvePiConfig(piConfig);
  return withConnection(config, (conn) =>
    execCommand(conn, 'echo led-board-connected')
  );
}

async function uploadFile(conn, localPath, remotePath) {
  const content = await fs.readFile(localPath, 'utf8');
  const quotedPath = `'${escapeSingleQuotes(remotePath)}'`;
  const dir = remotePath.split('/').slice(0, -1).join('/') || '.';
  const command = [
    `mkdir -p '${escapeSingleQuotes(dir)}'`,
    `cat > ${quotedPath} <<'PYFILE'`,
    content,
    'PYFILE',
    `chmod +x ${quotedPath}`
  ].join('\n');

  await execOrThrow(conn, `bash -lc '${escapeSingleQuotes(command)}'`, 'Upload script');
}

async function installPiScript(piConfig, localScriptPath) {
  const config = resolvePiConfig(piConfig);

  return withConnection(config, async (conn) => {
    await uploadFile(conn, localScriptPath, config.remoteScriptPath);
    const verify = await execOrThrow(
      conn,
      `bash -lc \"test -f '${escapeSingleQuotes(config.remoteScriptPath)}' && echo ok\"`,
      'Verify uploaded script'
    );

    if (!verify.stdout.includes('ok')) {
      throw new Error('Failed to verify remote script path after upload.');
    }

    return {
      remoteScriptPath: config.remoteScriptPath,
      stdout: verify.stdout,
      stderr: verify.stderr
    };
  });
}

async function stopRenderer(piConfig) {
  const config = resolvePiConfig(piConfig);
  const processPattern = escapeSingleQuotes(buildProcessPattern(config.remoteScriptPath));

  return withConnection(config, (conn) =>
    execOrThrow(
      conn,
      `bash -lc "pkill -f '${processPattern}' >/dev/null 2>&1 || true; echo stopped"`,
      'Stop renderer'
    )
  );
}

async function pushPayload(piConfig, payload) {
  const config = resolvePiConfig(piConfig);
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

  const py = escapeSingleQuotes(config.pythonCommand);
  const scriptPath = escapeSingleQuotes(config.remoteScriptPath);
  const processPattern = escapeSingleQuotes(buildProcessPattern(config.remoteScriptPath));
  const sudoPrefix = config.useSudo ? 'sudo -n ' : '';

  return withConnection(config, async (conn) => {
    const stopResult = await execCommand(
      conn,
      `bash -lc "pkill -f '${processPattern}' >/dev/null 2>&1 || true"`
    );

    const launchResult = await execCommand(
      conn,
      `bash -lc "nohup ${sudoPrefix}${py} '${scriptPath}' --runner --payload-b64 '${payloadB64}' > /tmp/lrdigiboard.log 2>&1 < /dev/null & echo __LAUNCH__:ok"`
    );

    const probeResult = await execCommand(
      conn,
      `bash -lc "sleep 0.45; if pgrep -f '${processPattern}' >/dev/null 2>&1; then echo __STATUS__:started; else echo __STATUS__:failed; fi"`
    );

    const started = [probeResult.stdout, probeResult.stderr]
      .filter(Boolean)
      .join('\n')
      .includes('__STATUS__:started');

    let status = started ? 'started' : 'failed';
    let diagResult = { stdout: '', stderr: '', exitCode: 0 };

    if (!started) {
      diagResult = await execCommand(
        conn,
        `bash -lc "if [ -f /tmp/lrdigiboard.log ]; then tail -n 80 /tmp/lrdigiboard.log; else echo __LOG__:missing /tmp/lrdigiboard.log; fi"`
      );

      const statusFromProbe = [probeResult.stdout, probeResult.stderr]
        .filter(Boolean)
        .join('\n');
      if (!statusFromProbe.includes('__STATUS__:failed')) {
        status = 'unknown';
      }
    }

    return {
      exitCode: started ? 0 : probeResult.exitCode || launchResult.exitCode || 1,
      stdout: [stopResult.stdout, launchResult.stdout, probeResult.stdout, diagResult.stdout]
        .filter(Boolean)
        .join('\n'),
      stderr: [stopResult.stderr, launchResult.stderr, probeResult.stderr, diagResult.stderr]
        .filter(Boolean)
        .join('\n'),
      started,
      status
    };
  });
}

module.exports = {
  testConnection,
  installPiScript,
  stopRenderer,
  pushPayload
};
