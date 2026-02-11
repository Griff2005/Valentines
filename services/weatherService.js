'use strict';

function normalizeUnit(unit) {
  return String(unit || 'F').toUpperCase() === 'C' ? 'C' : 'F';
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTemp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error('Weather service returned an invalid temperature.');
  }
  return Math.round(number);
}

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

function mapWeatherIconFromCode(code) {
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

function mapWeatherIconFromText(summary) {
  const text = normalizeText(summary).toLowerCase();
  if (!text) {
    return 'cloud';
  }

  if (/(thunder|lightning|storm)/.test(text)) {
    return 'storm';
  }

  if (/(snow|sleet|blizzard|flurr|ice|freezing)/.test(text)) {
    return 'snow';
  }

  if (/(rain|drizzle|shower)/.test(text)) {
    return 'rain';
  }

  if (/(fog|mist|haze|smoke)/.test(text)) {
    return 'fog';
  }

  if (/(cloud|overcast)/.test(text)) {
    return 'cloud';
  }

  if (/(sun|clear)/.test(text)) {
    return 'sun';
  }

  return 'cloud';
}

async function fetchJson(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...extraHeaders
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function parseLocationQuery(city) {
  const trimmed = normalizeText(city);
  if (!trimmed) {
    throw new Error('City is required for weather lookup.');
  }

  const parts = trimmed.split(',').map((part) => normalizeText(part)).filter(Boolean);
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
  const name = normalizeText(place?.name).toLowerCase();
  const admin1 = normalizeText(place?.admin1).toLowerCase();
  const admin2 = normalizeText(place?.admin2).toLowerCase();
  const country = normalizeText(place?.country).toLowerCase();
  const countryCode = normalizeText(place?.country_code).toUpperCase();
  const text = `${name} ${admin1} ${admin2} ${country} ${countryCode.toLowerCase()}`;
  const query = normalizeText(queryName).toLowerCase();

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

async function geocodeCityOpenMeteo(city) {
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
    city: [place.name, place.admin1].filter(Boolean).join(', ') || place.name,
    latitude: place.latitude,
    longitude: place.longitude
  };
}

async function getWeatherFromOpenMeteo({ city, unit }) {
  const place = await geocodeCityOpenMeteo(city);

  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  weatherUrl.searchParams.set('latitude', String(place.latitude));
  weatherUrl.searchParams.set('longitude', String(place.longitude));
  weatherUrl.searchParams.set('current', 'temperature_2m,weather_code');
  weatherUrl.searchParams.set('temperature_unit', unit === 'C' ? 'celsius' : 'fahrenheit');
  weatherUrl.searchParams.set('timezone', 'auto');

  const weatherData = await fetchJson(weatherUrl.toString());
  const current = weatherData.current;
  if (!current) {
    throw new Error('No current weather data available.');
  }

  return {
    city: place.city,
    temp: normalizeTemp(current.temperature_2m),
    unit,
    summary: mapWeatherCode(current.weather_code),
    icon: mapWeatherIconFromCode(current.weather_code)
  };
}

function formatWttrLocation(area) {
  const city = normalizeText(area?.areaName?.[0]?.value);
  const region = normalizeText(area?.region?.[0]?.value);
  const country = normalizeText(area?.country?.[0]?.value);
  return [city, region || country].filter(Boolean).join(', ') || city || '';
}

async function getWeatherFromWttr({ city, unit }) {
  const location = normalizeText(city);
  if (!location) {
    throw new Error('City is required for weather lookup.');
  }

  const wttrUrl = new URL(`https://wttr.in/${encodeURIComponent(location)}`);
  wttrUrl.searchParams.set('format', 'j1');

  const data = await fetchJson(
    wttrUrl.toString(),
    { 'User-Agent': 'LydaBoardRemote/1.0 (weather lookup)' }
  );

  const current = Array.isArray(data?.current_condition) ? data.current_condition[0] : null;
  if (!current) {
    throw new Error('No current weather data available.');
  }

  const nearestArea = Array.isArray(data?.nearest_area) ? data.nearest_area[0] : null;
  const description = normalizeText(current.weatherDesc?.[0]?.value) || 'Weather';
  const tempRaw = unit === 'C' ? current.temp_C : current.temp_F;

  return {
    city: formatWttrLocation(nearestArea) || location,
    temp: normalizeTemp(tempRaw),
    unit,
    summary: description,
    icon: mapWeatherIconFromText(description)
  };
}

async function getCurrentWeather({ city, unit }) {
  const normalizedUnit = normalizeUnit(unit);
  const location = normalizeText(city);

  if (!location) {
    throw new Error('City is required for weather lookup.');
  }

  try {
    return await getWeatherFromWttr({
      city: location,
      unit: normalizedUnit
    });
  } catch (wttrError) {
    try {
      return await getWeatherFromOpenMeteo({
        city: location,
        unit: normalizedUnit
      });
    } catch (openMeteoError) {
      throw new Error(
        `Weather lookup failed. wttr.in: ${wttrError.message}. Open-Meteo: ${openMeteoError.message}.`
      );
    }
  }
}

module.exports = {
  getCurrentWeather
};
