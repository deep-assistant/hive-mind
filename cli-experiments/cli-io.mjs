#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

const isBun = typeof Bun !== 'undefined';

function parseArgs() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    // Default to exec-mode awk
    return { mode: 'exec', file: 'awk', args: ['{print; print > "/dev/stderr"}'] };
  }
  // Shell mode: -c/--cmd "command string"
  if (argv[0] === '-c' || argv[0] === '--cmd') {
    const cmdString = argv.slice(1).join(' ').trim();
    if (!cmdString) throw new Error('Expected a command string after -c/--cmd');
    return { mode: 'shell', command: cmdString };
  }
  // Exec mode: first token is file, rest are args
  const [file, ...args] = argv;
  return { mode: 'exec', file, args };
}

async function runWithBun(parsed) {
  const spawnArgs = parsed.mode === 'shell'
    ? ['sh', '-lc', parsed.command]
    : [parsed.file, ...parsed.args];
  const child = Bun.spawn(spawnArgs, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });

  const captured = { inChunks: [], outChunks: [], errChunks: [] };

  // Prepare writer for child's stdin (Bun uses Web Streams)
  let writer = null;
  if (child.stdin && typeof child.stdin.getWriter === 'function') {
    writer = child.stdin.getWriter();
  }

  // Tee our stdin -> child.stdin, capture as we go
  const inputPump = (async () => {
    for await (const chunk of process.stdin) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      captured.inChunks.push(buf);
      if (writer) {
        await writer.write(buf);
      } else if (child.stdin && typeof child.stdin.write === 'function') {
        child.stdin.write(buf);
      } else if (typeof Bun?.write === 'function') {
        await Bun.write(child.stdin, buf);
      }
    }
    // Close child's stdin when our stdin ends
    if (writer) {
      await writer.close();
    } else if (child.stdin && typeof child.stdin.end === 'function') {
      child.stdin.end();
    }
  })();

  // Mirror+capture stdout
  const outPump = (async () => {
    for await (const chunk of child.stdout) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      captured.outChunks.push(buf);
      process.stdout.write(buf);
    }
  })();

  // Mirror+capture stderr
  const errPump = (async () => {
    for await (const chunk of child.stderr) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      captured.errChunks.push(buf);
      process.stderr.write(buf);
    }
  })();

  const exitCode = await child.exited;
  await Promise.all([inputPump, outPump, errPump]);

  return {
    code: exitCode,
    stdin: Buffer.concat(captured.inChunks).toString('utf8'),
    stdout: Buffer.concat(captured.outChunks).toString('utf8'),
    stderr: Buffer.concat(captured.errChunks).toString('utf8')
  };
}

async function runWithNode(parsed) {
  const { spawn } = await import('child_process');
  return await new Promise((resolve) => {
    const child = parsed.mode === 'shell'
      ? spawn('sh', ['-lc', parsed.command], { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(parsed.file, parsed.args, { stdio: ['pipe', 'pipe', 'pipe'] });

    const inChunks = [];
    const outChunks = [];
    const errChunks = [];

    // Tee stdin
    process.stdin.on('data', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      inChunks.push(buf);
      child.stdin.write(buf);
    });
    process.stdin.on('end', () => {
      child.stdin.end();
    });

    // Mirror+capture stdout/stderr
    child.stdout.on('data', (data) => {
      outChunks.push(data);
      process.stdout.write(data);
    });
    child.stderr.on('data', (data) => {
      errChunks.push(data);
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdin: Buffer.concat(inChunks).toString('utf8'),
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8')
      });
    });
  });
}

const parsed = parseArgs();
console.log('Running with stdin tee (capture+forward) and output mirror (capture+display):');
if (parsed.mode === 'shell') console.log(`  [shell] ${parsed.command}`);
else console.log(`  [exec] ${[parsed.file, ...parsed.args].join(' ')}`);

const result = isBun ? await runWithBun(parsed) : await runWithNode(parsed);

console.log('\n--- Captured IO summary ---');
console.log(`Exit code: ${result.code}`);
console.log(`stdin bytes: ${Buffer.byteLength(result.stdin, 'utf8')}, lines: ${result.stdin ? result.stdin.split('\n').filter(Boolean).length : 0}`);
console.log(`stdout bytes: ${Buffer.byteLength(result.stdout, 'utf8')}, lines: ${result.stdout ? result.stdout.split('\n').filter(Boolean).length : 0}`);
console.log(`stderr bytes: ${Buffer.byteLength(result.stderr, 'utf8')}, lines: ${result.stderr ? result.stderr.split('\n').filter(Boolean).length : 0}`);

process.exit(Number.isFinite(result.code) ? result.code : 0);


