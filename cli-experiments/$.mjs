// Cross-runtime $ shell utilities with streaming + capture (Bun-first, Node fallback)
// Exports:
// - default export: $ tagged template -> runs via shell, mirrors output to terminal and captures
// - sh(commandString, options)
// - exec(file, args, options)
// - run(commandOrTokens, options) -> capture-only convenience
// - spawnStream(spec, options) -> low-level streaming control
// - quote(value) -> shell-escape helper for template interpolation
// - create(defaultOptions) -> returns a configured $-like tagged template
// - raw(value) -> mark value as unquoted in templates

const isBun = typeof globalThis.Bun !== 'undefined';

function quote(value) {
  if (value == null) return "''";
  if (Array.isArray(value)) return value.map(quote).join(' ');
  if (typeof value !== 'string') value = String(value);
  if (value === '') return "''";
  // Single-quote escaping: close, add \', reopen
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildShellCommand(strings, values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      // Allow raw tokens via {raw: string} to opt out of quoting
      if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'raw')) {
        out += String(v.raw);
      } else {
        out += quote(v);
      }
    }
  }
  return out;
}

function normalizeReadable(readable) {
  // Both Node streams and Bun WebStreams support async iteration in current runtimes
  return readable;
}

function asBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return Buffer.from(chunk);
}

async function pumpReadable(readable, onChunk) {
  if (!readable) return;
  for await (const chunk of normalizeReadable(readable)) {
    await onChunk(asBuffer(chunk));
  }
}

async function pumpStdinTo(child, captureChunks) {
  // Default: tee process.stdin -> child.stdin and capture
  if (!child.stdin) return;
  // Bun: WritableStream; Node: stream.Writable
  const bunWriter = isBun && child.stdin && typeof child.stdin.getWriter === 'function' ? child.stdin.getWriter() : null;
  for await (const chunk of process.stdin) {
    const buf = asBuffer(chunk);
    captureChunks && captureChunks.push(buf);
    if (bunWriter) await bunWriter.write(buf);
    else if (typeof child.stdin.write === 'function') child.stdin.write(buf);
    else if (isBun && typeof Bun.write === 'function') await Bun.write(child.stdin, buf);
  }
  if (bunWriter) await bunWriter.close();
  else if (typeof child.stdin.end === 'function') child.stdin.end();
}

async function runUnified(spec, options = {}) {
  const {
    mirror = true,
    capture = true,
    stdin = 'inherit', // 'inherit' | 'ignore' | string | Buffer | Readable
    cwd,
    env
  } = options;

  const outChunks = capture ? [] : null;
  const errChunks = capture ? [] : null;
  const inChunks = capture && stdin === 'inherit' ? [] : capture && (typeof stdin === 'string' || Buffer.isBuffer(stdin)) ? [Buffer.from(stdin)] : [];

  const spawnBun = (argv) => {
    return Bun.spawn(argv, { cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  };
  const spawnNode = async (argv) => {
    const cp = await import('child_process');
    return cp.spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  };

  const argv = spec.mode === 'shell' ? ['sh', '-lc', spec.command] : [spec.file, ...spec.args];
  const needsExplicitPipe = stdin !== 'inherit' && stdin !== 'ignore';
  const preferNodeForInput = isBun && needsExplicitPipe; // Node's child_process piping is more predictable for programmatic stdin
  const child = preferNodeForInput ? await spawnNode(argv) : (isBun ? spawnBun(argv) : await spawnNode(argv));

  // Wire stdout/stderr
  const outPump = pumpReadable(child.stdout, async (buf) => {
    if (capture) outChunks.push(buf);
    if (mirror) process.stdout.write(buf);
  });
  const errPump = pumpReadable(child.stderr, async (buf) => {
    if (capture) errChunks.push(buf);
    if (mirror) process.stderr.write(buf);
  });

  // Wire stdin
  let stdinPumpPromise = Promise.resolve();
  if (stdin === 'inherit') {
    const isPipedIn = process.stdin && process.stdin.isTTY === false;
    if (isPipedIn) {
      stdinPumpPromise = pumpStdinTo(child, capture ? inChunks : null);
    } else {
      // Interactive TTY: avoid waiting on stdin to end; close child's stdin immediately
      if (child.stdin && typeof child.stdin.end === 'function') {
        try { child.stdin.end(); } catch {}
      } else if (isBun && child.stdin && typeof child.stdin.getWriter === 'function') {
        try { const w = child.stdin.getWriter(); await w.close(); } catch {}
      }
    }
  } else if (stdin === 'ignore') {
    if (child.stdin && typeof child.stdin.end === 'function') child.stdin.end();
  } else if (typeof stdin === 'string' || Buffer.isBuffer(stdin)) {
    const buf = Buffer.isBuffer(stdin) ? stdin : Buffer.from(stdin);
    if (capture && inChunks) inChunks.push(Buffer.from(buf));
    stdinPumpPromise = (async () => {
      if (isBun && child.stdin && typeof child.stdin.getWriter === 'function') {
        const w = child.stdin.getWriter();
        const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer, buf.byteOffset ?? 0, buf.byteLength);
        await w.write(bytes);
        await w.close();
      } else if (child.stdin && typeof child.stdin.write === 'function') {
        child.stdin.end(buf);
      } else if (isBun && typeof Bun.write === 'function') {
        await Bun.write(child.stdin, buf);
      }
    })();
  } else if (stdin && (typeof stdin[Symbol.asyncIterator] === 'function' || typeof stdin.pipe === 'function')) {
    // Stream input provided
    const writeBuf = async (buf) => {
      if (capture && inChunks) inChunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
      if (isBun && child.stdin && typeof child.stdin.getWriter === 'function') {
        if (!writeBuf._writer) writeBuf._writer = child.stdin.getWriter();
        const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        await writeBuf._writer.write(bytes);
      } else if (child.stdin && typeof child.stdin.write === 'function') {
        child.stdin.write(buf);
      } else if (isBun && typeof Bun.write === 'function') {
        await Bun.write(child.stdin, buf);
      }
    };

    if (typeof stdin[Symbol.asyncIterator] === 'function') {
      // Prefer async iteration to support both Node and Web streams
      stdinPumpPromise = (async () => {
        for await (const chunk of stdin) {
          await writeBuf(chunk);
        }
        if (writeBuf._writer) await writeBuf._writer.close();
        else if (child.stdin && typeof child.stdin.end === 'function') child.stdin.end();
      })();
    } else if (typeof stdin.pipe === 'function') {
      if (capture && inChunks && typeof stdin.on === 'function') {
        stdin.on('data', (d) => inChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      }
      stdin.pipe(child.stdin);
    }
  }

  const exited = isBun ? child.exited : new Promise((resolve) => child.on('close', resolve));
  const code = await exited;
  await Promise.all([outPump, errPump, stdinPumpPromise]);

  const result = {
    code,
    stdout: capture ? Buffer.concat(outChunks).toString('utf8') : undefined,
    stderr: capture ? Buffer.concat(errChunks).toString('utf8') : undefined,
    stdin: capture && inChunks ? Buffer.concat(inChunks).toString('utf8') : undefined,
    child
  };
  return result;
}

// Public APIs
async function sh(commandString, options = {}) {
  return runUnified({ mode: 'shell', command: commandString }, options);
}

async function exec(file, args = [], options = {}) {
  return runUnified({ mode: 'exec', file, args }, options);
}

async function run(commandOrTokens, options = {}) {
  if (typeof commandOrTokens === 'string') return sh(commandOrTokens, { ...options, mirror: false, capture: true });
  const [file, ...args] = commandOrTokens;
  return exec(file, args, { ...options, mirror: false, capture: true });
}

function spawnStream(spec, options = {}) {
  // Fire and expose streams immediately; also provide a done promise for completion
  const controller = {};
  const start = async () => {
    const result = await runUnified(spec, { ...options, capture: true });
    controller.result = result;
    return result;
  };
  controller.done = start();
  return controller;
}

// Tagged template: mirrors output and captures; returns a promise with {code, stdout, stderr}
function $tagged(strings, ...values) {
  const cmd = buildShellCommand(strings, values);
  const p = sh(cmd, { mirror: true, capture: true });
  return p;
}

function create(defaultOptions = {}) {
  const tagged = (strings, ...values) => {
    const cmd = buildShellCommand(strings, values);
    return sh(cmd, { mirror: true, capture: true, ...defaultOptions });
  };
  return tagged;
}

function raw(value) { return { raw: String(value) }; }

export { $tagged as $, sh, exec, run, spawnStream, quote, create, raw };
export default $tagged;


