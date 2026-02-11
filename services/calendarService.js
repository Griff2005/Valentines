'use strict';

const fs = require('fs/promises');
const path = require('path');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function normalizeDateInput(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  return getTodayDateString();
}

function eventSortValue(event) {
  const time = event.time || '00:00';
  return `${event.date}T${time}:00`;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsvDate(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const slashParts = text.split('/');
  if (slashParts.length === 3) {
    const [partA, partB, partC] = slashParts.map((part) => part.trim());

    if (/^\d{2}$/.test(partA) && /^\d{2}$/.test(partB) && /^\d{2}$/.test(partC)) {
      return `20${partA}-${partB}-${partC}`;
    }

    if (/^\d{4}$/.test(partA) && /^\d{2}$/.test(partB) && /^\d{2}$/.test(partC)) {
      return `${partA}-${partB}-${partC}`;
    }
  }

  return '';
}

function parseCsvTime(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) {
    return '';
  }

  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return '';
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return '';
  }

  return `${pad2(hour)}:${pad2(minute)}`;
}

function parseCsvEvents(csvText) {
  const lines = String(csvText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const header = parseCsvLine(lines[0]).map((value) => value.toLowerCase());
  const dateIndex = header.indexOf('date');
  const timeIndex = header.indexOf('time');
  const programIndex = header.indexOf('program');
  const numberIndex = header.indexOf('number');
  const titleIndex = header.indexOf('title');

  const events = [];

  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const date = parseCsvDate(columns[dateIndex]);
    const time = parseCsvTime(columns[timeIndex]) || '00:00';
    const program = String(columns[programIndex] || '').trim().toUpperCase();
    const number = String(columns[numberIndex] || '').trim().toUpperCase();
    const inlineTitle = String(columns[titleIndex] || '').trim();
    const title = (program || number)
      ? `${program}${number}`.trim()
      : inlineTitle;

    if (!date || !title) {
      continue;
    }

    events.push({
      date,
      time,
      title,
      source: 'csv'
    });
  }

  return events.sort((a, b) => {
    const left = eventSortValue(a);
    const right = eventSortValue(b);
    return left.localeCompare(right);
  });
}

async function loadCsvEvents(filePath) {
  const resolvedPath = path.resolve(filePath);
  const raw = await fs.readFile(resolvedPath, 'utf8');
  return parseCsvEvents(raw);
}

async function loadCsvEventsForDate(filePath, dateInput) {
  const date = normalizeDateInput(dateInput);
  const events = await loadCsvEvents(filePath);
  return {
    date,
    events: events.filter((event) => event.date === date),
    totalEventsInFile: events.length
  };
}

async function loadCsvEventsFromDate(filePath, dateInput) {
  const date = normalizeDateInput(dateInput);
  const events = await loadCsvEvents(filePath);
  return {
    date,
    events: events.filter((event) => event.date >= date),
    totalEventsInFile: events.length
  };
}

module.exports = {
  loadCsvEvents,
  loadCsvEventsForDate,
  loadCsvEventsFromDate,
  normalizeDateInput
};
