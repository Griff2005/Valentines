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

function normalizeState(inputState) {
  const merged = deepMerge(defaultState, inputState || {});
  merged.board.width = 64;
  merged.board.height = 32;

  merged.board.pixels.data = sanitizePixels(
    merged.board.pixels.data,
    merged.board.width,
    merged.board.height
  );

  if (!Array.isArray(merged.board.widgets.calendar.events)) {
    merged.board.widgets.calendar.events = [];
  }

  if (!Array.isArray(merged.board.widgets.todo.items)) {
    merged.board.widgets.todo.items = [];
  }

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
