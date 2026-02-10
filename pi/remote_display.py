#!/usr/bin/env python3
"""Remote renderer for hzeller/rpi-rgb-led-matrix.

This script accepts a JSON payload and keeps rendering until killed.
Designed to be started/stopped by the companion web dashboard.
"""

import argparse
import base64
import json
import math
import random
import signal
import sys
import time
from datetime import date, datetime

from rgbmatrix import RGBMatrix, RGBMatrixOptions  # type: ignore

RUNNING = True

FONT_3X5 = {
    ' ': ['000', '000', '000', '000', '000'],
    'A': ['010', '101', '111', '101', '101'],
    'B': ['110', '101', '110', '101', '110'],
    'C': ['011', '100', '100', '100', '011'],
    'D': ['110', '101', '101', '101', '110'],
    'E': ['111', '100', '110', '100', '111'],
    'F': ['111', '100', '110', '100', '100'],
    'G': ['011', '100', '101', '101', '011'],
    'H': ['101', '101', '111', '101', '101'],
    'I': ['111', '010', '010', '010', '111'],
    'J': ['111', '001', '001', '101', '010'],
    'K': ['101', '101', '110', '101', '101'],
    'L': ['100', '100', '100', '100', '111'],
    'M': ['101', '111', '111', '101', '101'],
    'N': ['101', '111', '111', '111', '101'],
    'O': ['010', '101', '101', '101', '010'],
    'P': ['110', '101', '110', '100', '100'],
    'Q': ['010', '101', '101', '111', '011'],
    'R': ['110', '101', '110', '101', '101'],
    'S': ['011', '100', '010', '001', '110'],
    'T': ['111', '010', '010', '010', '010'],
    'U': ['101', '101', '101', '101', '111'],
    'V': ['101', '101', '101', '101', '010'],
    'W': ['101', '101', '111', '111', '101'],
    'X': ['101', '101', '010', '101', '101'],
    'Y': ['101', '101', '010', '010', '010'],
    'Z': ['111', '001', '010', '100', '111'],
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['110', '001', '010', '100', '111'],
    '3': ['110', '001', '010', '001', '110'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '110', '001', '110'],
    '6': ['011', '100', '110', '101', '010'],
    '7': ['111', '001', '010', '100', '100'],
    '8': ['010', '101', '010', '101', '010'],
    '9': ['010', '101', '011', '001', '110'],
    '.': ['000', '000', '000', '000', '010'],
    ',': ['000', '000', '000', '010', '100'],
    ':': ['000', '010', '000', '010', '000'],
    ';': ['000', '010', '000', '010', '100'],
    '!': ['010', '010', '010', '000', '010'],
    '?': ['110', '001', '010', '000', '010'],
    '-': ['000', '000', '111', '000', '000'],
    '+': ['000', '010', '111', '010', '000'],
    '/': ['001', '001', '010', '100', '100'],
    '[': ['110', '100', '100', '100', '110'],
    ']': ['011', '001', '001', '001', '011'],
    '(': ['010', '100', '100', '100', '010'],
    ')': ['010', '001', '001', '001', '010'],
    '<': ['001', '010', '100', '010', '001'],
    '>': ['100', '010', '001', '010', '100'],
    '#': ['101', '111', '101', '111', '101'],
    '_': ['000', '000', '000', '000', '111']
}


def on_signal(_signum, _frame):
    global RUNNING
    RUNNING = False


def clamp(value, low, high, fallback):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback

    return max(low, min(high, number))


def hex_to_rgb(value):
    text = str(value or '').strip()
    if len(text) != 7 or not text.startswith('#'):
        return (255, 255, 255)

    try:
        return (
            int(text[1:3], 16),
            int(text[3:5], 16),
            int(text[5:7], 16),
        )
    except ValueError:
        return (255, 255, 255)


def scale_color(color, factor):
    return (
        max(0, min(255, int(color[0] * factor))),
        max(0, min(255, int(color[1] * factor))),
        max(0, min(255, int(color[2] * factor))),
    )


def clear(canvas):
    canvas.Fill(0, 0, 0)


def draw_pixel(canvas, x, y, color):
    if 0 <= x < canvas.width and 0 <= y < canvas.height:
        canvas.SetPixel(x, y, color[0], color[1], color[2])


def draw_hline(canvas, x1, x2, y, color):
    for x in range(x1, x2 + 1):
        draw_pixel(canvas, x, y, color)


def draw_vline(canvas, x, y1, y2, color):
    for y in range(y1, y2 + 1):
        draw_pixel(canvas, x, y, color)


def draw_char(canvas, x, y, char, color):
    glyph = FONT_3X5.get(char.upper(), FONT_3X5[' '])
    for row_index, row in enumerate(glyph):
        for col_index, bit in enumerate(row):
            if bit == '1':
                draw_pixel(canvas, x + col_index, y + row_index, color)


def draw_text(canvas, x, y, text, color):
    cursor = x
    for char in text:
        draw_char(canvas, cursor, y, char, color)
        cursor += 4


def text_width(text):
    return len(str(text or '')) * 4


def draw_text_compact(canvas, x, y, text, color):
    cursor = x
    for char in text:
        draw_char(canvas, cursor, y, char, color)
        cursor += 3


def compact_text_width(text):
    return len(str(text or '')) * 3


def wrap_text(text, max_chars, max_lines):
    words = str(text or '').split()
    if not words:
        return []

    lines = []
    current = ''

    for word in words:
        if len(word) > max_chars:
            word = word[:max_chars]

        if not current:
            current = word
            continue

        trial = f'{current} {word}'
        if len(trial) <= max_chars:
            current = trial
            continue

        lines.append(current)
        current = word

        if len(lines) >= max_lines:
            return lines[:max_lines]

    if current and len(lines) < max_lines:
        lines.append(current)

    return lines[:max_lines]


def build_matrix(payload):
    options_data = payload.get('matrixOptions', {})

    options = RGBMatrixOptions()
    options.rows = int(clamp(options_data.get('rows'), 16, 64, 32))
    options.cols = int(clamp(options_data.get('cols'), 32, 128, 64))
    options.chain_length = int(clamp(options_data.get('chainLength'), 1, 4, 1))
    options.parallel = int(clamp(options_data.get('parallel'), 1, 3, 1))
    options.hardware_mapping = str(options_data.get('hardwareMapping') or 'adafruit-hat-pwm')
    options.gpio_slowdown = int(clamp(options_data.get('gpioSlowdown'), 0, 5, 2))
    options.pwm_bits = int(clamp(options_data.get('pwmBits'), 1, 11, 11))
    options.pwm_lsb_nanoseconds = int(clamp(options_data.get('pwmLsbNanoseconds'), 50, 300, 130))

    matrix = RGBMatrix(options=options)
    brightness = int(clamp(payload.get('brightness'), 10, 100, 70))
    matrix.brightness = brightness
    return matrix


def run_message(matrix, payload):
    config = payload.get('message', {})
    message = str(config.get('text') or 'HELLO')
    effect = str(config.get('effect') or 'scroll')
    speed = clamp(config.get('speed'), 10, 100, 35)
    color = hex_to_rgb(config.get('color'))

    frame_delay = 0.14 - (speed / 100.0) * 0.11
    frame_delay = max(0.015, frame_delay)

    text_y = max(0, (matrix.height - 5) // 2)
    text_total_width = text_width(message)
    scroll_x = matrix.width
    pulse_phase = 0.0

    canvas = matrix.CreateFrameCanvas()

    while RUNNING:
        clear(canvas)

        if effect == 'static':
            x = (matrix.width - text_total_width) // 2
            draw_text(canvas, x, text_y, message, color)
        elif effect == 'pulse':
            pulse_phase += 0.3
            factor = 0.35 + (math.sin(pulse_phase) + 1.0) * 0.325
            pulse_color = scale_color(color, factor)
            x = (matrix.width - text_total_width) // 2
            draw_text(canvas, x, text_y, message, pulse_color)
        else:
            draw_text(canvas, scroll_x, text_y, message, color)
            scroll_x -= 1
            if scroll_x < -text_total_width:
                scroll_x = matrix.width

        canvas = matrix.SwapOnVSync(canvas)
        time.sleep(frame_delay)


def draw_box(canvas, x1, y1, x2, y2, color):
    draw_hline(canvas, x1, x2, y1, color)
    draw_hline(canvas, x1, x2, y2, color)
    draw_vline(canvas, x1, y1, y2, color)
    draw_vline(canvas, x2, y1, y2, color)


def draw_box_text(canvas, x, y, width, height, title, lines, title_color, text_color):
    max_chars = max(1, (width - 3) // 4)
    max_lines = max(1, (height - 7) // 6)

    draw_text(canvas, x + 1, y + 1, title[:max_chars], title_color)

    line_y = y + 7
    printed = 0

    for raw in lines:
        wrapped = wrap_text(raw, max_chars, max_lines - printed)
        for line in wrapped:
            if printed >= max_lines:
                return
            draw_text(canvas, x + 1, line_y, line, text_color)
            line_y += 6
            printed += 1


def fit_text(value, max_chars):
    text = str(value or '').strip()
    if not text:
        return ''
    return text[:max_chars]


def pick_daily_note(catalog):
    notes = [str(note or '').strip() for note in catalog if str(note or '').strip()]
    if not notes:
        return ''
    return notes[date.today().toordinal() % len(notes)]


def draw_weather_icon(canvas, x, y, icon_name):
    icon = str(icon_name or 'cloud').lower()

    if icon == 'sun':
        color = (255, 206, 40)
        pattern = ['00100', '10101', '01110', '10101', '00100']
    elif icon == 'rain':
        color = (60, 170, 255)
        pattern = ['01110', '11111', '00100', '01010', '10001']
    elif icon == 'storm':
        color = (255, 180, 40)
        pattern = ['01110', '11111', '00100', '01100', '00110']
    elif icon == 'snow':
        color = (230, 245, 255)
        pattern = ['10101', '01010', '10101', '01010', '10101']
    elif icon == 'fog':
        color = (185, 210, 220)
        pattern = ['00000', '11111', '00000', '11111', '00000']
    else:
        color = (180, 210, 240)
        pattern = ['00000', '01110', '11111', '01110', '00000']

    for row_index, row in enumerate(pattern):
        for col_index, bit in enumerate(row):
            if bit == '1':
                draw_pixel(canvas, x + col_index, y + row_index, color)


def draw_todo_bullet(canvas, x, y, style):
    bullet_style = str(style or 'dot').lower()
    color = (255, 120, 120)

    if bullet_style == 'heart':
        pattern = ['01010', '11111', '11111', '01110', '00100']
    elif bullet_style == 'star':
        pattern = ['00100', '10101', '01110', '10101', '00100']
    elif bullet_style == 'diamond':
        pattern = ['00100', '01110', '11111', '01110', '00100']
    else:
        pattern = ['00000', '00100', '01110', '00100', '00000']

    for row_index, row in enumerate(pattern):
        for col_index, bit in enumerate(row):
            if bit == '1':
                draw_pixel(canvas, x + col_index, y + row_index, color)


def format_event_time(value):
    text = str(value or '').strip()
    if len(text) >= 5 and text[2] == ':':
        return text[:5]
    return '00:00'


def upcoming_events(events):
    now = datetime.now()
    today = now.strftime('%Y-%m-%d')
    current_minutes = now.hour * 60 + now.minute
    valid = []

    for event in events:
        if str(event.get('date') or '').strip() != today:
            continue

        time_text = format_event_time(event.get('time'))
        try:
            minutes = int(time_text[:2]) * 60 + int(time_text[3:5])
        except ValueError:
            minutes = 0

        if minutes < current_minutes:
            continue

        valid.append({
            'time': time_text,
            'title': str(event.get('title') or '').strip()
        })

    valid.sort(key=lambda item: item['time'])
    return valid


def run_widgets(matrix, payload):
    widgets = payload.get('widgets', {})
    weather = widgets.get('weather', {})
    calendar = widgets.get('calendar', {})
    todo = widgets.get('todo', {})
    note = widgets.get('note', {})

    border = (40, 96, 118)
    title_color = (255, 210, 100)
    text_color = (214, 235, 255)
    muted_color = (130, 150, 166)

    canvas = matrix.CreateFrameCanvas()

    while RUNNING:
        clear(canvas)

        draw_hline(canvas, 0, matrix.width - 1, 7, border)
        draw_vline(canvas, 31, 8, matrix.height - 1, border)

        # Top-left: live time + date + weather (compact spacing)
        now = datetime.now()
        time_text = f"{now.hour}:{now.minute:02d}"
        date_text = f"{now.strftime('%b')} {now.day}"
        clock_text = f"{time_text} {date_text}"
        clock_x = 1
        draw_text_compact(canvas, clock_x, 1, clock_text, (255, 242, 194))
        weather_x = clock_x + compact_text_width(clock_text) + 1

        if note.get('enabled', True):
            daily_note = pick_daily_note(note.get('catalog', []))
            note_color = (255, 195, 143)
            note_text = fit_text(daily_note, 4)
        else:
            note_color = muted_color
            note_text = 'OFF'

        note_width = compact_text_width(note_text)
        note_x = matrix.width - note_width - 1

        if weather.get('enabled', True):
            temp_value = str(weather.get('temp', '--')).strip()
            unit_value = str(weather.get('unit', 'F')).strip()
            temp_text = fit_text(f"{temp_value}{unit_value}", 4)
            temp_text_no_unit = fit_text(temp_value, 3)
            draw_temp_text = temp_text
            icon_x = weather_x + compact_text_width(draw_temp_text) + 1

            icon_width = 5
            if icon_x + icon_width >= note_x and note.get('enabled', True) and len(note_text) > 3:
                note_text = fit_text(daily_note, 3)
                note_width = compact_text_width(note_text)
                note_x = matrix.width - note_width - 1

            if icon_x + icon_width >= note_x:
                draw_temp_text = temp_text_no_unit
                icon_x = weather_x + compact_text_width(draw_temp_text) + 1

            if icon_x + icon_width >= note_x and note.get('enabled', True) and len(note_text) > 2:
                note_text = fit_text(daily_note, 2)
                note_width = compact_text_width(note_text)
                note_x = matrix.width - note_width - 1

            draw_text_compact(canvas, weather_x, 1, draw_temp_text, (155, 236, 255))
            draw_weather_icon(canvas, icon_x, 1, weather.get('icon', 'cloud'))
        else:
            draw_text_compact(canvas, weather_x, 1, 'OFF', muted_color)

        # Top-right: short daily note rotated from catalog
        draw_text_compact(canvas, note_x, 1, note_text, note_color)

        # Bottom-left: todo list with bullet styles
        draw_text(canvas, 1, 9, 'TODO', title_color)
        todo_items = todo.get('items', []) if todo.get('enabled', True) else []
        todo_style = todo.get('bulletStyle', 'dot')
        todo_y = 15

        if not todo.get('enabled', True):
            draw_text(canvas, 1, todo_y, 'OFF', muted_color)
        elif not todo_items:
            draw_text(canvas, 1, todo_y, 'NONE', muted_color)
        else:
            for item in todo_items[:3]:
                draw_todo_bullet(canvas, 1, todo_y, todo_style)
                draw_text(canvas, 7, todo_y, fit_text(item.get('text', ''), 6), text_color)
                todo_y += 6

        # Bottom-right: today's calendar events
        draw_text(canvas, 33, 9, 'DAY', title_color)
        day_events = upcoming_events(calendar.get('events', [])) if calendar.get('enabled', True) else []
        cal_y = 15

        if not calendar.get('enabled', True):
            draw_text(canvas, 33, cal_y, 'OFF', muted_color)
        elif not day_events:
            draw_text(canvas, 33, cal_y, 'FREE', muted_color)
        else:
            for event in day_events[:3]:
                compact_time = event['time'].replace(':', '')[:4]
                title = fit_text(event['title'], 3)
                draw_text(canvas, 33, cal_y, f'{compact_time}{title}', text_color)
                cal_y += 6

        canvas = matrix.SwapOnVSync(canvas)
        time.sleep(0.25)


def draw_rainbow_wave(canvas, phase):
    for y in range(canvas.height):
        for x in range(canvas.width):
            hue = (x * 3 + y * 5 + int(phase * 40)) % 360
            r = int((math.sin(math.radians(hue)) + 1) * 127)
            g = int((math.sin(math.radians(hue + 120)) + 1) * 127)
            b = int((math.sin(math.radians(hue + 240)) + 1) * 127)
            canvas.SetPixel(x, y, r, g, b)


def draw_heart(canvas, phase):
    pulse = 0.6 + (math.sin(phase * 2.0) + 1.0) * 0.2
    canvas.Fill(0, 0, 0)

    scale = 0.16 * pulse
    for px in range(canvas.width):
        for py in range(canvas.height):
            x = (px - canvas.width / 2) * scale
            y = (py - canvas.height / 2) * scale
            value = (x * x + y * y - 1) ** 3 - x * x * y * y * y
            if value <= 0:
                intensity = max(0, min(255, int(140 + 115 * pulse)))
                canvas.SetPixel(px, py, intensity, 20, 60)


def draw_sparkles(canvas, points):
    canvas.Fill(0, 0, 0)
    for point in points:
        point['life'] -= 1
        if point['life'] <= 0:
            point['x'] = random.randint(0, canvas.width - 1)
            point['y'] = random.randint(0, canvas.height - 1)
            point['life'] = random.randint(4, 14)
            point['max'] = point['life']

        ratio = point['life'] / max(1, point['max'])
        bright = int(255 * ratio)
        canvas.SetPixel(point['x'], point['y'], bright, bright, bright)


def draw_color_wipe(canvas, step):
    palette = [(255, 30, 60), (30, 230, 120), (40, 130, 255), (240, 220, 30)]
    color = palette[(step // canvas.width) % len(palette)]
    cutoff = step % canvas.width

    for y in range(canvas.height):
        for x in range(canvas.width):
            if x <= cutoff:
                canvas.SetPixel(x, y, color[0], color[1], color[2])
            else:
                canvas.SetPixel(x, y, 0, 0, 0)


def run_animation(matrix, payload):
    config = payload.get('animation', {})
    preset = str(config.get('preset') or 'rainbowWave')
    speed = clamp(config.get('speed'), 10, 100, 35)
    frame_delay = 0.16 - (speed / 100.0) * 0.13
    frame_delay = max(0.02, frame_delay)

    canvas = matrix.CreateFrameCanvas()
    phase = 0.0
    step = 0

    sparkle_count = max(8, (matrix.width * matrix.height) // 16)
    sparkles = [
        {
            'x': random.randint(0, matrix.width - 1),
            'y': random.randint(0, matrix.height - 1),
            'life': random.randint(3, 12),
            'max': 12,
        }
        for _ in range(sparkle_count)
    ]

    while RUNNING:
        if preset == 'heartBeat':
            draw_heart(canvas, phase)
        elif preset == 'sparkles':
            draw_sparkles(canvas, sparkles)
        elif preset == 'colorWipe':
            draw_color_wipe(canvas, step)
        else:
            draw_rainbow_wave(canvas, phase)

        canvas = matrix.SwapOnVSync(canvas)
        phase += 0.15
        step += 1
        time.sleep(frame_delay)


def run_pixels(matrix, payload):
    pixels = payload.get('pixels', {})
    width = int(clamp(pixels.get('width'), 1, 64, 64))
    height = int(clamp(pixels.get('height'), 1, 64, 32))
    data = pixels.get('data', [])

    canvas = matrix.CreateFrameCanvas()

    while RUNNING:
        canvas.Fill(0, 0, 0)

        if isinstance(data, list):
            for y in range(min(height, matrix.height)):
                for x in range(min(width, matrix.width)):
                    index = y * width + x
                    if index >= len(data):
                        continue
                    color = hex_to_rgb(data[index])
                    canvas.SetPixel(x, y, color[0], color[1], color[2])

        canvas = matrix.SwapOnVSync(canvas)
        time.sleep(0.2)


def load_payload(args):
    if args.payload_b64:
        decoded = base64.b64decode(args.payload_b64.encode('utf-8')).decode('utf-8')
        return json.loads(decoded)

    if args.payload_file:
        with open(args.payload_file, 'r', encoding='utf-8') as handle:
            return json.load(handle)

    if args.stdin:
        raw = sys.stdin.read()
        return json.loads(raw)

    raise RuntimeError('No payload provided. Use --payload-b64, --payload-file, or --stdin')


def main():
    parser = argparse.ArgumentParser(description='Render payload on RGB matrix')
    parser.add_argument('--payload-b64', help='Base64 encoded JSON payload')
    parser.add_argument('--payload-file', help='Path to JSON payload file')
    parser.add_argument('--stdin', action='store_true', help='Read JSON payload from stdin')
    parser.add_argument('--runner', action='store_true', help='Run continuously until killed')

    args = parser.parse_args()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    payload = load_payload(args)
    matrix = build_matrix(payload)
    mode = str(payload.get('mode') or 'message')

    try:
        if mode == 'widgets':
            run_widgets(matrix, payload)
        elif mode == 'animation':
            run_animation(matrix, payload)
        elif mode == 'pixels':
            run_pixels(matrix, payload)
        else:
            run_message(matrix, payload)
    finally:
        canvas = matrix.CreateFrameCanvas()
        canvas.Fill(0, 0, 0)
        matrix.SwapOnVSync(canvas)


if __name__ == '__main__':
    main()
