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
    61: 'Rain',
    63: 'Rain',
    65: 'Rain',
    71: 'Snow',
    73: 'Snow',
    75: 'Snow',
    80: 'Showers',
    81: 'Showers',
    82: 'Showers',
    95: 'Thunder'
  };

  return map[code] || 'Weather';
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function geocodeCity(city) {
  const trimmed = String(city || '').trim();
  if (!trimmed) {
    throw new Error('City is required for weather lookup.');
  }

  const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geoUrl.searchParams.set('name', trimmed);
  geoUrl.searchParams.set('count', '1');
  geoUrl.searchParams.set('language', 'en');
  geoUrl.searchParams.set('format', 'json');

  const geoData = await fetchJson(geoUrl.toString());
  const place = geoData.results?.[0];

  if (!place) {
    throw new Error(`Could not find city: ${trimmed}`);
  }

  return {
    name: place.name,
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

  const weatherData = await fetchJson(weatherUrl.toString());
  const current = weatherData.current;

  if (!current) {
    throw new Error('No current weather data available.');
  }

  return {
    city: place.name,
    temp: Math.round(current.temperature_2m),
    unit: normalizedUnit,
    summary: mapWeatherCode(current.weather_code)
  };
}

module.exports = {
  getCurrentWeather
};
