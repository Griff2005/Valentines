'use strict';

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const aDate = new Date(`${a.date || ''}T${a.time || '00:00'}`);
    const bDate = new Date(`${b.date || ''}T${b.time || '00:00'}`);
    return aDate.getTime() - bDate.getTime();
  });
}

function normalizeTodoItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => typeof item.text === 'string' && item.text.trim())
    .map((item) => ({
      text: item.text.trim().slice(0, 80)
    }));
}

function normalizeCalendarEvents(events) {
  return sortEvents(
    (Array.isArray(events) ? events : []).map((event) => ({
      date: String(event?.date || '').trim(),
      time: String(event?.time || '').trim(),
      title: String(event?.title || '').trim(),
      source: String(event?.source || 'manual').trim()
    }))
  )
    .filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(event.date) && event.title)
    .map((event) => ({
      ...event,
      time: /^\d{2}:\d{2}$/.test(event.time) ? event.time : '00:00'
    }));
}

function normalizeBulletStyle(style) {
  const value = String(style || '').trim();
  return ['dot', 'heart', 'star', 'diamond'].includes(value) ? value : 'dot';
}

function buildMatrixOptions(state) {
  const matrix = state.pi.matrixOptions || {};
  const rawMapping = typeof matrix.hardwareMapping === 'string' ? matrix.hardwareMapping.trim() : '';
  const hardwareMapping = rawMapping || 'regular';
  let gpioSlowdown = clampNumber(matrix.gpioSlowdown, 0, 8, 4);
  if (hardwareMapping === 'regular' && gpioSlowdown < 4) {
    gpioSlowdown = 4;
  }

  return {
    rows: clampNumber(matrix.rows, 16, 64, 32),
    cols: clampNumber(matrix.cols, 32, 128, 64),
    chainLength: clampNumber(matrix.chainLength, 1, 4, 1),
    parallel: clampNumber(matrix.parallel, 1, 3, 1),
    hardwareMapping,
    gpioSlowdown,
    noHardwarePulse: matrix.noHardwarePulse !== false,
    pwmBits: clampNumber(matrix.pwmBits, 1, 11, 11),
    pwmLsbNanoseconds: clampNumber(matrix.pwmLsbNanoseconds, 50, 300, 130)
  };
}

async function buildWidgetPayload(state, getWeather) {
  const widgets = state.board.widgets || {};
  const weatherWidget = widgets.weather || {};
  const calendarWidget = widgets.calendar || {};
  const todoWidget = widgets.todo || {};

  let weatherData = {
    city: weatherWidget.city,
    temp: weatherWidget.temp || '--',
    unit: weatherWidget.unit || 'F',
    summary: weatherWidget.summary || 'N/A',
    icon: weatherWidget.icon || 'cloud'
  };

  if (weatherWidget.enabled) {
    try {
      weatherData = await getWeather({
        city: weatherWidget.city,
        unit: weatherWidget.unit
      });
    } catch (_error) {
      weatherData = {
        ...weatherData,
        icon: weatherWidget.icon || weatherData.icon || 'cloud'
      };
    }
  }

  const events = normalizeCalendarEvents(calendarWidget.events);
  const todoItems = normalizeTodoItems(todoWidget.items || []);

  return {
    mode: 'widgets',
    brightness: clampNumber(state.board.brightness, 10, 100, 70),
    matrixOptions: buildMatrixOptions(state),
    widgets: {
      weather: {
        enabled: Boolean(weatherWidget.enabled),
        city: weatherData.city,
        temp: String(weatherData.temp),
        unit: String(weatherData.unit || 'F'),
        summary: String(weatherData.summary || 'N/A'),
        icon: String(weatherData.icon || 'cloud')
      },
      calendar: {
        enabled: Boolean(calendarWidget.enabled),
        selectedDate: String(calendarWidget.selectedDate || ''),
        events
      },
      todo: {
        enabled: Boolean(todoWidget.enabled),
        bulletStyle: normalizeBulletStyle(todoWidget.bulletStyle),
        items: todoItems
      }
    }
  };
}

function buildMessagePayload(state) {
  const message = state.board.message;
  return {
    mode: 'message',
    brightness: clampNumber(state.board.brightness, 10, 100, 70),
    matrixOptions: buildMatrixOptions(state),
    message: {
      text: (message.text || 'Hello').slice(0, 200),
      color: /^#[0-9A-Fa-f]{6}$/.test(message.color || '') ? message.color : '#ff3b30',
      speed: clampNumber(message.speed, 10, 100, 35),
      effect: ['scroll', 'pulse', 'static'].includes(message.effect) ? message.effect : 'scroll'
    }
  };
}

function buildAnimationPayload(state) {
  const animation = state.board.animation;
  return {
    mode: 'animation',
    brightness: clampNumber(state.board.brightness, 10, 100, 70),
    matrixOptions: buildMatrixOptions(state),
    animation: {
      preset: ['rainbowWave', 'heartBeat', 'sparkles', 'colorWipe'].includes(animation.preset)
        ? animation.preset
        : 'rainbowWave',
      speed: clampNumber(animation.speed, 10, 100, 35)
    }
  };
}

function buildPixelsPayload(state) {
  return {
    mode: 'pixels',
    brightness: clampNumber(state.board.brightness, 10, 100, 70),
    matrixOptions: buildMatrixOptions(state),
    pixels: {
      width: 64,
      height: 32,
      data: state.board.pixels.data,
      background: state.board.pixels.background
    }
  };
}

function buildValentinePayload(state) {
  const valentine = state.board.valentine || {};

  return {
    mode: 'valentine',
    brightness: clampNumber(state.board.brightness, 10, 100, 70),
    matrixOptions: buildMatrixOptions(state),
    valentine: {
      question: String(valentine.question || '').trim().slice(0, 80) || 'Will you be my Valentine?',
      fireworks: Boolean(valentine.fireworks)
    }
  };
}

async function buildPayload(state, mode, getWeather) {
  const selectedMode = mode || state.board.mode;

  if (selectedMode === 'widgets') {
    return buildWidgetPayload(state, getWeather);
  }

  if (selectedMode === 'message') {
    return buildMessagePayload(state);
  }

  if (selectedMode === 'animation') {
    return buildAnimationPayload(state);
  }

  if (selectedMode === 'pixels') {
    return buildPixelsPayload(state);
  }

  if (selectedMode === 'valentine') {
    return buildValentinePayload(state);
  }

  throw new Error(`Unsupported board mode: ${selectedMode}`);
}

module.exports = {
  buildPayload
};
