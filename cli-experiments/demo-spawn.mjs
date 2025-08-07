#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

const isBun = typeof Bun !== 'undefined';

function getCommandFromArgs() {
  const provided = process.argv.slice(2).join(' ').trim();
  if (provided) return provided;
  return 'for i in $(seq 1 8); do echo "out $i"; echo "err $i" 1>&2; sleep 0.15; done';
}

async function runWithBun(commandString) {
  const subprocess = Bun.spawn(['sh', '-lc', commandString], {
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const stdoutChunks = [];
  const stderrChunks = [];

  const pump = async (readable, onChunk) => {
    if (!readable) return;
    for await (const chunk of readable) {
      onChunk(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
  };

  const outPump = pump(subprocess.stdout, (chunk) => {
    stdoutChunks.push(chunk);
    process.stdout.write(chunk);
  });
  const errPump = pump(subprocess.stderr, (chunk) => {
    stderrChunks.push(chunk);
    process.stderr.write(chunk);
  });

  const exitCode = await subprocess.exited;
  await Promise.all([outPump, errPump]);

  return {
    code: exitCode,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8')
  };
}

async function runWithNode(commandString) {
  const { spawn } = await import('child_process');
  return await new Promise((resolve) => {
    const cp = spawn('sh', ['-lc', commandString], {
      stdio: ['inherit', 'pipe', 'pipe']
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    cp.stdout.on('data', (data) => {
      stdoutChunks.push(data);
      process.stdout.write(data);
    });
    cp.stderr.on('data', (data) => {
      stderrChunks.push(data);
      process.stderr.write(data);
    });

    cp.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      });
    });
  });
}

const commandString = getCommandFromArgs();
console.log(`Running (stdin: inherit, stdout/stderr: capture+mirror):\n  ${commandString}`);

const result = isBun ? await runWithBun(commandString) : await runWithNode(commandString);

console.log('\n--- Captured summary ---');
console.log(`Exit code: ${result.code}`);
console.log(`Captured stdout bytes: ${Buffer.byteLength(result.stdout, 'utf8')}`);
console.log(`Captured stderr bytes: ${Buffer.byteLength(result.stderr, 'utf8')}`);

// Example analysis hook: count lines
const stdoutLines = result.stdout.split('\n').filter(Boolean).length;
const stderrLines = result.stderr.split('\n').filter(Boolean).length;
console.log(`Stdout lines: ${stdoutLines}, Stderr lines: ${stderrLines}`);

// Exit with child's code
process.exit(Number.isFinite(result.code) ? result.code : 0);


