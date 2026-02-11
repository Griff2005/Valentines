'use strict';

const fs = require('fs/promises');
const path = require('path');
const { defaultState, createBlankPixels } = require('../data/defaultState');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');

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

function sanitizePixels(pixels, width, height) {
  const expectedLength = width * height;
  if (!Array.isArray(pixels) || pixels.length !== expectedLength) {
    return createBlankPixels();
  }

  return pixels.map((pixel) => {
    if (typeof pixel !== 'string') {
      return '#000000';
    }

    const normalized = pixel.trim();
    const isHex = /^#[0-9A-Fa-f]{6}$/.test(normalized);
    return isHex ? normalized.toLowerCase() : '#000000';
  });
}

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sanitizeDate(value, fallback = getTodayDateString()) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function sanitizeTime(value) {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : '';
}

function sanitizeCalendarEvents(events) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events
    .map((event) => ({
      date: sanitizeDate(event?.date, ''),
      time: sanitizeTime(event?.time),
      title: String(event?.title || '').trim().slice(0, 80),
      location: String(event?.location || '').trim().slice(0, 80),
      source: String(event?.source || 'manual').trim().slice(0, 24) || 'manual'
    }))
    .filter((event) => event.date && event.title);
}

function sanitizeTodoItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      text: String(item?.text || '').trim().slice(0, 80)
    }))
    .filter((item) => item.text);
}

function sanitizeNoteCatalog(noteWidget) {
  const directCatalog = Array.isArray(noteWidget.catalog) ? noteWidget.catalog : [];
  const migratedText = typeof noteWidget.text === 'string' ? [noteWidget.text] : [];

  const merged = [...directCatalog, ...migratedText];

  const normalized = merged
    .map((value) => String(value || '').trim().slice(0, 80))
    .filter(Boolean);

  const deduped = Array.from(new Set(normalized));
  return deduped.length ? deduped : ['Love you forever'];
}

function normalizeState(inputState) {
  const merged = deepMerge(defaultState, inputState || {});
  merged.board.width = 64;
  merged.board.height = 32;

  merged.board.pixels.data = sanitizePixels(
    merged.board.pixels.data,
    merged.board.width,
    merged.board.height
  );

  const weather = merged.board.widgets.weather;
  weather.city = String(weather.city || '').trim();
  weather.unit = String(weather.unit || 'F').toUpperCase() === 'C' ? 'C' : 'F';
  weather.temp = String(weather.temp ?? '').trim().slice(0, 6) || '--';
  weather.summary = String(weather.summary || '').trim().slice(0, 40);
  weather.icon = String(weather.icon || 'sun').trim().slice(0, 16) || 'sun';

  const calendar = merged.board.widgets.calendar;
  calendar.selectedDate = sanitizeDate(calendar.selectedDate);
  calendar.events = sanitizeCalendarEvents(calendar.events);

  const todo = merged.board.widgets.todo;
  const allowedBullets = new Set(['dot', 'heart', 'star', 'diamond']);
  const bulletStyle = String(todo.bulletStyle || '').trim().toLowerCase();
  todo.bulletStyle = allowedBullets.has(bulletStyle) ? bulletStyle : 'dot';
  todo.items = sanitizeTodoItems(todo.items);

  const note = merged.board.widgets.note;
  note.catalog = sanitizeNoteCatalog(note);
  delete note.text;

  const valentine = merged.board.valentine || {};
  merged.board.valentine = {
    question: String(valentine.question || '').trim().slice(0, 80) || 'Will you be my Valentine?',
    fireworks: Boolean(valentine.fireworks)
  };

  return merged;
}

async function ensureStateFile() {
  try {
    await fs.access(STATE_FILE);
  } catch (error) {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify({}, null, 2));
  }
}

async function getState() {
  await ensureStateFile();

  const raw = await fs.readFile(STATE_FILE, 'utf8');
  let parsed;

  try {
    parsed = raw.trim().length ? JSON.parse(raw) : {};
  } catch (error) {
    parsed = {};
  }

  const normalized = normalizeState(parsed);
  await saveState(normalized);
  return normalized;
}

async function saveState(nextState) {
  const normalized = normalizeState(nextState);
  await fs.writeFile(STATE_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}

module.exports = {
  getState,
  saveState,
  normalizeState
};
