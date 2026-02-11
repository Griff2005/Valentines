'use strict';

function mapWeatherCode(code) {
  const map = {
    0: 'Clear',
    1: 'Mostly clear',
    2: 'Partly cloudy',
    3: 'Cloudy',
    45: 'Fog',
    48: 'Fog',
    51: 'Drizzle',
    53: 'Drizzle',
    55: 'Drizzle',
    56: 'Freezing drizzle',
    57: 'Freezing drizzle',
    61: 'Rain',
    63: 'Rain',
    65: 'Rain',
    66: 'Freezing rain',
    67: 'Freezing rain',
    71: 'Snow',
    73: 'Snow',
    75: 'Snow',
    77: 'Snow',
    80: 'Showers',
    81: 'Showers',
    82: 'Showers',
    85: 'Snow showers',
    86: 'Snow showers',
    95: 'Thunder',
    96: 'Thunder',
    99: 'Thunder'
  };

  return map[code] || 'Weather';
}

function mapWeatherIcon(code) {
  if (code === 0 || code === 1) {
    return 'sun';
  }

  if (code === 2 || code === 3) {
    return 'cloud';
  }

  if (code === 45 || code === 48) {
    return 'fog';
  }

  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    return 'rain';
  }

  if ([56, 57, 66, 67, 71, 73, 75, 77, 85, 86].includes(code)) {
    return 'snow';
  }

  if ([95, 96, 99].includes(code)) {
    return 'storm';
  }

  return 'cloud';
}

function parseLocationQuery(city) {
  const trimmed = String(city || '').trim();
  if (!trimmed) {
    throw new Error('City is required for weather lookup.');
  }

  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  const name = parts[0] || trimmed;
  const hintTokens = parts
    .slice(1)
    .flatMap((part) => part.toLowerCase().split(/[\s/]+/).filter(Boolean));

  return {
    raw: trimmed,
    name,
    hintTokens
  };
}

function inferCountryCode(hintTokens) {
  const hints = new Set(hintTokens.map((token) => token.toLowerCase()));
  if (hints.has('canada') || hints.has('ca') || hints.has('ontario') || hints.has('on')) {
    return 'CA';
  }
  if (hints.has('usa') || hints.has('us') || hints.has('united') || hints.has('states')) {
    return 'US';
  }
  return '';
}

function scorePlace(place, queryName, hintTokens) {
  const name = String(place?.name || '').toLowerCase();
  const admin1 = String(place?.admin1 || '').toLowerCase();
  const admin2 = String(place?.admin2 || '').toLowerCase();
  const country = String(place?.country || '').toLowerCase();
  const countryCode = String(place?.country_code || '').toUpperCase();
  const text = `${name} ${admin1} ${admin2} ${country} ${countryCode.toLowerCase()}`;
  const query = String(queryName || '').trim().toLowerCase();

  let score = 0;
  if (query && name === query) {
    score += 70;
  } else if (query && name.startsWith(query)) {
    score += 35;
  } else if (query && text.includes(query)) {
    score += 15;
  }

  for (const token of hintTokens) {
    if (!token) {
      continue;
    }

    if (token === 'ontario' && admin1 === 'ontario') {
      score += 120;
      continue;
    }

    if (token === 'canada' && countryCode === 'CA') {
      score += 90;
      continue;
    }

    if (token === 'ca' && countryCode === 'CA') {
      score += 40;
      continue;
    }

    if (token === 'on' && admin1 === 'ontario') {
      score += 35;
      continue;
    }

    if (text.includes(token)) {
      score += 12;
    }
  }

  const population = Number(place?.population);
  if (Number.isFinite(population) && population > 0) {
    score += Math.min(20, Math.log10(population));
  }

  return score;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function geocodeCity(city) {
  const parsed = parseLocationQuery(city);
  const countryCode = inferCountryCode(parsed.hintTokens);

  const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geoUrl.searchParams.set('name', parsed.name);
  geoUrl.searchParams.set('count', '20');
  geoUrl.searchParams.set('language', 'en');
  geoUrl.searchParams.set('format', 'json');
  if (countryCode) {
    geoUrl.searchParams.set('countryCode', countryCode);
  }

  const geoData = await fetchJson(geoUrl.toString());
  const results = Array.isArray(geoData.results) ? geoData.results : [];
  const place = results.length <= 1
    ? results[0]
    : [...results].sort((left, right) => (
      scorePlace(right, parsed.name, parsed.hintTokens) - scorePlace(left, parsed.name, parsed.hintTokens)
    ))[0];

  if (!place) {
    throw new Error(`Could not find city: ${parsed.raw}`);
  }

  return {
    name: [place.name, place.admin1].filter(Boolean).join(', ') || place.name,
    latitude: place.latitude,
    longitude: place.longitude
  };
}

async function getCurrentWeather({ city, unit }) {
  const place = await geocodeCity(city);
  const normalizedUnit = String(unit || 'F').toUpperCase() === 'C' ? 'C' : 'F';

  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  weatherUrl.searchParams.set('latitude', String(place.latitude));
  weatherUrl.searchParams.set('longitude', String(place.longitude));
  weatherUrl.searchParams.set('current', 'temperature_2m,weather_code');
  weatherUrl.searchParams.set(
    'temperature_unit',
    normalizedUnit === 'C' ? 'celsius' : 'fahrenheit'
  );
  weatherUrl.searchParams.set('timezone', 'auto');

  const weatherData = await fetchJson(weatherUrl.toString());
  const current = weatherData.current;

  if (!current) {
    throw new Error('No current weather data available.');
  }

  return {
    city: place.name,
    temp: Math.round(current.temperature_2m),
    unit: normalizedUnit,
    summary: mapWeatherCode(current.weather_code),
    icon: mapWeatherIcon(current.weather_code)
  };
}

module.exports = {
  getCurrentWeather
};
