#!/usr/bin/env node

import { initI18n, t, getCurrentLocale, detectLocale } from '../src/i18n.lib.mjs';

async function testI18n() {
  console.log('🧪 Testing i18n functionality...\n');

  console.log('1. Testing locale detection...');
  const detectedLocale = detectLocale();
  console.log(`   Detected locale: ${detectedLocale}`);
  console.log(`   Environment LANG: ${process.env.LANG || 'not set'}`);
  console.log('   ✅ Locale detection works\n');

  console.log('2. Testing English translations...');
  await initI18n('en');
  console.log(`   Current locale: ${getCurrentLocale()}`);
  console.log(`   Translation test: ${t('error')}`);
  console.log(`   Expected: Error`);
  if (t('error') !== 'Error') {
    console.error('   ❌ English translation failed!');
    process.exit(1);
  }
  console.log('   ✅ English translations work\n');

  console.log('3. Testing Russian translations...');
  await initI18n('ru');
  console.log(`   Current locale: ${getCurrentLocale()}`);
  console.log(`   Translation test: ${t('error')}`);
  console.log(`   Expected: Ошибка`);
  if (t('error') !== 'Ошибка') {
    console.error('   ❌ Russian translation failed!');
    process.exit(1);
  }
  console.log('   ✅ Russian translations work\n');

  console.log('4. Testing parameter substitution...');
  await initI18n('en');
  const translatedWithParam = t('error.url_type_not_supported', { type: 'test-type' });
  console.log(`   Translation: ${translatedWithParam}`);
  console.log(`   Expected: URL type 'test-type' is not supported`);
  if (translatedWithParam !== "URL type 'test-type' is not supported") {
    console.error('   ❌ Parameter substitution failed!');
    process.exit(1);
  }
  console.log('   ✅ Parameter substitution works\n');

  console.log('5. Testing fallback for missing keys...');
  await initI18n('ru');
  const missingKey = t('non.existent.key');
  console.log(`   Translation: ${missingKey}`);
  console.log(`   Expected: non.existent.key (fallback to key)`);
  if (missingKey !== 'non.existent.key') {
    console.error('   ❌ Fallback failed!');
    process.exit(1);
  }
  console.log('   ✅ Fallback works\n');

  console.log('6. Testing complex Russian translation...');
  await initI18n('ru');
  const complexTranslation = t('warning.could_not_check_fork_status', { message: 'тестовое сообщение' });
  console.log(`   Translation: ${complexTranslation}`);
  console.log(`   Expected: Предупреждение: Не удалось проверить статус форка: тестовое сообщение`);
  if (complexTranslation !== 'Предупреждение: Не удалось проверить статус форка: тестовое сообщение') {
    console.error('   ❌ Complex Russian translation failed!');
    process.exit(1);
  }
  console.log('   ✅ Complex Russian translation works\n');

  console.log('7. Testing auto-initialization with system locale...');
  const autoLocale = await initI18n();
  console.log(`   Auto-detected locale: ${autoLocale}`);
  console.log(`   Current locale: ${getCurrentLocale()}`);
  console.log('   ✅ Auto-initialization works\n');

  console.log('✅ All i18n tests passed successfully!');
}

testI18n().catch(error => {
  console.error('❌ Test failed with error:', error);
  process.exit(1);
});
