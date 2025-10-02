#!/usr/bin/env node

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const { fileURLToPath } = await use('url');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let currentLocale = 'en';
let translations = {};
let fallbackTranslations = {};

export function detectLocale() {
  const envLocale = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || '';

  if (envLocale.toLowerCase().startsWith('ru')) {
    return 'ru';
  }

  return 'en';
}

export async function loadTranslations(locale) {
  const translationsDir = path.join(__dirname, 'locales');
  const translationFile = path.join(translationsDir, `${locale}.json`);
  const fallbackFile = path.join(translationsDir, 'en.json');

  try {
    const translationData = await fs.readFile(translationFile, 'utf-8');
    translations = JSON.parse(translationData);
  } catch (error) {
    translations = {};
  }

  try {
    const fallbackData = await fs.readFile(fallbackFile, 'utf-8');
    fallbackTranslations = JSON.parse(fallbackData);
  } catch (error) {
    fallbackTranslations = {};
  }

  currentLocale = locale;
}

export async function initI18n(locale = null) {
  const detectedLocale = locale || detectLocale();
  await loadTranslations(detectedLocale);
  return detectedLocale;
}

export function t(key, params = {}) {
  let translation = translations[key] || fallbackTranslations[key] || key;

  Object.keys(params).forEach(paramKey => {
    const regex = new RegExp(`{{${paramKey}}}`, 'g');
    translation = translation.replace(regex, params[paramKey]);
  });

  return translation;
}

export function getCurrentLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  currentLocale = locale;
}
