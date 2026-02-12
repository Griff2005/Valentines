'use strict';

const BOARD_WIDTH = 64;
const BOARD_HEIGHT = 32;
const PIXEL_SCALE = 10;

const ids = {
  statusPill: document.getElementById('status-pill'),
  statusText: document.getElementById('status-text'),
  saveAll: document.getElementById('save-all'),
  stopBoard: document.getElementById('stop-board'),
  pushActive: document.getElementById('push-active'),

  piHost: document.getElementById('pi-host'),
  piPort: document.getElementById('pi-port'),
  piUser: document.getElementById('pi-user'),
  piPass: document.getElementById('pi-pass'),
  piScriptPath: document.getElementById('pi-script-path'),
  piPython: document.getElementById('pi-python'),
  piSudo: document.getElementById('pi-sudo'),
  testConnection: document.getElementById('test-connection'),
  installScript: document.getElementById('install-script'),

  brightness: document.getElementById('brightness'),
  brightnessValue: document.getElementById('brightness-value'),

  weatherEnabled: document.getElementById('weather-enabled'),
  weatherCity: document.getElementById('weather-city'),
  weatherUnit: document.getElementById('weather-unit'),
  refreshWeather: document.getElementById('refresh-weather'),
  weatherPreview: document.getElementById('weather-preview'),

  calendarEnabled: document.getElementById('calendar-enabled'),
  calendarDay: document.getElementById('calendar-day'),
  calendarJumpToday: document.getElementById('calendar-jump-today'),
  calendarJumpNext: document.getElementById('calendar-jump-next'),
  calendarJumpWeek: document.getElementById('calendar-jump-week'),
  calendarEvents: document.getElementById('calendar-events'),
  addEvent: document.getElementById('add-event'),
  calendarImportStatus: document.getElementById('calendar-import-status'),

  todoEnabled: document.getElementById('todo-enabled'),
  todoBulletStyle: document.getElementById('todo-bullet-style'),
  todoItems: document.getElementById('todo-items'),
  addTodo: document.getElementById('add-todo'),

  messageText: document.getElementById('message-text'),
  messageColor: document.getElementById('message-color'),
  messageEffect: document.getElementById('message-effect'),
  messageSpeed: document.getElementById('message-speed'),
  messageSpeedValue: document.getElementById('message-speed-value'),

  animationPreset: document.getElementById('animation-preset'),
  animationSpeed: document.getElementById('animation-speed'),
  animationSpeedValue: document.getElementById('animation-speed-value'),

  valentineQuestion: document.getElementById('valentine-question'),
  valentineFireworks: document.getElementById('valentine-fireworks'),
  valentineStopFireworks: document.getElementById('valentine-stop-fireworks'),

  pixelColor: document.getElementById('pixel-color'),
  pixelErase: document.getElementById('pixel-erase'),
  pixelClear: document.getElementById('pixel-clear'),
  pixelFill: document.getElementById('pixel-fill'),
  pixelCanvas: document.getElementById('pixel-canvas'),

  previewCanvas: document.getElementById('preview-canvas'),

  calendarTemplate: document.getElementById('calendar-event-template'),
  todoTemplate: document.getElementById('todo-item-template')
};

const previewCtx = ids.previewCanvas.getContext('2d');
const pixelCtx = ids.pixelCanvas.getContext('2d');

let appState = null;
let activeTab = 'widgets';
let isDrawing = false;
let eraserActive = false;
let valentinePreviewPhase = 0;
let previewTickerStarted = false;
let weatherAutoTimer = null;

function setStatus(type, text) {
  ids.statusPill.className = 'status-pill';
  if (type === 'success') {
    ids.statusPill.classList.add('success');
    ids.statusPill.textContent = 'Ready';
  } else if (type === 'error') {
    ids.statusPill.classList.add('error');
    ids.statusPill.textContent = 'Error';
  } else {
    ids.statusPill.textContent = 'Working';
  }
  ids.statusText.textContent = text;
}

async function api(url, options) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  return payload;
}

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shortDateString(value = new Date()) {
  const month = value.toLocaleString('en-US', { month: 'short' });
  return `${month} ${value.getDate()}`;
}

function nowClockString() {
  const now = new Date();
  const hours = String(now.getHours());
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} ${shortDateString(now)}`;
}

function createEmptyPixels() {
  return Array.from({ length: BOARD_WIDTH * BOARD_HEIGHT }, () => '#000000');
}

function ensurePixels() {
  if (!Array.isArray(appState.board.pixels.data) || appState.board.pixels.data.length !== BOARD_WIDTH * BOARD_HEIGHT) {
    appState.board.pixels.data = createEmptyPixels();
  }
}

function ensureValentineState() {
  if (!appState.board.valentine || typeof appState.board.valentine !== 'object') {
    appState.board.valentine = {
      question: 'Will you be my Valentine?',
      fireworks: false
    };
    return;
  }

  appState.board.valentine.question =
    String(appState.board.valentine.question || '').trim().slice(0, 80) || 'Will you be my Valentine?';
  appState.board.valentine.fireworks = Boolean(appState.board.valentine.fireworks);
}

function safeDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function safeTime(value) {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : '';
}

function bulletPreviewSymbol(style) {
  if (style === 'heart') {
    return '♥';
  }
  if (style === 'star') {
    return '★';
  }
  if (style === 'diamond') {
    return '◆';
  }
  return '•';
}

function weatherIconSymbol(icon) {
  const name = String(icon || '').toLowerCase();
  if (name === 'sun') {
    return '☀';
  }
  if (name === 'moon') {
    return '☾';
  }
  if (name === 'cloud') {
    return '☁';
  }
  if (name === 'rain') {
    return '☔';
  }
  if (name === 'snow') {
    return '❄';
  }
  if (name === 'fog') {
    return '〰';
  }
  if (name === 'storm') {
    return '⚡';
  }
  return '';
}

function sortCalendarEvents(events) {
  return [...events].sort((a, b) => {
    const left = `${a.date || ''}T${a.time || '00:00'}`;
    const right = `${b.date || ''}T${b.time || '00:00'}`;
    return left.localeCompare(right);
  });
}

function splitCourseParts(value, programMaxLength = 4, numberMaxLength = 4) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) {
    return { program: '', number: '' };
  }

  const structured = text.match(/([A-Z]{2,})\s*([0-9]{2,}[A-Z]?)/);
  if (structured) {
    return {
      program: structured[1].slice(0, programMaxLength),
      number: structured[2].slice(0, numberMaxLength)
    };
  }

  const compact = text.replace(/[^A-Z0-9]/g, '');
  const letterMatch = compact.match(/^[A-Z]+/);
  const numberMatch = compact.match(/[0-9][0-9A-Z]*$/);
  const program = (letterMatch ? letterMatch[0] : compact).slice(0, programMaxLength);
  const number = (numberMatch ? numberMatch[0] : '').slice(0, numberMaxLength);
  return { program, number };
}

function nextUpcomingEvent(events, now = new Date()) {
  let best = null;

  for (const event of Array.isArray(events) ? events : []) {
    const date = safeDate(event.date);
    const time = safeTime(event.time) || '00:00';
    if (!date) {
      continue;
    }

    const when = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(when.getTime())) {
      continue;
    }

    if (when.getTime() < now.getTime()) {
      continue;
    }

    if (!best || when.getTime() < best.when.getTime()) {
      best = {
        when,
        time,
        title: String(event.title || '').trim()
      };
    }
  }

  return best;
}

function normalizeCalendarEventForMerge(event, fallbackSource = 'manual') {
  const date = safeDate(event?.date);
  const time = safeTime(event?.time) || '00:00';
  const title = String(event?.title || '').trim();
  if (!date || !title) {
    return null;
  }

  return {
    date,
    time,
    title,
    source: String(event?.source || fallbackSource).trim() || fallbackSource
  };
}

function calendarSlotKey(event) {
  return `${event.date}|${event.time || '00:00'}`;
}

function mergeCalendarEvents(existingEvents, incomingEvents) {
  const merged = [];
  const seenSlots = new Set();
  let added = 0;

  for (const rawEvent of Array.isArray(existingEvents) ? existingEvents : []) {
    const event = normalizeCalendarEventForMerge(rawEvent, 'manual');
    if (!event) {
      continue;
    }
    const key = calendarSlotKey(event);
    if (seenSlots.has(key)) {
      continue;
    }
    seenSlots.add(key);
    merged.push(event);
  }

  for (const rawEvent of Array.isArray(incomingEvents) ? incomingEvents : []) {
    const event = normalizeCalendarEventForMerge(rawEvent, 'csv');
    if (!event) {
      continue;
    }
    const key = calendarSlotKey(event);
    if (seenSlots.has(key)) {
      continue;
    }
    seenSlots.add(key);
    merged.push(event);
    added += 1;
  }

  return {
    events: sortCalendarEvents(merged),
    added
  };
}

function eventsForCalendarDay(events, date) {
  const selectedDay = safeDate(date) || todayDateString();
  return sortCalendarEvents(
    (Array.isArray(events) ? events : []).filter((event) => safeDate(event?.date) === selectedDay)
  );
}

function mergeCalendarStateWithVisibleDay(allEvents, visibleDayEvents, selectedDay) {
  const day = safeDate(selectedDay) || todayDateString();
  const mergedBySlot = new Map();

  for (const rawEvent of Array.isArray(allEvents) ? allEvents : []) {
    const event = normalizeCalendarEventForMerge(rawEvent, 'manual');
    if (!event || event.date === day) {
      continue;
    }
    mergedBySlot.set(calendarSlotKey(event), event);
  }

  for (const rawEvent of Array.isArray(visibleDayEvents) ? visibleDayEvents : []) {
    const event = normalizeCalendarEventForMerge(rawEvent, 'manual');
    if (!event) {
      continue;
    }
    mergedBySlot.set(calendarSlotKey(event), event);
  }

  return sortCalendarEvents(Array.from(mergedBySlot.values()));
}

function renderCalendarEventsForSelectedDay() {
  const selectedDay = safeDate(ids.calendarDay.value) || todayDateString();
  const allEvents = Array.isArray(appState?.board?.widgets?.calendar?.events)
    ? appState.board.widgets.calendar.events
    : [];
  renderCalendarEvents(eventsForCalendarDay(allEvents, selectedDay));
}

function renderCalendarEvents(events) {
  ids.calendarEvents.innerHTML = '';

  for (const event of sortCalendarEvents(events)) {
    const row = ids.calendarTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.source = event.source || 'manual';

    row.querySelector('[data-role="date"]').value = safeDate(event.date);
    row.querySelector('[data-role="time"]').value = safeTime(event.time);
    row.querySelector('[data-role="title"]').value = event.title || '';

    row.querySelector('[data-role="remove"]').addEventListener('click', () => {
      row.remove();
      syncStateFromForm();
      drawPreview();
    });

    row.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        syncStateFromForm();
        drawPreview();
      });
    });

    ids.calendarEvents.appendChild(row);
  }
}

function renderTodoItems(items) {
  ids.todoItems.innerHTML = '';

  for (const item of items) {
    const row = ids.todoTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector('[data-role="text"]').value = item.text || '';

    row.querySelector('[data-role="remove"]').addEventListener('click', () => {
      row.remove();
      syncStateFromForm();
      drawPreview();
    });

    row.querySelector('[data-role="text"]').addEventListener('input', () => {
      syncStateFromForm();
      drawPreview();
    });

    ids.todoItems.appendChild(row);
  }
}

function collectCalendarEvents(selectedDay = safeDate(ids.calendarDay.value) || todayDateString()) {
  const rows = Array.from(ids.calendarEvents.querySelectorAll('.calendar-item'));
  return rows
    .map((row) => ({
      date: safeDate(row.querySelector('[data-role="date"]').value) || selectedDay,
      time: safeTime(row.querySelector('[data-role="time"]').value) || '00:00',
      title: row.querySelector('[data-role="title"]').value.trim(),
      source: row.dataset.source || 'manual'
    }))
    .filter((event) => event.date && event.title);
}

function collectTodoItems() {
  const rows = Array.from(ids.todoItems.querySelectorAll('.todo-item'));
  return rows
    .map((row) => ({
      text: row.querySelector('[data-role="text"]').value.trim()
    }))
    .filter((item) => item.text);
}

function populateFormFromState() {
  ensureValentineState();

  ids.piHost.value = appState.pi.host || '';
  ids.piPort.value = String(appState.pi.port || 22);
  ids.piUser.value = appState.pi.username || '';
  ids.piPass.value = appState.pi.password || '';
  ids.piScriptPath.value = appState.pi.remoteScriptPath || '';
  ids.piPython.value = appState.pi.pythonCommand || 'python3';
  ids.piSudo.checked = Boolean(appState.pi.useSudo);

  ids.brightness.value = String(appState.board.brightness || 70);
  ids.brightnessValue.textContent = ids.brightness.value;

  const widgets = appState.board.widgets;
  ids.weatherEnabled.checked = Boolean(widgets.weather.enabled);
  ids.weatherCity.value = widgets.weather.city || '';
  ids.weatherUnit.value = widgets.weather.unit || 'C';
  const tempLabel = widgets.weather.temp ? `${widgets.weather.temp}${widgets.weather.unit || ''}` : '';
  const iconLabel = weatherIconSymbol(widgets.weather.icon);
  ids.weatherPreview.textContent = tempLabel ? `${tempLabel} ${iconLabel}`.trim() : '';

  ids.calendarEnabled.checked = Boolean(widgets.calendar.enabled);
  ids.calendarDay.value = safeDate(widgets.calendar.selectedDate) || todayDateString();
  renderCalendarEventsForSelectedDay();

  ids.todoEnabled.checked = Boolean(widgets.todo.enabled);
  ids.todoBulletStyle.value = widgets.todo.bulletStyle || 'dot';
  renderTodoItems(widgets.todo.items || []);

  ids.messageText.value = appState.board.message.text || '';
  ids.messageColor.value = appState.board.message.color || '#ff3b30';
  ids.messageEffect.value = appState.board.message.effect || 'scroll';
  ids.messageSpeed.value = String(appState.board.message.speed || 35);
  ids.messageSpeedValue.textContent = ids.messageSpeed.value;

  ids.animationPreset.value = appState.board.animation.preset || 'rainbowWave';
  ids.animationSpeed.value = String(appState.board.animation.speed || 35);
  ids.animationSpeedValue.textContent = ids.animationSpeed.value;

  ids.valentineQuestion.value = appState.board.valentine?.question || 'Will you be my Valentine?';

  ensurePixels();
  drawPixelCanvas();
}

function syncStateFromForm() {
  if (!appState) {
    return;
  }

  ensureValentineState();

  appState.pi.host = ids.piHost.value.trim();
  appState.pi.port = Number(ids.piPort.value) || 22;
  appState.pi.username = ids.piUser.value.trim();
  appState.pi.password = ids.piPass.value;
  appState.pi.remoteScriptPath = ids.piScriptPath.value.trim();
  appState.pi.pythonCommand = ids.piPython.value.trim() || 'python3';
  appState.pi.useSudo = ids.piSudo.checked;

  appState.board.brightness = Number(ids.brightness.value) || 70;

  appState.board.widgets.weather.enabled = ids.weatherEnabled.checked;
  appState.board.widgets.weather.city = ids.weatherCity.value.trim();
  appState.board.widgets.weather.unit = ids.weatherUnit.value;

  appState.board.widgets.calendar.enabled = ids.calendarEnabled.checked;
  const selectedCalendarDay = safeDate(ids.calendarDay.value) || todayDateString();
  appState.board.widgets.calendar.selectedDate = selectedCalendarDay;
  appState.board.widgets.calendar.events = mergeCalendarStateWithVisibleDay(
    appState.board.widgets.calendar.events,
    collectCalendarEvents(selectedCalendarDay),
    selectedCalendarDay
  );

  appState.board.widgets.todo.enabled = ids.todoEnabled.checked;
  appState.board.widgets.todo.bulletStyle = ids.todoBulletStyle.value;
  appState.board.widgets.todo.items = collectTodoItems();

  appState.board.message.text = ids.messageText.value;
  appState.board.message.color = ids.messageColor.value;
  appState.board.message.effect = ids.messageEffect.value;
  appState.board.message.speed = Number(ids.messageSpeed.value) || 35;

  appState.board.animation.preset = ids.animationPreset.value;
  appState.board.animation.speed = Number(ids.animationSpeed.value) || 35;

  appState.board.valentine.question =
    ids.valentineQuestion.value.trim().slice(0, 80) || 'Will you be my Valentine?';

  ids.brightnessValue.textContent = String(appState.board.brightness);
  ids.messageSpeedValue.textContent = String(appState.board.message.speed);
  ids.animationSpeedValue.textContent = String(appState.board.animation.speed);
}

function colorFromInput() {
  return eraserActive ? '#000000' : ids.pixelColor.value;
}

function cellFromEvent(event) {
  const rect = ids.pixelCanvas.getBoundingClientRect();
  const scaleX = ids.pixelCanvas.width / rect.width;
  const scaleY = ids.pixelCanvas.height / rect.height;
  const x = Math.floor(((event.clientX - rect.left) * scaleX) / PIXEL_SCALE);
  const y = Math.floor(((event.clientY - rect.top) * scaleY) / PIXEL_SCALE);
  if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) {
    return null;
  }
  return { x, y };
}

function paintCell(x, y, color) {
  ensurePixels();
  const index = y * BOARD_WIDTH + x;
  appState.board.pixels.data[index] = color;
  drawPixelCanvas();
  drawPreview();
}

function drawPixelCanvas() {
  ensurePixels();
  pixelCtx.clearRect(0, 0, ids.pixelCanvas.width, ids.pixelCanvas.height);

  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      const index = y * BOARD_WIDTH + x;
      pixelCtx.fillStyle = appState.board.pixels.data[index] || '#000000';
      pixelCtx.fillRect(x * PIXEL_SCALE, y * PIXEL_SCALE, PIXEL_SCALE, PIXEL_SCALE);
    }
  }

  pixelCtx.strokeStyle = 'rgba(255,255,255,0.08)';
  pixelCtx.lineWidth = 1;
  for (let x = 0; x <= BOARD_WIDTH; x += 1) {
    pixelCtx.beginPath();
    pixelCtx.moveTo(x * PIXEL_SCALE + 0.5, 0);
    pixelCtx.lineTo(x * PIXEL_SCALE + 0.5, BOARD_HEIGHT * PIXEL_SCALE);
    pixelCtx.stroke();
  }
  for (let y = 0; y <= BOARD_HEIGHT; y += 1) {
    pixelCtx.beginPath();
    pixelCtx.moveTo(0, y * PIXEL_SCALE + 0.5);
    pixelCtx.lineTo(BOARD_WIDTH * PIXEL_SCALE, y * PIXEL_SCALE + 0.5);
    pixelCtx.stroke();
  }
}

function drawWidgetPreview(width, height) {
  const widgets = appState.board.widgets;
  const now = new Date();
  const weatherTemp = widgets.weather.temp ? `${widgets.weather.temp}${widgets.weather.unit || ''}`.trim() : '--';
  const isNight = now.getHours() < 6 || now.getHours() >= 18;
  const iconName =
    isNight && String(widgets.weather.icon || '').toLowerCase() === 'sun'
      ? 'moon'
      : widgets.weather.icon;
  const weatherIcon = weatherIconSymbol(iconName);
  const weatherText = widgets.weather.enabled ? `${weatherTemp} ${weatherIcon}`.trim() : 'OFF';
  const nextEvent = widgets.calendar.enabled ? nextUpcomingEvent(widgets.calendar.events || [], now) : null;
  const dividerX = Math.round(width * 0.74);

  previewCtx.strokeStyle = 'rgba(255,255,255,0.18)';
  previewCtx.lineWidth = 2;
  previewCtx.strokeRect(0, 0, width, height);
  previewCtx.beginPath();
  previewCtx.moveTo(0, height * 0.25);
  previewCtx.lineTo(width, height * 0.25);
  previewCtx.moveTo(dividerX, height * 0.25);
  previewCtx.lineTo(dividerX, height);
  previewCtx.stroke();

  previewCtx.fillStyle = '#ffe082';
  previewCtx.font = '700 24px Space Grotesk';
  previewCtx.textAlign = 'left';
  previewCtx.fillText(nowClockString(), 14, 44);
  previewCtx.fillStyle = '#8ed7ff';
  previewCtx.textAlign = 'right';
  previewCtx.fillText(weatherText.slice(0, 10), width - 14, 44);

  previewCtx.fillStyle = '#ffe082';
  previewCtx.font = '500 18px Space Grotesk';
  previewCtx.textAlign = 'left';
  previewCtx.fillStyle = '#f4f4f4';

  const bulletSymbol = bulletPreviewSymbol(widgets.todo.bulletStyle || 'dot');
  const todoLines = (widgets.todo.items || []).slice(0, 4);
  todoLines.forEach((item, index) => {
    previewCtx.fillText(`${bulletSymbol} ${item.text}`.slice(0, 28), 14, height * 0.38 + index * 24);
  });

  previewCtx.font = '700 18px Space Grotesk';
  previewCtx.fillStyle = '#f4f4f4';
  previewCtx.font = '700 20px Space Grotesk';
  if (!widgets.calendar.enabled) {
    previewCtx.fillText('OFF', dividerX + 12, height * 0.54);
    return;
  }

  if (!nextEvent) {
    previewCtx.fillText('FREE', dividerX + 12, height * 0.54);
    return;
  }

  const parts = splitCourseParts(nextEvent.title, 4, 4);
  previewCtx.fillText(nextEvent.time, dividerX + 12, height * 0.4);
  previewCtx.fillText(parts.program || 'CLASS', dividerX + 12, height * 0.55);
  previewCtx.fillText(parts.number || '----', dividerX + 12, height * 0.7);
}

function drawPreviewLedCell(x, y, sx, sy, color) {
  previewCtx.fillStyle = color;
  previewCtx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx), Math.ceil(sy));
}

function drawPreviewFlower(sx, sy, originX, originY) {
  const petals = [
    [0, -2],
    [-2, 0],
    [0, 0],
    [2, 0],
    [0, 2]
  ];

  for (const [px, py] of petals) {
    drawPreviewLedCell(originX + px, originY + py, sx, sy, '#ff6fb5');
  }
  drawPreviewLedCell(originX, originY, sx, sy, '#ffd3eb');

  for (let step = 1; step <= 4; step += 1) {
    drawPreviewLedCell(originX, originY + 2 + step, sx, sy, '#4cc26e');
  }

  drawPreviewLedCell(originX - 1, originY + 4, sx, sy, '#67d985');
  drawPreviewLedCell(originX + 1, originY + 5, sx, sy, '#67d985');
}

function drawPreviewFirework(sx, sy, originX, originY, color, radius, fade) {
  const steps = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4];
  const alpha = Math.max(0.25, Math.min(1, fade));
  const mainColor = color.replace(')', `, ${alpha})`).replace('rgb', 'rgba');

  for (const angle of steps) {
    const px = Math.round(originX + Math.cos(angle) * radius);
    const py = Math.round(originY + Math.sin(angle) * radius);
    drawPreviewLedCell(px, py, sx, sy, mainColor);
  }

  if (radius < 2.2) {
    drawPreviewLedCell(originX, originY, sx, sy, 'rgba(255, 245, 252, 0.95)');
  }
}

function drawValentinePreview(width, height, sx, sy) {
  const valentine = appState.board.valentine || {};
  const question = (valentine.question || 'Will you be my Valentine?').slice(0, 34);

  previewCtx.fillStyle = '#000000';
  previewCtx.fillRect(0, 0, width, height);

  previewCtx.fillStyle = '#ff3b30';
  previewCtx.font = '700 34px Space Grotesk';
  previewCtx.textAlign = 'center';
  previewCtx.textBaseline = 'middle';
  previewCtx.fillText(question, width / 2, height * 0.28);

  const flowerPositions = [
    [5, 23],
    [10, 25],
    [15, 23],
    [20, 25],
    [25, 23],
    [39, 23],
    [44, 25],
    [49, 23],
    [54, 25],
    [59, 23]
  ];
  for (const [fx, fy] of flowerPositions) {
    drawPreviewFlower(sx, sy, fx, fy);
  }

  if (valentine.fireworks) {
    const localPhase = valentinePreviewPhase % 24;
    const radiusA = 0.9 + (localPhase % 8) * 0.55;
    const radiusB = 1.1 + ((localPhase + 3) % 8) * 0.55;
    const radiusC = 0.8 + ((localPhase + 6) % 8) * 0.55;

    drawPreviewFirework(sx, sy, 12, 8, 'rgb(255, 142, 206)', radiusA, 1 - radiusA / 6);
    drawPreviewFirework(sx, sy, 32, 6, 'rgb(255, 196, 106)', radiusB, 1 - radiusB / 6);
    drawPreviewFirework(sx, sy, 52, 9, 'rgb(143, 228, 255)', radiusC, 1 - radiusC / 6);
  }
}

function drawPreview() {
  if (!appState) {
    return;
  }

  syncStateFromForm();

  const w = ids.previewCanvas.width;
  const h = ids.previewCanvas.height;
  const sx = w / BOARD_WIDTH;
  const sy = h / BOARD_HEIGHT;

  previewCtx.fillStyle = '#000';
  previewCtx.fillRect(0, 0, w, h);

  if (activeTab === 'pixels') {
    ensurePixels();
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const idx = y * BOARD_WIDTH + x;
        previewCtx.fillStyle = appState.board.pixels.data[idx] || '#000000';
        previewCtx.fillRect(x * sx, y * sy, sx, sy);
      }
    }
    return;
  }

  if (activeTab === 'animation') {
    const grad = previewCtx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#ff5a3d');
    grad.addColorStop(0.45, '#0c8f8f');
    grad.addColorStop(1, '#ffd166');
    previewCtx.fillStyle = grad;
    previewCtx.fillRect(0, 0, w, h);

    previewCtx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    previewCtx.font = '700 34px Space Grotesk';
    previewCtx.textAlign = 'center';
    previewCtx.fillText(appState.board.animation.preset, w / 2, h / 2);
    return;
  }

  if (activeTab === 'message') {
    previewCtx.fillStyle = appState.board.message.color || '#ff3b30';
    previewCtx.font = '700 46px Space Grotesk';
    previewCtx.textAlign = 'center';
    previewCtx.textBaseline = 'middle';
    const text = (appState.board.message.text || 'Message').slice(0, 40);
    previewCtx.fillText(text, w / 2, h / 2);
    return;
  }

  if (activeTab === 'valentine') {
    drawValentinePreview(w, h, sx, sy);
    return;
  }

  drawWidgetPreview(w, h);
}

function setActiveTab(tabName) {
  activeTab = tabName;

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `tab-${tabName}`);
  });

  drawPreview();
}

async function saveAll() {
  syncStateFromForm();
  setStatus('working', 'Saving settings...');
  const saved = await api('/api/state', {
    method: 'PUT',
    body: JSON.stringify(appState)
  });
  appState = saved;
  setStatus('success', 'Settings saved locally.');
}

async function pushMode(mode) {
  syncStateFromForm();
  appState.board.mode = mode;
  setStatus('working', `Sending ${mode} to the LED board...`);

  const result = await api('/api/board/push', {
    method: 'POST',
    body: JSON.stringify({
      mode,
      state: appState
    })
  });

  setStatus('success', `${mode} is now running on the LED board.`);
  return result;
}

async function pushModeSilently(mode) {
  if (!appState) {
    return;
  }

  syncStateFromForm();
  appState.board.mode = mode;

  try {
    await api('/api/board/push', {
      method: 'POST',
      body: JSON.stringify({
        mode,
        state: appState
      })
    });
  } catch (_error) {
    // Silent auto-refresh failures should not interrupt the UI.
  }
}

async function refreshWeatherData({ showStatus = true, saveState = false, pushIfWidgets = false } = {}) {
  if (!appState || !appState.board?.widgets?.weather) {
    return false;
  }

  syncStateFromForm();

  if (!appState.board.widgets.weather.enabled) {
    return false;
  }

  if (showStatus) {
    setStatus('working', 'Fetching weather preview...');
  }

  try {
    const weather = await api('/api/weather', {
      method: 'POST',
      body: JSON.stringify({
        city: appState.board.widgets.weather.city,
        unit: appState.board.widgets.weather.unit
      })
    });

    const summary = `${weather.temp}${weather.unit} ${weatherIconSymbol(weather.icon)}`.trim();
    ids.weatherPreview.textContent = summary;
    appState.board.widgets.weather.summary = weather.summary;
    appState.board.widgets.weather.icon = weather.icon;
    appState.board.widgets.weather.temp = weather.temp;

    if (saveState) {
      const saved = await api('/api/state', {
        method: 'PUT',
        body: JSON.stringify(appState)
      });
      appState = saved;
    }

    drawPreview();

    if (pushIfWidgets && appState.board.mode === 'widgets') {
      await pushModeSilently('widgets');
    }

    if (showStatus) {
      setStatus('success', 'Weather preview updated.');
    }
    return true;
  } catch (error) {
    if (showStatus) {
      setStatus('error', error.message);
    }
    return false;
  }
}

async function autoSyncCalendarFromCsv() {
  const from = todayDateString();
  const existing = Array.isArray(appState?.board?.widgets?.calendar?.events)
    ? appState.board.widgets.calendar.events
    : [];
  const hasSeededFutureCsv = existing.some((event) => (
    safeDate(event?.date) >= from && String(event?.source || '').toLowerCase() === 'csv'
  ));

  if (hasSeededFutureCsv) {
    return 0;
  }

  const payload = await api(`/api/calendar/events?from=${encodeURIComponent(from)}`, {
    method: 'GET'
  });

  const incoming = Array.isArray(payload.events) ? payload.events : [];
  const merged = mergeCalendarEvents(existing, incoming);

  appState.board.widgets.calendar.events = merged.events;

  if (merged.added > 0) {
    const saved = await api('/api/state', {
      method: 'PUT',
      body: JSON.stringify(appState)
    });
    appState = saved;
  }

  return merged.added;
}

function setCalendarDay(value) {
  if (!appState) {
    return;
  }

  const previousDay = safeDate(appState.board.widgets.calendar.selectedDate) || todayDateString();
  const nextDay = safeDate(value) || todayDateString();

  // Persist edits for the day currently rendered in the list before switching views.
  ids.calendarDay.value = previousDay;
  appState.board.widgets.calendar.selectedDate = previousDay;
  syncStateFromForm();

  ids.calendarDay.value = nextDay;
  appState.board.widgets.calendar.selectedDate = nextDay;
  renderCalendarEventsForSelectedDay();
  drawPreview();
}

function shiftCalendarDay(offsetDays) {
  const base = safeDate(ids.calendarDay.value) || todayDateString();
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + offsetDays);
  setCalendarDay(date.toISOString().slice(0, 10));
}

function startPreviewTicker() {
  if (previewTickerStarted) {
    return;
  }

  previewTickerStarted = true;
  setInterval(() => {
    if (!appState) {
      return;
    }

    if (activeTab === 'valentine' && appState.board.valentine?.fireworks) {
      valentinePreviewPhase = (valentinePreviewPhase + 1) % 240;
      drawPreview();
    }
  }, 120);
}

function startWeatherAutoUpdate() {
  if (weatherAutoTimer) {
    return;
  }

  weatherAutoTimer = setInterval(() => {
    refreshWeatherData({ showStatus: false, saveState: true, pushIfWidgets: true });
  }, 30 * 60 * 1000);
}

async function init() {
  setStatus('working', 'Loading saved settings...');
  appState = await api('/api/state');
  let autoLoadedCount = 0;

  try {
    autoLoadedCount = await autoSyncCalendarFromCsv();
  } catch (error) {
    ids.calendarImportStatus.textContent = `Calendar auto-sync failed: ${error.message}`;
  }

  populateFormFromState();
  if (!ids.calendarImportStatus.textContent) {
    ids.calendarImportStatus.textContent = autoLoadedCount > 0
      ? `Auto-loaded ${autoLoadedCount} upcoming event${autoLoadedCount === 1 ? '' : 's'} from schedule.csv.`
      : 'Calendar is up to date from schedule.csv.';
  }
  drawPreview();
  startPreviewTicker();
  startWeatherAutoUpdate();
  refreshWeatherData({ showStatus: false, saveState: true, pushIfWidgets: false });
  setStatus('success', 'Ready. Update controls then click Show Current Tab on Board.');
}

function registerEvents() {
  ids.saveAll.addEventListener('click', async () => {
    try {
      await saveAll();
    } catch (error) {
      setStatus('error', error.message);
    }
  });

  ids.stopBoard.addEventListener('click', async () => {
    try {
      syncStateFromForm();
      setStatus('working', 'Stopping renderer on Pi...');
      await api('/api/board/stop', {
        method: 'POST',
        body: JSON.stringify({ pi: appState.pi })
      });
      setStatus('success', 'Board renderer stopped.');
    } catch (error) {
      setStatus('error', error.message);
    }
  });

  ids.pushActive.addEventListener('click', async () => {
    try {
      await pushMode(activeTab);
    } catch (error) {
      setStatus('error', error.message);
    }
  });

  ids.testConnection.addEventListener('click', async () => {
    try {
      syncStateFromForm();
      setStatus('working', 'Testing Pi SSH connection...');
      await api('/api/pi/test', {
        method: 'POST',
        body: JSON.stringify({ pi: appState.pi })
      });
      setStatus('success', 'Pi connection looks good.');
    } catch (error) {
      setStatus('error', error.message);
    }
  });

  ids.installScript.addEventListener('click', async () => {
    try {
      syncStateFromForm();
      setStatus('working', 'Installing remote renderer on Pi...');
      await api('/api/pi/install', {
        method: 'POST',
        body: JSON.stringify({ pi: appState.pi })
      });
      setStatus('success', 'Pi renderer script installed successfully.');
    } catch (error) {
      setStatus('error', error.message);
    }
  });

  ids.refreshWeather.addEventListener('click', async () => {
    await refreshWeatherData({ showStatus: true, saveState: true, pushIfWidgets: true });
  });

  ids.valentineFireworks.addEventListener('click', async () => {
    ensureValentineState();
    appState.board.valentine.fireworks = true;
    valentinePreviewPhase = 0;
    drawPreview();

    try {
      await pushMode('valentine');
    } catch (error) {
      setStatus('error', error.message);
    }
  });

  ids.valentineStopFireworks.addEventListener('click', async () => {
    ensureValentineState();
    appState.board.valentine.fireworks = false;
    drawPreview();

    try {
      await pushMode('valentine');
    } catch (error) {
      setStatus('error', error.message);
    }
  });

  ids.calendarJumpToday.addEventListener('click', () => {
    setCalendarDay(todayDateString());
  });

  ids.calendarJumpNext.addEventListener('click', () => {
    shiftCalendarDay(1);
  });

  ids.calendarJumpWeek.addEventListener('click', () => {
    shiftCalendarDay(7);
  });

  ids.calendarDay.addEventListener('change', () => {
    setCalendarDay(ids.calendarDay.value);
  });

  ids.addEvent.addEventListener('click', () => {
    const selectedDay = safeDate(ids.calendarDay.value) || todayDateString();
    renderCalendarEvents([
      ...collectCalendarEvents(selectedDay),
      {
        date: selectedDay,
        time: '09:00',
        title: '',
        source: 'manual'
      }
    ]);
    syncStateFromForm();
    drawPreview();
  });

  ids.addTodo.addEventListener('click', () => {
    renderTodoItems([
      ...collectTodoItems(),
      {
        text: ''
      }
    ]);
    syncStateFromForm();
    drawPreview();
  });

  document.querySelectorAll('.tab').forEach((tabButton) => {
    tabButton.addEventListener('click', () => {
      setActiveTab(tabButton.dataset.tab);
    });
  });

  [
    ids.piHost,
    ids.piPort,
    ids.piUser,
    ids.piPass,
    ids.piScriptPath,
    ids.piPython,
    ids.piSudo,
    ids.weatherEnabled,
    ids.weatherCity,
    ids.weatherUnit,
    ids.calendarEnabled,
    ids.todoEnabled,
    ids.todoBulletStyle,
    ids.messageText,
    ids.messageColor,
    ids.messageEffect,
    ids.messageSpeed,
    ids.animationPreset,
    ids.animationSpeed,
    ids.valentineQuestion,
    ids.brightness
  ].forEach((element) => {
    element.addEventListener('input', () => {
      syncStateFromForm();
      drawPreview();
    });
    element.addEventListener('change', () => {
      syncStateFromForm();
      drawPreview();
    });
  });

  ids.pixelErase.addEventListener('click', () => {
    eraserActive = !eraserActive;
    ids.pixelErase.classList.toggle('btn-secondary', eraserActive);
    ids.pixelErase.classList.toggle('btn-ghost', !eraserActive);
    ids.pixelErase.textContent = eraserActive ? 'Eraser On' : 'Eraser';
  });

  ids.pixelClear.addEventListener('click', () => {
    appState.board.pixels.data = createEmptyPixels();
    drawPixelCanvas();
    drawPreview();
  });

  ids.pixelFill.addEventListener('click', () => {
    appState.board.pixels.data = Array.from(
      { length: BOARD_WIDTH * BOARD_HEIGHT },
      () => ids.pixelColor.value
    );
    drawPixelCanvas();
    drawPreview();
  });

  ids.pixelCanvas.addEventListener('pointerdown', (event) => {
    if (!appState) {
      return;
    }

    isDrawing = true;
    const cell = cellFromEvent(event);
    if (cell) {
      paintCell(cell.x, cell.y, colorFromInput());
    }
  });

  ids.pixelCanvas.addEventListener('pointermove', (event) => {
    if (!isDrawing || !appState) {
      return;
    }
    const cell = cellFromEvent(event);
    if (cell) {
      paintCell(cell.x, cell.y, colorFromInput());
    }
  });

  ['pointerup', 'pointerleave', 'pointercancel'].forEach((name) => {
    ids.pixelCanvas.addEventListener(name, () => {
      isDrawing = false;
    });
  });
}

registerEvents();
init().catch((error) => {
  setStatus('error', error.message);
});
