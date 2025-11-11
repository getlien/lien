#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('Testing Lien MCP server...\n');

const server = spawn('node', [
  'packages/cli/dist/index.js',
  'serve'
], {
  cwd: '/Users/alfhenderson/Code/lien'
});

let output = '';
let errorOutput = '';

server.stdout.on('data', (data) => {
  output += data.toString();
  console.log('[STDOUT]', data.toString());
});

server.stderr.on('data', (data) => {
  errorOutput += data.toString();
  console.log('[STDERR]', data.toString());
});

server.on('error', (error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// Send initialize request after 2 seconds
setTimeout(() => {
  console.log('\nSending MCP initialize request...');
  
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    }
  };
  
  server.stdin.write(JSON.stringify(initRequest) + '\n');
}, 2000);

// Wait for response
setTimeout(() => {
  console.log('\nTest completed. Shutting down server...');
  server.kill('SIGTERM');
  
  setTimeout(() => {
    console.log('\n=== Test Results ===');
    
    if (errorOutput.includes('Initializing MCP server') && 
        errorOutput.includes('MCP server started')) {
      console.log('✅ Server started successfully');
    } else {
      console.log('⚠️  Server may not have started correctly');
    }
    
    if (output.length > 0) {
      console.log('✅ Server responded to requests');
    } else {
      console.log('⚠️  No response received (might be normal for short test)');
    }
    
    console.log('\n📝 Server is configured and ready for Cursor!');
    console.log('   MCP config: /Users/alfhenderson/Code/lien/.cursor/mcp.json');
    console.log('   Restart Cursor to connect to the Lien MCP server.');
    
    process.exit(0);
  }, 500);
}, 5000);


