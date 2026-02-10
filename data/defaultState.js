'use strict';

const WIDTH = 64;
const HEIGHT = 32;

function createBlankPixels() {
  return Array.from({ length: WIDTH * HEIGHT }, () => '#000000');
}

const defaultState = {
  board: {
    width: WIDTH,
    height: HEIGHT,
    brightness: 70,
    mode: 'widgets',
    widgets: {
      weather: {
        enabled: true,
        city: 'Los Angeles',
        unit: 'F',
        summary: 'Sunny'
      },
      calendar: {
        enabled: true,
        events: [
          {
            date: '2026-02-14',
            time: '19:00',
            title: 'Date Night'
          }
        ]
      },
      todo: {
        enabled: true,
        items: [
          { text: 'Buy flowers', done: false },
          { text: 'Set table', done: false }
        ]
      },
      note: {
        enabled: true,
        text: 'Love you forever!'
      }
    },
    message: {
      text: 'Hi gorgeous <3',
      color: '#ff3b30',
      speed: 35,
      effect: 'scroll'
    },
    animation: {
      preset: 'rainbowWave',
      speed: 35
    },
    pixels: {
      data: createBlankPixels(),
      background: '#000000'
    }
  },
  pi: {
    host: 'lrdigiboard',
    port: 22,
    username: 'lydarose',
    password: '',
    remoteScriptPath: '/home/lydarose/remote_display.py',
    pythonCommand: 'python3',
    useSudo: false,
    matrixOptions: {
      rows: 32,
      cols: 64,
      chainLength: 1,
      parallel: 1,
      hardwareMapping: 'adafruit-hat-pwm',
      gpioSlowdown: 2,
      pwmBits: 11,
      pwmLsbNanoseconds: 130
    }
  }
};

module.exports = {
  defaultState,
  createBlankPixels
};
