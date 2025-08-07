#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"

import $, { sh, exec, run } from './$.mjs';

console.log('1) Tagged template with mirror+capture');
const r1 = await $`echo hello && echo err 1>&2`;
console.log('[r1]', r1.code, r1.stdout.trim(), r1.stderr.trim());

console.log('\n2) run() capture-only');
const r2 = await run('printf "alpha\nbeta\n"');
console.log('[r2]', r2.code, JSON.stringify(r2.stdout));

console.log('\n3) exec() with provided stdin, mirror on');
const r3 = await exec('awk', ['{print toupper($0); print toupper($0) > "/dev/stderr"}'], { stdin: 'one\nTwo\n' });
console.log('[r3]', r3.code, r3.stdout.split('\n').length - 1, 'lines');


