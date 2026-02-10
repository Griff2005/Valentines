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
        summary: 'Sunny',
        icon: 'sun',
        temp: '--'
      },
      calendar: {
        enabled: true,
        selectedDate: '',
        events: [
          {
            date: '2026-02-14',
            time: '19:00',
            title: 'Date Night',
            source: 'manual'
          }
        ]
      },
      todo: {
        enabled: true,
        bulletStyle: 'dot',
        items: [
          { text: 'Buy flowers' },
          { text: 'Set table' }
        ]
      },
      note: {
        enabled: true,
        catalog: [
          'Love you forever',
          'You make my day',
          'I am proud of you',
          'You are my favorite',
          'Smile, beautiful'
        ]
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
