#!/usr/bin/env node
// Boot-probes a Lien MCP server over stdio: spawns the given command, sends
// a JSON-RPC `initialize` request on stdin, and asserts a response arrives
// within a timeout.
//
// On failure it prints the child's raw stderr. This matters specifically
// because a real MCP client (e.g. Claude Code) wraps a dead/crashed server
// connection in a generic "-32000 Internal error" and swallows the actual
// cause -- that masking is exactly what hid the 0.55.0/0.56.0
// sibling-version-skew incident (a missing-export SyntaxError at import
// time) until a human ran the server by hand. Surfacing stderr here is the
// whole point of this probe.
//
// Usage: node mcp-initialize-probe.mjs <command> [args...]
// Env:   MCP_PROBE_TIMEOUT_MS (default 90000)

import { spawn } from 'node:child_process';

const [, , command, ...args] = process.argv;
if (!command) {
  console.error('Usage: mcp-initialize-probe.mjs <command> [args...]');
  process.exit(1);
}

const TIMEOUT_MS = Number(process.env.MCP_PROBE_TIMEOUT_MS ?? 90_000);

const request = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'lien-registry-smoke', version: '1.0.0' },
  },
};

const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });

let stdoutBuf = Buffer.alloc(0);
let stderrBuf = '';
let settled = false;

function printStderr() {
  if (stderrBuf.trim()) {
    console.error('\n--- child stderr (the real error a client would mask as -32000) ---');
    console.error(stderrBuf.trim());
    console.error('--- end child stderr ---\n');
  } else {
    console.error('(child produced no stderr output)');
  }
}

function fail(message) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  console.error(`FAIL: ${message}`);
  printStderr();
  child.kill('SIGKILL');
  process.exitCode = 1;
}

function succeed(serverInfo) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  console.log(`OK: received initialize response from ${JSON.stringify(serverInfo)}`);
  child.kill('SIGKILL');
  process.exitCode = 0;
}

const timer = setTimeout(() => {
  fail(`no initialize response within ${TIMEOUT_MS}ms`);
}, TIMEOUT_MS);

child.on('error', error => {
  fail(`failed to spawn '${command}': ${error.message}`);
});

child.on('exit', (code, signal) => {
  if (!settled) {
    fail(`child exited early (code=${code}, signal=${signal}) before responding`);
  }
});

child.stderr.on('data', chunk => {
  stderrBuf += chunk.toString('utf8');
});

child.stdout.on('data', chunk => {
  stdoutBuf = Buffer.concat([stdoutBuf, chunk]);

  let index;
  while ((index = stdoutBuf.indexOf('\n')) !== -1) {
    const line = stdoutBuf.subarray(0, index).toString('utf8').replace(/\r$/, '');
    stdoutBuf = stdoutBuf.subarray(index + 1);
    if (!line.trim()) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      // Not a JSON-RPC frame (Lien logs go to stderr, but be lenient about
      // any stray stdout noise from dependencies).
      continue;
    }

    if (message.id !== request.id) continue;

    if (message.error) {
      fail(`server returned a JSON-RPC error: ${JSON.stringify(message.error)}`);
      return;
    }

    succeed(message.result?.serverInfo ?? message.result ?? message);
    return;
  }
});

child.stdin.write(JSON.stringify(request) + '\n');
