#!/usr/bin/env node
/**
 * Minimal stdio MCP client for the foreign-repo dogfood.
 *
 * Phase 1 has to exercise the SIX REAL MCP TOOLS as an MCP client sees them —
 * schema validation, error envelopes, content encoding and all — against a corpus
 * repo. Calling the handler functions directly would skip exactly the layer most
 * likely to be wrong, and the session's own MCP server is bound to the Lien repo,
 * which control C1 forbids as a measurement target.
 *
 *   node mcp-call.mjs <repoDir> <toolName> '<jsonArgs>'
 *   node mcp-call.mjs <repoDir> --list
 *
 * Prints a JSON envelope: { ok, ms, tool, args, result?, error? }. Non-zero exit
 * only on harness failure (spawn/connect); a tool-level error is a successful
 * measurement and exits 0 with ok:false.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';

const [repoDir, tool, rawArgs] = process.argv.slice(2);
const REPO = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO, 'packages/cli/dist/index.js');

function die(msg) {
  console.error(`mcp-call: ${msg}`);
  process.exit(1);
}

if (!repoDir || !tool) die("usage: mcp-call.mjs <repoDir> <toolName|--list> '<jsonArgs>'");
if (!fs.existsSync(repoDir)) die(`repoDir does not exist: ${repoDir}`);
if (!fs.existsSync(CLI)) die(`CLI not built at ${CLI}`);

// C1: refuse to measure anything inside the Lien checkout, whatever the caller asked.
const resolved = fs.realpathSync(repoDir);
if (resolved === fs.realpathSync(REPO) || resolved.startsWith(fs.realpathSync(REPO) + path.sep)) {
  die(`C1 VIOLATION: ${resolved} is inside the Lien repo — measurements there are void`);
}

let args = {};
if (rawArgs) {
  try {
    args = JSON.parse(rawArgs);
  } catch (e) {
    die(`args are not valid JSON: ${e.message}`);
  }
}

const transport = new StdioClientTransport({
  command: 'node',
  args: [CLI, 'serve'],
  cwd: resolved,
  env: { ...process.env, FORCE_COLOR: '0' },
  stderr: 'pipe',
});

const client = new Client({ name: 'dogfood-mcp-call', version: '1.0.0' }, { capabilities: {} });

const t0 = process.hrtime.bigint();
const elapsed = () => Number((process.hrtime.bigint() - t0) / 1_000_000n);

try {
  await client.connect(transport);

  if (tool === '--list') {
    const tools = await client.listTools();
    console.log(
      JSON.stringify(
        {
          ok: true,
          ms: elapsed(),
          serverInstructions: client.getInstructions?.() ?? null,
          tools: tools.tools.map(t => ({ name: t.name, inputSchema: t.inputSchema })),
        },
        null,
        2,
      ),
    );
  } else {
    let envelope;
    try {
      const res = await client.callTool({ name: tool, arguments: args });
      envelope = { ok: !res.isError, ms: elapsed(), tool, args, result: res };
    } catch (e) {
      // Protocol-level rejection (unknown tool, schema validation) — a real
      // measurement of the tool's failure mode, not a harness fault.
      envelope = {
        ok: false,
        ms: elapsed(),
        tool,
        args,
        error: { name: e.name, message: e.message, code: e.code },
      };
    }
    console.log(JSON.stringify(envelope, null, 2));
  }
} catch (e) {
  console.error(`mcp-call: transport/connect failure: ${e.message}`);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
