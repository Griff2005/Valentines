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

function decodeIcsText(value) {
  return String(value || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function unfoldLines(rawText) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  const unfolded = [];

  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function formatDateParts(year, month, day) {
  return `${year}-${month}-${day}`;
}

function parseIcsDateTime(rawValue) {
  const value = String(rawValue || '').trim();

  if (/^\d{8}$/.test(value)) {
    return {
      date: formatDateParts(value.slice(0, 4), value.slice(4, 6), value.slice(6, 8)),
      time: '00:00',
      allDay: true
    };
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second, isUtc] = match;

  if (isUtc === 'Z') {
    const utcDate = new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ));

    return {
      date: `${utcDate.getFullYear()}-${pad2(utcDate.getMonth() + 1)}-${pad2(utcDate.getDate())}`,
      time: `${pad2(utcDate.getHours())}:${pad2(utcDate.getMinutes())}`,
      allDay: false
    };
  }

  return {
    date: formatDateParts(year, month, day),
    time: `${hour}:${minute}`,
    allDay: false
  };
}

function eventSortValue(event) {
  const time = event.time || '00:00';
  return `${event.date}T${time}:00`;
}

function parseIcsEvents(icsText) {
  const lines = unfoldLines(icsText);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      if (!current) {
        continue;
      }

      const start = current.DTSTART ? parseIcsDateTime(current.DTSTART.value) : null;
      const end = current.DTEND ? parseIcsDateTime(current.DTEND.value) : null;

      if (start && start.date) {
        events.push({
          uid: decodeIcsText(current.UID?.value || ''),
          date: start.date,
          time: start.time,
          endDate: end?.date || '',
          endTime: end?.time || '',
          allDay: Boolean(start.allDay),
          title: decodeIcsText(current.SUMMARY?.value || 'Untitled'),
          location: decodeIcsText(current.LOCATION?.value || ''),
          source: 'ics'
        });
      }

      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const separator = line.indexOf(':');
    if (separator < 0) {
      continue;
    }

    const rawKey = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const key = rawKey.split(';')[0].toUpperCase();

    if (!current[key]) {
      current[key] = {
        rawKey,
        value
      };
    }
  }

  return events.sort((a, b) => {
    const left = eventSortValue(a);
    const right = eventSortValue(b);
    return left.localeCompare(right);
  });
}

async function loadIcsEvents(filePath) {
  const resolvedPath = path.resolve(filePath);
  const raw = await fs.readFile(resolvedPath, 'utf8');
  return parseIcsEvents(raw);
}

async function loadIcsEventsForDate(filePath, dateInput) {
  const date = normalizeDateInput(dateInput);
  const events = await loadIcsEvents(filePath);
  return {
    date,
    events: events.filter((event) => event.date === date),
    totalEventsInFile: events.length
  };
}

module.exports = {
  loadIcsEvents,
  loadIcsEventsForDate,
  normalizeDateInput
};
