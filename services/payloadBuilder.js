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
  return items
    .filter((item) => typeof item.text === 'string' && item.text.trim())
    .map((item) => ({
      text: item.text.trim(),
      done: Boolean(item.done)
    }));
}

function buildMatrixOptions(state) {
  const matrix = state.pi.matrixOptions || {};
  return {
    rows: clampNumber(matrix.rows, 16, 64, 32),
    cols: clampNumber(matrix.cols, 32, 128, 64),
    chainLength: clampNumber(matrix.chainLength, 1, 4, 1),
    parallel: clampNumber(matrix.parallel, 1, 3, 1),
    hardwareMapping: typeof matrix.hardwareMapping === 'string' ? matrix.hardwareMapping : 'adafruit-hat-pwm',
    gpioSlowdown: clampNumber(matrix.gpioSlowdown, 0, 5, 2),
    pwmBits: clampNumber(matrix.pwmBits, 1, 11, 11),
    pwmLsbNanoseconds: clampNumber(matrix.pwmLsbNanoseconds, 50, 300, 130)
  };
}

async function buildWidgetPayload(state, getWeather) {
  const widgets = state.board.widgets;
  let weatherText = null;

  if (widgets.weather.enabled) {
    try {
      const weather = await getWeather({
        city: widgets.weather.city,
        unit: widgets.weather.unit
      });
      weatherText = `${weather.temp}${weather.unit} ${weather.summary}`;
    } catch (error) {
      const fallbackSummary = widgets.weather.summary || 'N/A';
      weatherText = `--${widgets.weather.unit} ${fallbackSummary}`;
    }
  }

  const events = sortEvents(widgets.calendar.events || [])
    .slice(0, 3)
    .map((event) => {
      const title = (event.title || '').trim().slice(0, 12);
      const day = (event.date || '').slice(5);
      const time = (event.time || '').slice(0, 5);
      return `${day} ${time} ${title}`.trim();
    })
    .filter(Boolean);

  const todo = normalizeTodoItems(widgets.todo.items || [])
    .slice(0, 3)
    .map((item) => `${item.done ? '[x]' : '[ ]'} ${item.text.slice(0, 14)}`);

  return {
    mode: 'widgets',
    brightness: clampNumber(state.board.brightness, 10, 100, 70),
    matrixOptions: buildMatrixOptions(state),
    widgets: {
      weather: {
        enabled: Boolean(widgets.weather.enabled),
        city: widgets.weather.city,
        text: weatherText
      },
      calendar: {
        enabled: Boolean(widgets.calendar.enabled),
        lines: events
      },
      todo: {
        enabled: Boolean(widgets.todo.enabled),
        lines: todo
      },
      note: {
        enabled: Boolean(widgets.note.enabled),
        text: (widgets.note.text || '').slice(0, 50)
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

  throw new Error(`Unsupported board mode: ${selectedMode}`);
}

module.exports = {
  buildPayload
};
