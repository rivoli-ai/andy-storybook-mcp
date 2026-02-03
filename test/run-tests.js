#!/usr/bin/env node

/**
 * Test suite for Storybook MCP API
 * 
 * Tests both REST API and MCP protocol endpoints
 * Supports unit tests and integration tests with Storybook 8, 9, 10
 * 
 * Usage:
 *   npm test                    # Run unit tests only
 *   npm test -- --integration   # Run integration tests with examples
 *   npm test -- --only test-sb8 # Run specific example test
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

// Parse CLI args
const args = process.argv.slice(2);
const runIntegration = args.includes('--integration');
const onlyIndex = args.indexOf('--only');
const onlyExample = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

const TEST_PORT = 6099;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const EXAMPLES_DIR = path.join(__dirname, '..', 'examples');
const TIMEOUT = 120000; // 2 minutes per integration test

// Test results tracking
let passed = 0;
let failed = 0;
const results = [];

/**
 * Make HTTP request
 */
function request(options) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, options.baseUrl || BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
            raw: data,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: null,
            raw: data,
          });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

/**
 * Test assertion helper
 */
function test(name, fn) {
  return async () => {
    try {
      await fn();
      passed++;
      results.push({ name, status: 'PASS' });
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed++;
      results.push({ name, status: 'FAIL', error: error.message });
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
    }
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertContains(obj, key, message) {
  if (!(key in obj)) {
    throw new Error(message || `Expected object to contain key "${key}"`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// REST API Tests
// ============================================

const restTests = [
  test('GET /api returns documentation', async () => {
    const res = await request({ path: '/api' });
    assertEqual(res.status, 200, 'Status should be 200');
    assert(res.body.success, 'Response should have success: true');
    assertEqual(res.body.name, 'Storybook MCP API', 'Should return correct name');
    assertContains(res.body, 'endpoints', 'Should have endpoints');
    assertContains(res.body.endpoints, 'rest', 'Should have REST endpoints');
    assertContains(res.body.endpoints, 'mcp', 'Should have MCP endpoints');
  }),

  test('GET /api/stories returns stories list', async () => {
    const res = await request({ path: '/api/stories' });
    assert(res.status === 200 || res.status === 503, 'Status should be 200 or 503');
    assertContains(res.body, 'success', 'Should have success field');
  }),

  test('GET /api/stories/:storyId handles missing story', async () => {
    const res = await request({ path: '/api/stories/non-existent-story' });
    assert(res.status === 404 || res.status === 503, 'Status should be 404 or 503');
  }),

  test('GET /api/docs/:storyId handles missing story', async () => {
    const res = await request({ path: '/api/docs/non-existent-story' });
    assert(res.status === 404 || res.status === 503, 'Status should be 404 or 503');
  }),
];

// ============================================
// MCP Protocol Tests
// ============================================

const mcpTests = [
  test('GET /mcp returns server info', async () => {
    const res = await request({ path: '/mcp' });
    assertEqual(res.status, 200, 'Status should be 200');
    assertEqual(res.body.name, 'storybook-mcp-api', 'Should return correct name');
    assertContains(res.body, 'protocolVersion', 'Should have protocol version');
    assertContains(res.body, 'tools', 'Should have tools list');
    assertEqual(res.body.transport, 'streamable-http', 'Should indicate streamable-http transport');
  }),

  test('POST /mcp initialize request', async () => {
    const res = await request({
      path: '/mcp',
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      },
    });
    assertEqual(res.status, 200, 'Status should be 200');
    assertEqual(res.body.jsonrpc, '2.0', 'Should be JSON-RPC 2.0');
    assertEqual(res.body.id, 1, 'Should echo request ID');
    assertContains(res.body, 'result', 'Should have result');
    assertContains(res.body.result, 'capabilities', 'Should have capabilities');
    assertContains(res.body.result, 'serverInfo', 'Should have serverInfo');
  }),

  test('POST /mcp tools/list request', async () => {
    const res = await request({
      path: '/mcp',
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      },
    });
    assertEqual(res.status, 200, 'Status should be 200');
    assertContains(res.body, 'result', 'Should have result');
    assertContains(res.body.result, 'tools', 'Should have tools array');
    assert(Array.isArray(res.body.result.tools), 'Tools should be array');
    assert(res.body.result.tools.length >= 3, 'Should have at least 3 tools');
    
    const toolNames = res.body.result.tools.map(t => t.name);
    assert(toolNames.includes('list_stories'), 'Should have list_stories tool');
    assert(toolNames.includes('get_story'), 'Should have get_story tool');
    assert(toolNames.includes('get_story_docs'), 'Should have get_story_docs tool');
  }),

  test('POST /mcp tools/call list_stories', async () => {
    const res = await request({
      path: '/mcp',
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'list_stories',
          arguments: {},
        },
      },
    });
    assertEqual(res.status, 200, 'Status should be 200');
    assertContains(res.body, 'result', 'Should have result');
    assertContains(res.body.result, 'content', 'Should have content');
    assert(Array.isArray(res.body.result.content), 'Content should be array');
    assertEqual(res.body.result.content[0].type, 'text', 'Content type should be text');
  }),

  test('POST /mcp resources/list request', async () => {
    const res = await request({
      path: '/mcp',
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/list',
      },
    });
    assertEqual(res.status, 200, 'Status should be 200');
    assertContains(res.body, 'result', 'Should have result');
    assertContains(res.body.result, 'resources', 'Should have resources array');
    assert(Array.isArray(res.body.result.resources), 'Resources should be array');
  }),

  test('POST /mcp ping request', async () => {
    const res = await request({
      path: '/mcp',
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 5,
        method: 'ping',
      },
    });
    assertEqual(res.status, 200, 'Status should be 200');
    assertContains(res.body, 'result', 'Should have result');
  }),

  test('POST /mcp unknown method returns error', async () => {
    const res = await request({
      path: '/mcp',
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 6,
        method: 'unknown/method',
      },
    });
    assertEqual(res.status, 200, 'Status should be 200');
    assertContains(res.body, 'error', 'Should have error');
    assertEqual(res.body.error.code, -32601, 'Should be method not found error');
  }),

  test('POST /mcp tools/call unknown tool returns error', async () => {
    const res = await request({
      path: '/mcp',
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      },
    });
    assertEqual(res.status, 200, 'Status should be 200');
    assertContains(res.body, 'error', 'Should have error');
  }),
];

// ============================================
// SSE Transport Tests
// ============================================

const sseTests = [
  test('GET /sse returns SSE stream', async () => {
    return new Promise((resolve, reject) => {
      const url = new URL('/sse', BASE_URL);
      const req = http.get(url, (res) => {
        assertEqual(res.statusCode, 200, 'Status should be 200');
        assertEqual(res.headers['content-type'], 'text/event-stream', 'Should be event-stream');
        
        let data = '';
        res.on('data', chunk => {
          data += chunk.toString();
          if (data.includes('event: endpoint')) {
            // Verify it points to /sse/messages
            assert(data.includes('/sse/messages'), 'Should point to /sse/messages endpoint');
            req.destroy();
            resolve();
          }
        });

        setTimeout(() => {
          req.destroy();
          if (data.includes('event: endpoint')) {
            resolve();
          } else {
            reject(new Error('Did not receive endpoint event'));
          }
        }, 2000);
      });

      req.on('error', (err) => {
        if (err.code !== 'ECONNRESET') {
          reject(err);
        }
      });
    });
  }),
];

// ============================================
// Integration Tests with Storybook Examples
// ============================================

const examples = [
  { name: 'test-sb8', expectedVersion: 8, port: 6008 },
  { name: 'test-sb9', expectedVersion: 9, port: 6009 },
  { name: 'test-sb10', expectedVersion: 10, port: 6010 },
];

async function testExample(example) {
  const { name, expectedVersion, port } = example;
  const exampleDir = path.join(EXAMPLES_DIR, name);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${name} (Storybook ${expectedVersion})`);
  console.log(`${'='.repeat(60)}`);

  const result = {
    name,
    expectedVersion,
    actualVersion: null,
    versionMatch: false,
    restApiWorking: false,
    mcpWorking: false,
    storiesCount: 0,
    errors: [],
  };

  // Check if example exists
  if (!fs.existsSync(exampleDir)) {
    result.errors.push(`Example directory not found: ${exampleDir}`);
    return result;
  }

  // Install dependencies if needed
  const nodeModules = path.join(exampleDir, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log(`📦 Installing dependencies for ${name}...`);
    try {
      execSync('npm install', { cwd: exampleDir, stdio: 'inherit' });
    } catch (error) {
      result.errors.push(`Failed to install dependencies: ${error.message}`);
      return result;
    }
  }

  // Start storybook-mcp-api
  console.log(`🚀 Starting storybook-mcp-api on port ${port}...`);
  
  const cliPath = path.join(__dirname, '..', 'src', 'cli.js');
  const serverProcess = spawn('node', [cliPath, '--port', port.toString(), '--dir', exampleDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  let serverOutput = '';
  serverProcess.stdout.on('data', (data) => {
    serverOutput += data.toString();
  });
  serverProcess.stderr.on('data', (data) => {
    serverOutput += data.toString();
  });

  try {
    console.log('⏳ Waiting for server to start...');
    let storybookReady = false;
    const startTime = Date.now();
    
    while (!storybookReady && (Date.now() - startTime) < TIMEOUT) {
      await sleep(10000);
      
      // Check for version detection in output
      const versionMatch = serverOutput.match(/Detected Storybook version:\s*(\d+)/);
      if (versionMatch && !result.actualVersion) {
        result.actualVersion = parseInt(versionMatch[1], 10);
        result.versionMatch = result.actualVersion === expectedVersion;
        console.log(`✓ Detected version: ${result.actualVersion} (expected: ${expectedVersion})`);
      }

      // Try to get stories via REST API
      try {
        const response = await request({ 
          path: '/api/stories',
          baseUrl: `http://localhost:${port}`,
        });
        if (response.status === 200 && response.body?.success && response.body?.stories?.length > 0) {
          storybookReady = true;
          result.storiesCount = response.body.count || response.body.stories.length;
          console.log(`✓ Storybook ready - found ${result.storiesCount} stories`);
        }
      } catch (e) {
        console.log('   Waiting for Storybook...');
      }
    }

    if (!storybookReady) {
      result.errors.push('Storybook failed to start within timeout');
      throw new Error('Server timeout');
    }

    result.restApiWorking = true;
    console.log(`✓ REST API working`);

    // Test MCP endpoint
    console.log('🔌 Testing MCP protocol...');
    try {
      const mcpRes = await request({
        path: '/mcp',
        baseUrl: `http://localhost:${port}`,
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_stories',
            arguments: {},
          },
        },
      });
      
      if (mcpRes.status === 200 && mcpRes.body?.result?.content) {
        result.mcpWorking = true;
        console.log('✓ MCP protocol working');
      }
    } catch (error) {
      result.errors.push(`MCP test failed: ${error.message}`);
    }

    // Test get_story tool
    console.log('🛠️  Testing MCP tools...');
    try {
      const storyRes = await request({
        path: '/api/stories/example-button--primary',
        baseUrl: `http://localhost:${port}`,
      });
      
      if (storyRes.status === 200 && storyRes.body?.success) {
        console.log(`✓ get_story working - Component: ${storyRes.body.story?.component || 'N/A'}`);
      }
    } catch (error) {
      result.errors.push(`get_story test failed: ${error.message}`);
    }

  } catch (error) {
    if (!result.errors.length) {
      result.errors.push(error.message);
    }
  } finally {
    console.log('🛑 Stopping server...');
    serverProcess.kill('SIGTERM');
    
    try {
      execSync(`pkill -f "storybook.*${port}" 2>/dev/null || true`, { stdio: 'ignore' });
      execSync(`pkill -f "ng run.*storybook" 2>/dev/null || true`, { stdio: 'ignore' });
    } catch (e) {}
    
    await sleep(2000);
  }

  return result;
}

// ============================================
// Run Tests
// ============================================

async function runUnitTests() {
  console.log('\n🧪 Storybook MCP API - Unit Tests\n');
  console.log('='.repeat(50));

  // Start the server for unit tests
  console.log('\n📦 Starting test server...\n');
  
  const serverProcess = spawn('node', [
    path.join(__dirname, '..', 'src', 'cli.js'),
    '--port', TEST_PORT.toString(),
    '--no-proxy',
    '--storybook-url', 'http://localhost:6010',
  ], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
  });

  await sleep(2000);

  try {
    console.log('\n📡 REST API Tests\n');
    for (const testFn of restTests) {
      await testFn();
    }

    console.log('\n🤖 MCP Protocol Tests\n');
    for (const testFn of mcpTests) {
      await testFn();
    }

    console.log('\n🔄 SSE Transport Tests\n');
    for (const testFn of sseTests) {
      await testFn();
    }

  } finally {
    serverProcess.kill();
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Unit Tests: ${passed} passed, ${failed} failed\n`);

  return failed === 0;
}

async function runIntegrationTests() {
  console.log('\n\n╔════════════════════════════════════════════════════════════╗');
  console.log('║      Storybook MCP API - Integration Tests                 ║');
  console.log('║      Testing with Storybook 8, 9, and 10                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  let examplesToTest = examples;
  if (onlyExample) {
    examplesToTest = examples.filter(e => e.name === onlyExample);
    if (examplesToTest.length === 0) {
      console.error(`Example not found: ${onlyExample}`);
      return false;
    }
  }

  const integrationResults = [];
  for (const example of examplesToTest) {
    const result = await testExample(example);
    integrationResults.push(result);
  }

  // Print summary table
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              INTEGRATION TEST SUMMARY                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('┌─────────────┬─────────┬─────────────┬───────────┬───────────┐');
  console.log('│ Example     │ Version │ Version OK  │ REST API  │ MCP       │');
  console.log('├─────────────┼─────────┼─────────────┼───────────┼───────────┤');

  let allPassed = true;
  for (const r of integrationResults) {
    const versionStr = r.actualVersion ? `${r.actualVersion}` : 'N/A';
    const versionOk = r.versionMatch ? '✅' : '❌';
    const restApiOk = r.restApiWorking ? '✅' : '❌';
    const mcpOk = r.mcpWorking ? '✅' : '❌';
    
    console.log(`│ ${r.name.padEnd(11)} │ ${versionStr.padEnd(7)} │ ${versionOk.padEnd(11)} │ ${restApiOk.padEnd(9)} │ ${mcpOk.padEnd(9)} │`);
    
    if (!r.versionMatch || !r.restApiWorking || !r.mcpWorking) {
      allPassed = false;
    }
  }

  console.log('└─────────────┴─────────┴─────────────┴───────────┴───────────┘\n');

  // Print errors if any
  const failedTests = integrationResults.filter(r => r.errors.length > 0);
  if (failedTests.length > 0) {
    console.log('\n❌ Errors:');
    for (const r of failedTests) {
      console.log(`\n  ${r.name}:`);
      for (const error of r.errors) {
        console.log(`    - ${error}`);
      }
    }
  }

  return allPassed;
}

async function runTests() {
  let unitTestsPassed = true;
  let integrationTestsPassed = true;

  // Always run unit tests first (unless only flag is used for integration)
  if (!onlyExample) {
    unitTestsPassed = await runUnitTests();
  }

  // Run integration tests if --integration flag or --only flag
  if (runIntegration || onlyExample) {
    integrationTestsPassed = await runIntegrationTests();
  }

  console.log('\n');
  if (unitTestsPassed && integrationTestsPassed) {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed!\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
