'use strict';

const crypto = require('crypto');
const express = require('express');
const path = require('path');

const { getState, saveState, normalizeState } = require('./services/stateStore');
const { buildPayload } = require('./services/payloadBuilder');
const { getCurrentWeather } = require('./services/weatherService');
const { loadIcsEventsForDate, normalizeDateInput } = require('./services/calendarService');
const {
  testConnection,
  installPiScript,
  stopRenderer,
  pushPayload
} = require('./services/piClient');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || '';
const BASIC_AUTH_PASS = process.env.BASIC_AUTH_PASS || '';

const app = express();

function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function parseBasicAuth(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.startsWith('Basic ')) {
    return null;
  }

  const encoded = headerValue.slice(6).trim();
  let decoded;

  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch (_error) {
    return null;
  }

  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return null;
  }

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1)
  };
}

function requestAuth(res) {
  res.set('WWW-Authenticate', 'Basic realm="Lyda Board Remote"');
  res.status(401).send('Authentication required');
}

if (BASIC_AUTH_USER && BASIC_AUTH_PASS) {
  app.use((req, res, next) => {
    const credentials = parseBasicAuth(req.headers.authorization);
    if (!credentials) {
      requestAuth(res);
      return;
    }

    const userOk = timingSafeEquals(credentials.username, BASIC_AUTH_USER);
    const passOk = timingSafeEquals(credentials.password, BASIC_AUTH_PASS);

    if (!userOk || !passOk) {
      requestAuth(res);
      return;
    }

    next();
  });
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) {
    return override;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isObject(value) && isObject(base[key])) {
      merged[key] = deepMerge(base[key], value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get(
  '/api/state',
  asyncHandler(async (_req, res) => {
    const state = await getState();
    res.json(state);
  })
);

app.put(
  '/api/state',
  asyncHandler(async (req, res) => {
    const current = await getState();
    const merged = normalizeState(deepMerge(current, req.body || {}));
    const saved = await saveState(merged);
    res.json(saved);
  })
);

app.post(
  '/api/weather',
  asyncHandler(async (req, res) => {
    const weather = await getCurrentWeather({
      city: req.body?.city,
      unit: req.body?.unit
    });

    res.json(weather);
  })
);

app.get(
  '/api/calendar/day',
  asyncHandler(async (req, res) => {
    const date = normalizeDateInput(req.query?.date);
    const requestedFile = String(req.query?.file || 'schedule.2026WI.ics').trim() || 'schedule.2026WI.ics';
    const filePath = path.isAbsolute(requestedFile)
      ? requestedFile
      : path.join(__dirname, requestedFile);

    const calendar = await loadIcsEventsForDate(filePath, date);
    res.json({
      ok: true,
      date: calendar.date,
      events: calendar.events,
      totalEventsInFile: calendar.totalEventsInFile,
      file: requestedFile
    });
  })
);

app.post(
  '/api/pi/test',
  asyncHandler(async (req, res) => {
    const state = await getState();
    const piConfig = req.body?.pi || state.pi;
    const result = await testConnection(piConfig);
    res.json({
      ok: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr
    });
  })
);

app.post(
  '/api/pi/install',
  asyncHandler(async (req, res) => {
    const state = await getState();
    const piConfig = req.body?.pi || state.pi;
    const localScriptPath = path.join(__dirname, 'pi', 'remote_display.py');

    const result = await installPiScript(piConfig, localScriptPath);
    res.json({
      ok: true,
      ...result
    });
  })
);

app.post(
  '/api/board/stop',
  asyncHandler(async (req, res) => {
    const state = await getState();
    const piConfig = req.body?.pi || state.pi;
    const result = await stopRenderer(piConfig);

    res.json({
      ok: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr
    });
  })
);

app.post(
  '/api/board/push',
  asyncHandler(async (req, res) => {
    const current = await getState();

    const candidateState = req.body?.state
      ? normalizeState(deepMerge(current, req.body.state))
      : current;

    const mode = req.body?.mode || candidateState.board.mode;
    candidateState.board.mode = mode;

    const payload = await buildPayload(candidateState, mode, getCurrentWeather);
    const result = await pushPayload(candidateState.pi, payload);

    if (!result.started) {
      const detail = [result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n')
        .replace(/__STATUS__:(started|failed)/g, '')
        .trim();

      throw new Error(
        `Pi renderer failed to start (status: ${result.status}). ${detail || 'No diagnostic output returned from Pi.'}`
      );
    }

    await saveState(candidateState);

    res.json({
      ok: true,
      mode,
      payload,
      stdout: result.stdout,
      stderr: result.stderr
    });
  })
);

app.use((error, _req, res, _next) => {
  const message = error?.message || 'Unknown server error';
  console.error(error);
  res.status(500).json({
    ok: false,
    error: message
  });
});

app.listen(PORT, HOST, () => {
  console.log(`LED board control app listening on http://${HOST}:${PORT}`);
});
