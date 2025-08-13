#!/usr/bin/env sh
':' //# ; exec "$(command -v node || command -v bun)" "$0" "$@"

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $, sh, exec, run, quote, raw } = await use('command-stream');

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}
function show(title) { console.log(`\n## ${title}`); }

// 1) Tagged template: mirror+capture
show('Tagged template: mirror+capture');
{
  const r = await $`echo out && echo err 1>&2`;
  assert(r.code === 0, 'tagged exit code');
  assert(r.stdout.trim() === 'out', `tagged stdout expected 'out', got ${JSON.stringify(r.stdout)}`);
  assert(r.stderr.trim() === 'err', `tagged stderr expected 'err', got ${JSON.stringify(r.stderr)}`);
}

// 2) sh(): command string with stdin (string)
show('sh(): stdin string -> cat');
{
  const r = await sh('cat', { stdin: 'hi\n', mirror: false });
  assert(r.code === 0, 'sh exit code');
  assert(r.stdout === 'hi\n', `sh stdout expected 'hi\\n', got ${JSON.stringify(r.stdout)}`);
}

// 3) exec(): file+args with stdin (string), stderr capture
show('exec(): awk uppercases and duplicates to stderr');
{
  const program = '{print toupper($0); print toupper($0) > "/dev/stderr"}';
  const r = await exec('awk', [program], { stdin: 'a\nb\n', mirror: false });
  assert(r.code === 0, 'exec exit code');
  assert(r.stdout === 'A\nB\n', `exec stdout expected 'A\\nB\\n', got ${JSON.stringify(r.stdout)}`);
  assert(r.stderr === 'A\nB\n', `exec stderr expected 'A\\nB\\n', got ${JSON.stringify(r.stderr)}`);
}

// 4) run(): capture-only
show('run(): capture-only');
{
  const r = await run('printf foo');
  assert(r.code === 0, 'run exit code');
  assert(r.stdout === 'foo', `run stdout expected 'foo', got ${JSON.stringify(r.stdout)}`);
}

// 5) Template quoting
show('template quoting');
{
  const withSpace = 'a b';
  const r = await $`printf %s ${withSpace}`; // should pass as single arg
  assert(r.code === 0, 'quote exit code');
  assert(r.stdout === withSpace, `quote stdout expected ${JSON.stringify(withSpace)}, got ${JSON.stringify(r.stdout)}`);
}

// 6) raw() in template
show('template raw');
{
  const r = await $`echo ${raw('hello')}`;
  assert(r.code === 0, 'raw exit code');
  assert(r.stdout.trim() === 'hello', `raw stdout expected 'hello', got ${JSON.stringify(r.stdout)}`);
}

// 7) spawnStream(): streaming with final capture
show('spawnStream(): short shell loop');
{
  const ctl = spawnStream({ mode: 'shell', command: 'for i in 1 2 3; do echo X$i; done' }, { mirror: false });
  const r = await ctl.done;
  assert(r.code === 0, 'spawnStream exit code');
  assert(r.stdout.trim() === 'X1\nX2\nX3'.replace(/\\n/g, '\n'), `spawnStream stdout mismatch: ${JSON.stringify(r.stdout)}`);
}

// 8) inherit stdin on TTY should not hang (cat should exit with EOF)
show("inherit 'stdin' on TTY closes immediately");
{
  const r = await exec('cat', [], { stdin: 'inherit', mirror: false });
  assert(r.code === 0, 'cat exit code');
  assert(r.stdout === '', `cat stdout expected empty, got ${JSON.stringify(r.stdout)}`);
}

// 9) stdin Buffer
show('stdin Buffer');
{
  const r = await exec('cat', [], { stdin: Buffer.from('buf\n'), mirror: false });
  assert(r.code === 0, 'buffer exit code');
  assert(r.stdout === 'buf\n', `buffer stdout mismatch: ${JSON.stringify(r.stdout)}`);
}

// 10) stdin Readable stream
show('stdin Readable stream');
{
  const { Readable } = await import('stream');
  const readable = Readable.from(['x', 'y', 'z', '\n']);
  const r = await exec('cat', [], { stdin: readable, mirror: false });
  assert(r.code === 0, 'readable exit code');
  assert(r.stdout === 'xyz\n', `readable stdout mismatch: ${JSON.stringify(r.stdout)}`);
}

console.log(`\n=== TEST RESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'} ===`);
if (failures.length) {
  for (const f of failures) console.log('- ' + f);
  process.exit(1);
}

