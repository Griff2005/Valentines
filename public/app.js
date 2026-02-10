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
  importIcs: document.getElementById('import-ics'),
  calendarImportStatus: document.getElementById('calendar-import-status'),

  todoEnabled: document.getElementById('todo-enabled'),
  todoBulletStyle: document.getElementById('todo-bullet-style'),
  todoItems: document.getElementById('todo-items'),
  addTodo: document.getElementById('add-todo'),

  noteEnabled: document.getElementById('note-enabled'),
  noteSelect: document.getElementById('note-select'),
  noteText: document.getElementById('note-text'),
  addNote: document.getElementById('add-note'),
  removeNote: document.getElementById('remove-note'),

  messageText: document.getElementById('message-text'),
  messageColor: document.getElementById('message-color'),
  messageEffect: document.getElementById('message-effect'),
  messageSpeed: document.getElementById('message-speed'),
  messageSpeedValue: document.getElementById('message-speed-value'),

  animationPreset: document.getElementById('animation-preset'),
  animationSpeed: document.getElementById('animation-speed'),
  animationSpeedValue: document.getElementById('animation-speed-value'),

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
let noteCatalogCache = [];
let noteSelectionIndex = 0;

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

function safeDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function safeTime(value) {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : '';
}

function getDailyNote(catalog, forDate = new Date()) {
  const notes = (Array.isArray(catalog) ? catalog : [])
    .map((note) => String(note || '').trim())
    .filter(Boolean);

  if (!notes.length) {
    return '';
  }

  const ordinal = Math.floor(forDate.getTime() / 86400000);
  const safeIndex = Math.abs(ordinal) % notes.length;
  return notes[safeIndex];
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

function sortCalendarEvents(events) {
  return [...events].sort((a, b) => {
    const left = `${a.date || ''}T${a.time || '00:00'}`;
    const right = `${b.date || ''}T${b.time || '00:00'}`;
    return left.localeCompare(right);
  });
}

function renderCalendarEvents(events) {
  ids.calendarEvents.innerHTML = '';

  for (const event of sortCalendarEvents(events)) {
    const row = ids.calendarTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.source = event.source || 'manual';

    row.querySelector('[data-role="date"]').value = safeDate(event.date);
    row.querySelector('[data-role="time"]').value = safeTime(event.time);
    row.querySelector('[data-role="title"]').value = event.title || '';
    row.querySelector('[data-role="location"]').value = event.location || '';

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

function cleanNoteText(value) {
  return String(value || '').trim().slice(0, 80);
}

function noteOptionLabel(value) {
  const cleaned = cleanNoteText(value);
  if (!cleaned) {
    return 'Untitled note';
  }
  return cleaned.length > 40 ? `${cleaned.slice(0, 37)}...` : cleaned;
}

function renderNoteSelector(notes) {
  noteCatalogCache = Array.isArray(notes) ? notes.map((note) => cleanNoteText(note)) : [];
  noteCatalogCache = noteCatalogCache.filter((note) => note.length);
  if (!noteCatalogCache.length) {
    noteCatalogCache = ['Love you forever'];
  }

  if (noteSelectionIndex >= noteCatalogCache.length) {
    noteSelectionIndex = 0;
  }

  ids.noteSelect.innerHTML = '';
  noteCatalogCache.forEach((note, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = noteOptionLabel(note);
    ids.noteSelect.appendChild(option);
  });

  ids.noteSelect.value = String(noteSelectionIndex);
  ids.noteText.value = noteCatalogCache[noteSelectionIndex] || '';
}

function updateNoteOption(index, value) {
  const option = ids.noteSelect.options[index];
  if (option) {
    option.textContent = noteOptionLabel(value);
  }
}

function collectCalendarEvents() {
  const rows = Array.from(ids.calendarEvents.querySelectorAll('.calendar-item'));
  return rows
    .map((row) => ({
      date: safeDate(row.querySelector('[data-role="date"]').value),
      time: safeTime(row.querySelector('[data-role="time"]').value) || '00:00',
      title: row.querySelector('[data-role="title"]').value.trim(),
      location: row.querySelector('[data-role="location"]').value.trim(),
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

function collectNotes() {
  return noteCatalogCache.length ? noteCatalogCache.slice() : ['Love you forever'];
}

function populateFormFromState() {
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
  ids.weatherUnit.value = widgets.weather.unit || 'F';
  const tempLabel = widgets.weather.temp ? `${widgets.weather.temp}${widgets.weather.unit || ''}` : '';
  const iconLabel = widgets.weather.icon ? widgets.weather.icon : '';
  ids.weatherPreview.textContent = tempLabel ? `${tempLabel} ${iconLabel}`.trim() : '';

  ids.calendarEnabled.checked = Boolean(widgets.calendar.enabled);
  ids.calendarDay.value = safeDate(widgets.calendar.selectedDate) || todayDateString();
  ids.calendarImportStatus.textContent = '';
  renderCalendarEvents(widgets.calendar.events || []);

  ids.todoEnabled.checked = Boolean(widgets.todo.enabled);
  ids.todoBulletStyle.value = widgets.todo.bulletStyle || 'dot';
  renderTodoItems(widgets.todo.items || []);

  ids.noteEnabled.checked = Boolean(widgets.note.enabled);
  renderNoteSelector(widgets.note.catalog || []);

  ids.messageText.value = appState.board.message.text || '';
  ids.messageColor.value = appState.board.message.color || '#ff3b30';
  ids.messageEffect.value = appState.board.message.effect || 'scroll';
  ids.messageSpeed.value = String(appState.board.message.speed || 35);
  ids.messageSpeedValue.textContent = ids.messageSpeed.value;

  ids.animationPreset.value = appState.board.animation.preset || 'rainbowWave';
  ids.animationSpeed.value = String(appState.board.animation.speed || 35);
  ids.animationSpeedValue.textContent = ids.animationSpeed.value;

  ensurePixels();
  drawPixelCanvas();
}

function syncStateFromForm() {
  if (!appState) {
    return;
  }

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
  appState.board.widgets.calendar.selectedDate = safeDate(ids.calendarDay.value) || todayDateString();
  appState.board.widgets.calendar.events = collectCalendarEvents();

  appState.board.widgets.todo.enabled = ids.todoEnabled.checked;
  appState.board.widgets.todo.bulletStyle = ids.todoBulletStyle.value;
  appState.board.widgets.todo.items = collectTodoItems();

  appState.board.widgets.note.enabled = ids.noteEnabled.checked;
  appState.board.widgets.note.catalog = collectNotes();

  appState.board.message.text = ids.messageText.value;
  appState.board.message.color = ids.messageColor.value;
  appState.board.message.effect = ids.messageEffect.value;
  appState.board.message.speed = Number(ids.messageSpeed.value) || 35;

  appState.board.animation.preset = ids.animationPreset.value;
  appState.board.animation.speed = Number(ids.animationSpeed.value) || 35;

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
  const selectedDate = safeDate(widgets.calendar.selectedDate) || todayDateString();
  const today = todayDateString();
  const now = new Date();
  const dayEvents = sortCalendarEvents(widgets.calendar.events || []).filter((event) => event.date === selectedDate);
  const upcomingEvents =
    selectedDate === today
      ? dayEvents.filter((event) => {
          const safeEventTime = safeTime(event.time) || '00:00';
          const eventDate = new Date(`${event.date}T${safeEventTime}:00`);
          return eventDate.getTime() >= now.getTime();
        })
      : dayEvents;
  const dailyNote = widgets.note.enabled ? getDailyNote(widgets.note.catalog || []) : 'OFF';
  const weatherTemp = widgets.weather.temp ? `${widgets.weather.temp}${widgets.weather.unit || ''}`.trim() : '--';
  const weatherIcon = widgets.weather.icon ? widgets.weather.icon : '';
  const weatherText = widgets.weather.enabled ? `${weatherTemp} ${weatherIcon}`.trim() : 'OFF';

  previewCtx.strokeStyle = 'rgba(255,255,255,0.18)';
  previewCtx.lineWidth = 2;
  previewCtx.strokeRect(0, 0, width, height);
  previewCtx.beginPath();
  previewCtx.moveTo(0, height * 0.25);
  previewCtx.lineTo(width, height * 0.25);
  previewCtx.moveTo(width * 0.5, height * 0.25);
  previewCtx.lineTo(width * 0.5, height);
  previewCtx.stroke();

  previewCtx.fillStyle = '#ffe082';
  previewCtx.font = '700 24px Space Grotesk';
  previewCtx.textAlign = 'left';
  previewCtx.fillText(nowClockString(), 14, 44);
  previewCtx.fillStyle = '#8ed7ff';
  previewCtx.fillText(weatherText.slice(0, 12), 150, 44);

  previewCtx.fillStyle = '#ffd2a1';
  previewCtx.font = '700 18px Space Grotesk';
  previewCtx.fillText('NOTE', width * 0.63, 28);
  previewCtx.fillStyle = '#fff9c4';
  previewCtx.fillText((dailyNote || '').slice(0, 18), width * 0.63, 54);

  previewCtx.fillStyle = '#ffe082';
  previewCtx.font = '700 20px Space Grotesk';
  previewCtx.fillText('TODO', 14, height * 0.34);
  previewCtx.fillStyle = '#f4f4f4';
  previewCtx.font = '500 18px Space Grotesk';

  const bulletSymbol = bulletPreviewSymbol(widgets.todo.bulletStyle || 'dot');
  const todoLines = (widgets.todo.items || []).slice(0, 3);
  todoLines.forEach((item, index) => {
    previewCtx.fillText(`${bulletSymbol} ${item.text}`.slice(0, 20), 14, height * 0.42 + index * 28);
  });

  previewCtx.fillStyle = '#ffe082';
  previewCtx.font = '700 20px Space Grotesk';
  previewCtx.fillText('TODAY', width * 0.53, height * 0.34);
  previewCtx.fillStyle = '#f4f4f4';
  previewCtx.font = '500 16px Space Grotesk';

  upcomingEvents.slice(0, 4).forEach((event, index) => {
    const line = `${event.time || '--:--'} ${event.title || ''}`.trim();
    previewCtx.fillText(line.slice(0, 24), width * 0.53, height * 0.42 + index * 24);
  });
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

async function importCalendarDayFromIcs() {
  syncStateFromForm();
  const date = safeDate(ids.calendarDay.value) || todayDateString();

  setStatus('working', `Importing ${date} from schedule.2026WI.ics...`);

  const payload = await api(`/api/calendar/day?date=${encodeURIComponent(date)}`, {
    method: 'GET'
  });

  const existing = collectCalendarEvents().filter((event) => event.date !== date);
  const imported = payload.events.map((event) => ({
    date: event.date,
    time: event.time || '00:00',
    title: event.title,
    location: event.location || '',
    source: 'ics'
  }));

  appState.board.widgets.calendar.events = [...existing, ...imported];
  renderCalendarEvents(appState.board.widgets.calendar.events);
  ids.calendarImportStatus.textContent = `Imported ${imported.length} event${imported.length === 1 ? '' : 's'} for ${date}.`;
  setStatus('success', `Calendar imported for ${date}.`);
  drawPreview();
}

function setCalendarDay(value) {
  const safeValue = safeDate(value) || todayDateString();
  ids.calendarDay.value = safeValue;
  syncStateFromForm();
  drawPreview();
}

function shiftCalendarDay(offsetDays) {
  const base = safeDate(ids.calendarDay.value) || todayDateString();
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + offsetDays);
  setCalendarDay(date.toISOString().slice(0, 10));
}

async function init() {
  setStatus('working', 'Loading saved settings...');
  appState = await api('/api/state');
  populateFormFromState();
  drawPreview();
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
    try {
      syncStateFromForm();
      setStatus('working', 'Fetching weather preview...');
      const weather = await api('/api/weather', {
        method: 'POST',
        body: JSON.stringify({
          city: appState.board.widgets.weather.city,
          unit: appState.board.widgets.weather.unit
        })
      });

      const summary = `${weather.temp}${weather.unit} ${weather.icon}`.trim();
      ids.weatherPreview.textContent = summary;
      appState.board.widgets.weather.summary = weather.summary;
      appState.board.widgets.weather.icon = weather.icon;
      appState.board.widgets.weather.temp = weather.temp;
      setStatus('success', 'Weather preview updated.');
      drawPreview();
    } catch (error) {
      setStatus('error', error.message);
    }
  });

  ids.importIcs.addEventListener('click', async () => {
    try {
      await importCalendarDayFromIcs();
    } catch (error) {
      setStatus('error', error.message);
      ids.calendarImportStatus.textContent = `Import failed: ${error.message}`;
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

  ids.addEvent.addEventListener('click', () => {
    const date = safeDate(ids.calendarDay.value) || todayDateString();
    renderCalendarEvents([
      ...collectCalendarEvents(),
      {
        date,
        time: '09:00',
        title: '',
        location: '',
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

  ids.noteSelect.addEventListener('change', () => {
    noteSelectionIndex = Number(ids.noteSelect.value) || 0;
    ids.noteText.value = noteCatalogCache[noteSelectionIndex] || '';
    syncStateFromForm();
    drawPreview();
  });

  ids.noteText.addEventListener('input', () => {
    if (!noteCatalogCache.length) {
      noteCatalogCache = [''];
      noteSelectionIndex = 0;
    }
    const nextValue = ids.noteText.value.slice(0, 80);
    if (nextValue !== ids.noteText.value) {
      ids.noteText.value = nextValue;
    }
    noteCatalogCache[noteSelectionIndex] = nextValue;
    updateNoteOption(noteSelectionIndex, nextValue);
    syncStateFromForm();
    drawPreview();
  });

  ids.addNote.addEventListener('click', () => {
    noteCatalogCache.push('New note');
    noteSelectionIndex = noteCatalogCache.length - 1;
    renderNoteSelector(noteCatalogCache);
    syncStateFromForm();
    drawPreview();
  });

  ids.removeNote.addEventListener('click', () => {
    if (!noteCatalogCache.length) {
      noteCatalogCache = ['Love you forever'];
      noteSelectionIndex = 0;
    } else {
      noteCatalogCache.splice(noteSelectionIndex, 1);
      if (!noteCatalogCache.length) {
        noteCatalogCache = ['Love you forever'];
        noteSelectionIndex = 0;
      } else if (noteSelectionIndex >= noteCatalogCache.length) {
        noteSelectionIndex = noteCatalogCache.length - 1;
      }
    }
    renderNoteSelector(noteCatalogCache);
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
    ids.calendarDay,
    ids.todoEnabled,
    ids.todoBulletStyle,
    ids.noteEnabled,
    ids.messageText,
    ids.messageColor,
    ids.messageEffect,
    ids.messageSpeed,
    ids.animationPreset,
    ids.animationSpeed,
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
