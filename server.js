'use strict';

const crypto = require('crypto');
const express = require('express');
const path = require('path');

const { getState, saveState, normalizeState } = require('./services/stateStore');
const { buildPayload } = require('./services/payloadBuilder');
const { getCurrentWeather } = require('./services/weatherService');
const {
  loadCsvEvents,
  loadCsvEventsForDate,
  loadCsvEventsFromDate,
  normalizeDateInput
} = require('./services/calendarService');
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
const AUTO_CLOCK_DEFAULT_NIGHT_START = '22:00';
const AUTO_CLOCK_DEFAULT_DAY_START = '11:00';
const AUTO_CLOCK_DEFAULT_BRIGHTNESS = 40;

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

function localDateString(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clampBrightness(value, fallback = 70) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(100, Math.max(10, Math.round(number)));
}

function parseTimeToMinutes(value, fallbackMinutes) {
  const text = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(text)) {
    return fallbackMinutes;
  }
  const [hoursText, minutesText] = text.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return fallbackMinutes;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallbackMinutes;
  }
  return hours * 60 + minutes;
}

function isNightWindowMinutes(nowMinutes, nightStartMinutes, dayStartMinutes) {
  if (nightStartMinutes === dayStartMinutes) {
    return true;
  }
  if (nightStartMinutes < dayStartMinutes) {
    return nowMinutes >= nightStartMinutes && nowMinutes < dayStartMinutes;
  }
  return nowMinutes >= nightStartMinutes || nowMinutes < dayStartMinutes;
}

function getNightKey(now, nowMinutes, nightStartMinutes, dayStartMinutes) {
  const crossesMidnight = nightStartMinutes > dayStartMinutes;
  if (crossesMidnight && nowMinutes < dayStartMinutes) {
    const previous = new Date(now);
    previous.setDate(now.getDate() - 1);
    return localDateString(previous);
  }
  return localDateString(now);
}

async function runAutoClockSchedule() {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const today = localDateString(now);

  const state = await getState();
  if (!state?.pi?.host || !state?.pi?.username) {
    return;
  }

  const schedule = state.board.clockSchedule || {};
  if (!schedule.enabled) {
    return;
  }

  const nightStartMinutes = parseTimeToMinutes(
    schedule.nightStart,
    parseTimeToMinutes(AUTO_CLOCK_DEFAULT_NIGHT_START, 22 * 60)
  );
  const dayStartMinutes = parseTimeToMinutes(
    schedule.dayStart,
    parseTimeToMinutes(AUTO_CLOCK_DEFAULT_DAY_START, 11 * 60)
  );
  const clockBrightness = clampBrightness(schedule.brightness, AUTO_CLOCK_DEFAULT_BRIGHTNESS);
  const isNightWindow = isNightWindowMinutes(nowMinutes, nightStartMinutes, dayStartMinutes);
  const nightKey = getNightKey(now, nowMinutes, nightStartMinutes, dayStartMinutes);

  const auto = state.board.autoSchedule || { lastNight: '', lastDay: '' };

  if (isNightWindow) {
    if (auto.lastNight === nightKey) {
      return;
    }

    const dayBrightness = clampBrightness(state.board.dayBrightness || state.board.brightness, 70);
    const nextState = {
      ...state,
      board: {
        ...state.board,
        mode: 'clock',
        brightness: clockBrightness,
        dayBrightness,
        autoSchedule: {
          ...auto,
          lastNight: nightKey
        }
      }
    };

    const payload = await buildPayload(nextState, 'clock', getCurrentWeather);
    const result = await pushPayload(nextState.pi, payload);
    if (!result.started) {
      console.error('Auto clock switch failed:', result.stderr || result.stdout || 'No output');
      return;
    }
    await saveState(nextState);
    console.log(`[auto] Switched to clock mode at ${nightKey}`);
    return;
  }

  if (auto.lastDay === today) {
    return;
  }

  const restoreBrightness = clampBrightness(state.board.dayBrightness || state.board.brightness, 70);
  const nextState = {
    ...state,
    board: {
      ...state.board,
      mode: 'widgets',
      brightness: restoreBrightness,
      autoSchedule: {
        ...auto,
        lastDay: today
      }
    }
  };

  const payload = await buildPayload(nextState, 'widgets', getCurrentWeather);
  const result = await pushPayload(nextState.pi, payload);
  if (!result.started) {
    console.error('Auto widgets switch failed:', result.stderr || result.stdout || 'No output');
    return;
  }
  await saveState(nextState);
  console.log(`[auto] Switched to widgets mode at ${today}`);
}

function startAutoClockSchedule() {
  runAutoClockSchedule().catch((error) => {
    console.error('Auto clock schedule error:', error);
  });
  setInterval(() => {
    runAutoClockSchedule().catch((error) => {
      console.error('Auto clock schedule error:', error);
    });
  }, 30000);
}

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
    const requestedFile = String(req.query?.file || 'schedule.csv').trim() || 'schedule.csv';
    const filePath = path.isAbsolute(requestedFile)
      ? requestedFile
      : path.join(__dirname, requestedFile);

    const calendar = await loadCsvEventsForDate(filePath, date);
    res.json({
      ok: true,
      date: calendar.date,
      events: calendar.events,
      totalEventsInFile: calendar.totalEventsInFile,
      file: requestedFile
    });
  })
);

app.get(
  '/api/calendar/events',
  asyncHandler(async (req, res) => {
    const date = normalizeDateInput(req.query?.from);
    const requestedFile = String(req.query?.file || 'schedule.csv').trim() || 'schedule.csv';
    const includePast = String(req.query?.includePast || '').trim() === '1';
    const filePath = path.isAbsolute(requestedFile)
      ? requestedFile
      : path.join(__dirname, requestedFile);

    const calendar = includePast
      ? {
          date: '1900-01-01',
          events: await loadCsvEvents(filePath)
        }
      : await loadCsvEventsFromDate(filePath, date);

    res.json({
      ok: true,
      from: includePast ? '1900-01-01' : calendar.date,
      events: calendar.events,
      totalEventsInFile: includePast ? calendar.events.length : calendar.totalEventsInFile,
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
  startAutoClockSchedule();
});
