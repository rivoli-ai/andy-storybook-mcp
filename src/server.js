/**
 * Storybook MCP API Server
 * 
 * Unified server exposing Storybook stories via:
 * - REST API at /api/*
 * - MCP Streamable HTTP at /mcp
 * - MCP SSE at /sse
 * 
 * Supports Storybook 8, 9, and 10
 */

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const chalk = require('chalk');
const { v4: uuidv4 } = require('uuid');

const { extractComponentDocs, extractStoryExamples, parseStoryFile, generateUsageExample } = require('./parsers');
const { detectFramework } = require('./utils');

/**
 * MCP Tool Handlers - Core business logic shared between REST and MCP
 */
function createToolHandlers(config) {
  const { storybookUrl, projectDir, staticDir } = config;
  const framework = detectFramework(projectDir);

  /**
   * Get index.json data - from static file or remote URL
   */
  async function getIndexData() {
    // Static mode: read from local file
    if (staticDir) {
      const indexPath = path.join(staticDir, 'index.json');
      if (fs.existsSync(indexPath)) {
        return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      }
      throw new Error('index.json not found in static directory');
    }
    
    // Development mode: fetch from Storybook URL
    const response = await fetch(`${storybookUrl}/index.json`);
    if (!response.ok) {
      throw new Error('Storybook is not ready');
    }
    return response.json();
  }

  return {
    /**
     * List all stories
     */
    async listStories(args = {}) {
      try {
        const data = await getIndexData();
        let stories = Object.values(data.entries || {}).map(entry => ({
          id: entry.id,
          name: entry.name,
          title: entry.title,
          kind: entry.kind || entry.title,
          importPath: entry.importPath,
          tags: entry.tags || [],
          type: entry.type,
        }));

        if (args.kind) {
          stories = stories.filter(s => s.kind === args.kind || s.title === args.kind);
        }

        return {
          success: true,
          count: stories.length,
          stories,
        };
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          hint: staticDir 
            ? `Make sure index.json exists in ${staticDir}` 
            : `Make sure Storybook is running at ${storybookUrl}`,
        };
      }
    },

    /**
     * Get story details
     */
    async getStory(args) {
      try {
        const { storyId } = args;
        const data = await getIndexData();
        const entry = data.entries?.[storyId];

        if (!entry) {
          return { success: false, error: `Story "${storyId}" not found` };
        }

        const story = {
          id: entry.id,
          name: entry.name,
          title: entry.title,
          kind: entry.kind || entry.title,
          importPath: entry.importPath,
          tags: entry.tags || [],
          type: entry.type,
        };

        // Parse story file for additional details
        if (entry.importPath) {
          const cleanPath = entry.importPath.replace(/^\.\//, '');
          const storyFilePath = path.join(projectDir, cleanPath);
          const parsed = parseStoryFile(storyFilePath, storyId, projectDir);
          if (parsed) {
            story.component = parsed.component;
            story.args = parsed.args || {};
            story.argTypes = parsed.argTypes || {};
            if (parsed.componentDocs) {
              story.docs = parsed.componentDocs;
            }
          }
        }

        return { success: true, story };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Get story documentation
     */
    async getStoryDocs(args) {
      try {
        const { storyId } = args;
        const data = await getIndexData();
        const entry = data.entries?.[storyId];

        if (!entry) {
          return { success: false, error: `Story "${storyId}" not found` };
        }

        const docs = {
          storyId,
          title: entry.title,
          name: entry.name,
          type: entry.type,
          framework,
        };

        if (entry.importPath && !entry.importPath.endsWith('.mdx')) {
          const cleanPath = entry.importPath.replace(/^\.\//, '');
          const storyFilePath = path.join(projectDir, cleanPath);

          if (fs.existsSync(storyFilePath)) {
            const content = fs.readFileSync(storyFilePath, 'utf8');

            // Get component info
            const componentMatch = content.match(/component:\s*(\w+)/);
            if (componentMatch) {
              docs.component = componentMatch[1];

              const importMatch = content.match(new RegExp(`import\\s*\\{[^}]*${componentMatch[1]}[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`));
              if (importMatch) {
                const storyDir = path.dirname(storyFilePath);
                let componentFilePath = path.resolve(storyDir, importMatch[1]);
                
                const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
                for (const ext of extensions) {
                  const fullPath = componentFilePath + ext;
                  if (fs.existsSync(fullPath)) {
                    const componentDocs = extractComponentDocs(fullPath);
                    if (componentDocs) {
                      docs.selector = componentDocs.selector;
                      docs.template = componentDocs.template;
                      docs.componentCode = componentDocs.componentCode;
                      docs.properties = componentDocs.properties;
                      docs.componentDescription = componentDocs.description;
                    }
                    break;
                  }
                }
              }
            }

            // Get story examples
            const storyExamples = extractStoryExamples(storyFilePath);
            if (storyExamples) {
              docs.imports = storyExamples.imports;
              docs.metaCode = storyExamples.meta;
              docs.storyExamples = storyExamples.stories;

              if (docs.selector && storyExamples.stories) {
                docs.usageExamples = {};
                Object.entries(storyExamples.stories).forEach(([name, story]) => {
                  docs.usageExamples[name] = generateUsageExample(docs.selector, story.args, name, framework);
                });
              }
            }
          }
        } else if (entry.importPath && entry.importPath.endsWith('.mdx')) {
          const cleanPath = entry.importPath.replace(/^\.\//, '');
          const mdxPath = path.join(projectDir, cleanPath);
          if (fs.existsSync(mdxPath)) {
            docs.mdxContent = fs.readFileSync(mdxPath, 'utf8');
          }
        }

        return { success: true, docs };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    /**
     * Get stories by kind
     */
    async getStoriesByKind(args) {
      try {
        const { kind } = args;
        const data = await getIndexData();
        const stories = Object.values(data.entries || {})
          .filter(entry => entry.kind === kind || entry.title === kind)
          .map(entry => ({
            id: entry.id,
            name: entry.name,
            title: entry.title,
            kind: entry.kind || entry.title,
            type: entry.type,
          }));

        return { success: true, count: stories.length, kind, stories };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  };
}

/**
 * MCP Protocol Handler
 */
function createMCPHandler(config) {
  const handlers = createToolHandlers(config);
  const framework = detectFramework(config.projectDir);

  // MCP Server Info
  const serverInfo = {
    name: 'storybook-mcp-api',
    version: '1.1.0',
    protocolVersion: '2024-11-05',
  };

  // MCP Tools Definition
  const tools = [
    {
      name: 'list_stories',
      description: 'List all available Storybook stories',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Filter stories by kind/category' },
        },
      },
    },
    {
      name: 'get_story',
      description: 'Get detailed information about a specific story',
      inputSchema: {
        type: 'object',
        properties: {
          storyId: { type: 'string', description: 'The story ID (e.g., example-button--primary)' },
        },
        required: ['storyId'],
      },
    },
    {
      name: 'get_story_docs',
      description: 'Get full documentation for a story including code examples',
      inputSchema: {
        type: 'object',
        properties: {
          storyId: { type: 'string', description: 'The story ID (e.g., example-button--docs)' },
        },
        required: ['storyId'],
      },
    },
  ];

  // MCP Resources Definition
  const resources = [
    {
      uri: 'storybook://stories',
      name: 'Storybook Stories',
      description: 'All available Storybook stories',
      mimeType: 'application/json',
    },
  ];

  /**
   * Handle MCP JSON-RPC request
   */
  async function handleRequest(request) {
    const { method, params, id } = request;

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: serverInfo.protocolVersion,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
            },
            serverInfo: {
              name: serverInfo.name,
              version: serverInfo.version,
            },
          },
        };

      case 'initialized':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools },
        };

      case 'tools/call':
        const { name, arguments: args } = params;
        let result;

        switch (name) {
          case 'list_stories':
            result = await handlers.listStories(args || {});
            break;
          case 'get_story':
            result = await handlers.getStory(args);
            break;
          case 'get_story_docs':
            result = await handlers.getStoryDocs(args);
            break;
          default:
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Unknown tool: ${name}` },
            };
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        };

      case 'resources/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { resources },
        };

      case 'resources/read':
        const { uri } = params;
        if (uri === 'storybook://stories') {
          const storiesResult = await handlers.listStories({});
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(storiesResult, null, 2),
              }],
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown resource: ${uri}` },
        };

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }

  return {
    handleRequest,
    serverInfo,
    tools,
    resources,
    framework,
  };
}

/**
 * Create and configure the Express app
 */
function createApp(config) {
  const app = express();
  const { storybookUrl, projectDir, version } = config;
  const framework = detectFramework(projectDir);
  const handlers = createToolHandlers(config);
  const mcpHandler = createMCPHandler(config);

  // Store active SSE sessions
  const sseSessions = new Map();

  app.use(cors());
  app.use(express.json());

  // ============================================
  // MCP Streamable HTTP Transport (/mcp)
  // ============================================
  
  // POST /mcp - Handle MCP JSON-RPC requests
  app.post('/mcp', async (req, res) => {
    try {
      const response = await mcpHandler.handleRequest(req.body);
      res.json(response);
    } catch (error) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id,
        error: { code: -32603, message: error.message },
      });
    }
  });

  // GET /mcp - Return server info (for discovery)
  app.get('/mcp', (req, res) => {
    res.json({
      name: mcpHandler.serverInfo.name,
      version: mcpHandler.serverInfo.version,
      protocolVersion: mcpHandler.serverInfo.protocolVersion,
      description: 'Storybook MCP API Server - Streamable HTTP Transport',
      framework: mcpHandler.framework,
      transport: 'streamable-http',
      endpoint: 'POST /mcp',
      tools: mcpHandler.tools.map(t => ({ name: t.name, description: t.description })),
      resources: mcpHandler.resources.map(r => ({ uri: r.uri, name: r.name })),
    });
  });

  // ============================================
  // MCP SSE Transport (/sse)
  // ============================================

  // GET /sse - SSE connection endpoint
  app.get('/sse', (req, res) => {
    const sessionId = uuidv4();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Send endpoint event with absolute messages URL
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${config.port || 6006}`;
    const messagesUrl = `${protocol}://${host}/sse?sessionId=${sessionId}`;
    res.write(`event: endpoint\ndata: ${messagesUrl}\n\n`);

    // Store session
    sseSessions.set(sessionId, { res, createdAt: Date.now() });

    // Handle client disconnect
    req.on('close', () => {
      sseSessions.delete(sessionId);
    });

    // Keep-alive ping every 30 seconds
    const pingInterval = setInterval(() => {
      if (sseSessions.has(sessionId)) {
        res.write(': ping\n\n');
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  });

  // Helper function to handle SSE messages
  async function handleSSEMessage(req, res, sessionId) {
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId parameter' });
    }
    
    const session = sseSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ 
        error: 'Session not found', 
        hint: 'The SSE session may have expired or disconnected. Please reconnect to /sse',
        activeSessions: sseSessions.size
      });
    }

    try {
      const response = await mcpHandler.handleRequest(req.body);
      
      // Send response via SSE
      session.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      
      res.status(202).json({ status: 'accepted' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // POST /sse - Smart endpoint: Streamable HTTP (no sessionId) OR SSE transport (with sessionId)
  app.post('/sse', async (req, res) => {
    const sessionId = req.query.sessionId || req.headers['x-session-id'];
    
    // If no sessionId, treat as Streamable HTTP (like /mcp)
    if (!sessionId) {
      try {
        const response = await mcpHandler.handleRequest(req.body);
        return res.json(response);
      } catch (error) {
        return res.status(500).json({
          jsonrpc: '2.0',
          id: req.body?.id,
          error: { code: -32603, message: error.message },
        });
      }
    }
    
    // With sessionId, treat as SSE transport
    return handleSSEMessage(req, res, sessionId);
  });

  // POST /sse/messages - Handle SSE messages (standard endpoint)
  app.post('/sse/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    return handleSSEMessage(req, res, sessionId);
  });

  // ============================================
  // REST API Routes (/api/*)
  // ============================================

  // API Documentation
  app.get('/api', (req, res) => {
    res.json({
      success: true,
      name: 'Storybook MCP API',
      version: '1.1.0',
      storybookVersion: version || 'unknown',
      framework,
      endpoints: {
        rest: {
          'GET /api': 'This documentation',
          'GET /api/stories': 'Get all stories',
          'GET /api/stories/:storyId': 'Get a specific story with details',
          'GET /api/docs/:storyId': 'Get full documentation with code examples',
          'GET /api/stories/kind/:kind': 'Get stories filtered by kind/category',
        },
        mcp: {
          'POST /mcp': 'MCP Streamable HTTP transport (JSON-RPC)',
          'GET /mcp': 'MCP server info',
          'GET /sse': 'MCP SSE transport (Server-Sent Events)',
          'POST /sse/messages': 'SSE message endpoint',
        },
      },
      examples: {
        rest: {
          'List stories': '/api/stories',
          'Get story': '/api/stories/example-button--primary',
          'Get docs': '/api/docs/example-button--docs',
        },
        mcp: {
          'Initialize': { method: 'initialize', params: { protocolVersion: '2024-11-05' } },
          'List tools': { method: 'tools/list' },
          'Call tool': { method: 'tools/call', params: { name: 'list_stories', arguments: {} } },
        },
      },
    });
  });

  // Get all stories
  app.get('/api/stories', async (req, res) => {
    const result = await handlers.listStories(req.query);
    if (result.success) {
      res.json(result);
    } else {
      res.status(503).json(result);
    }
  });

  // Get specific story
  app.get('/api/stories/:storyId', async (req, res) => {
    const result = await handlers.getStory({ storyId: req.params.storyId });
    if (result.success) {
      res.json(result);
    } else if (result.error?.includes('not found')) {
      res.status(404).json(result);
    } else {
      res.status(503).json(result);
    }
  });

  // Get story documentation
  app.get('/api/docs/:storyId', async (req, res) => {
    const result = await handlers.getStoryDocs({ storyId: req.params.storyId });
    if (result.success) {
      res.json(result);
    } else if (result.error?.includes('not found')) {
      res.status(404).json(result);
    } else {
      res.status(503).json(result);
    }
  });

  // Get stories by kind
  app.get('/api/stories/kind/:kind', async (req, res) => {
    const result = await handlers.getStoriesByKind({ kind: req.params.kind });
    if (result.success) {
      res.json(result);
    } else {
      res.status(503).json(result);
    }
  });

  return app;
}

/**
 * Start Storybook process
 */
function startStorybookProcess(config) {
  const { storybookPort, projectDir, version, framework } = config;

  console.log(chalk.blue('→') + ` Starting Storybook (internal)...`);

  let cmd = 'npx';
  let args = ['storybook', 'dev', '-p', storybookPort.toString(), '--no-open'];

  // For Angular projects with Storybook 8+, try Angular builder first
  if (framework === 'angular' && version >= 8) {
    const angularJsonPath = path.join(projectDir, 'angular.json');
    if (fs.existsSync(angularJsonPath)) {
      try {
        const angularJson = JSON.parse(fs.readFileSync(angularJsonPath, 'utf8'));
        for (const [projectName, project] of Object.entries(angularJson.projects || {})) {
          if (project.architect?.storybook) {
            if (!angularJson.projects[projectName].architect.storybook.options) {
              angularJson.projects[projectName].architect.storybook.options = {};
            }
            angularJson.projects[projectName].architect.storybook.options.compodoc = false;
            angularJson.projects[projectName].architect.storybook.options.port = storybookPort;
            fs.writeFileSync(angularJsonPath, JSON.stringify(angularJson, null, 2));
            
            const packageJsonPath = path.join(projectDir, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
              const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
              if (packageJson.scripts?.storybook && packageJson.scripts.storybook.includes('ng run')) {
                cmd = 'npm';
                args = ['run', 'storybook'];
                console.log(chalk.dim(`   Using npm script for Angular builder`));
                break;
              }
            }
            cmd = 'npm';
            args = ['run', 'storybook'];
            console.log(chalk.dim(`   Using Angular builder via npm script`));
            break;
          }
        }
      } catch (error) {
        console.log(chalk.yellow('⚠️  Could not read angular.json, falling back to standard Storybook CLI'));
      }
    }
  }

  const storybook = spawn(cmd, args, {
    cwd: projectDir,
    shell: true,
    stdio: 'pipe',
    env: {
      ...process.env,
      PORT: storybookPort.toString(),
      STORYBOOK_PORT: storybookPort.toString(),
    },
  });

  storybook.stdout.on('data', (data) => {
    const msg = data.toString();
    process.stdout.write(chalk.dim('[Storybook] ') + msg);
  });

  storybook.stderr.on('data', (data) => {
    const msg = data.toString();
    if (!msg.includes('ExperimentalWarning') && !msg.includes('punycode')) {
      process.stderr.write(chalk.dim('[Storybook] ') + msg);
    }
  });

  storybook.on('close', (code) => {
    if (code !== 0) {
      console.log(chalk.yellow(`[Storybook] Process exited with code ${code}`));
    }
  });

  return storybook;
}

/**
 * Start the unified server
 */
async function startServer(config) {
  const { port, storybookPort, storybookUrl, projectDir, proxy, staticDir } = config;

  const app = createApp(config);
  let storybookProcess = null;

  // Static mode: serve pre-built Storybook files
  if (staticDir) {
    console.log(chalk.blue('→') + ` Serving static Storybook from: ${chalk.dim(staticDir)}`);
    app.use(express.static(staticDir));
    
    // Fallback to index.html for SPA routing
    app.get('*', (req, res, next) => {
      // Skip API and MCP routes
      if (req.path.startsWith('/mcp') || req.path.startsWith('/sse') || req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  } else if (proxy) {
    // Development mode: start and proxy Storybook
    storybookProcess = startStorybookProcess(config);

    // Add proxy middleware for all non-API/MCP requests (Storybook UI)
    app.use('/', createProxyMiddleware({
      target: storybookUrl,
      changeOrigin: true,
      ws: true,
      // Filter: only proxy requests that are NOT our API/MCP routes
      pathFilter: (path, req) => {
        // Don't proxy our API routes
        if (path.startsWith('/mcp') || path.startsWith('/sse') || path.startsWith('/api')) {
          return false;
        }
        return true;
      },
      onError: (err, req, res) => {
        if (res.writeHead) {
          res.writeHead(503, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head><title>Storybook Starting...</title></head>
              <body style="font-family: sans-serif; padding: 40px; text-align: center;">
                <h1>⏳ Storybook is starting...</h1>
                <p>Please wait a moment and refresh this page.</p>
                <script>setTimeout(() => location.reload(), 3000);</script>
              </body>
            </html>
          `);
        }
      },
    }));
  }

  return new Promise((resolve) => {
    // Bind to 0.0.0.0 to accept connections from all interfaces (localhost, hostname, IP)
    const server = app.listen(port, '0.0.0.0', async () => {
      
      // Static mode: ready immediately
      if (staticDir) {
        console.log('');
        console.log(chalk.green('═══════════════════════════════════════════════════════════'));
        console.log(chalk.green('  ✓ Storybook MCP API is ready! (Production Mode)'));
        console.log(chalk.green('═══════════════════════════════════════════════════════════'));
        console.log('');
        console.log(`  ${chalk.bold('Storybook UI:')}    ${chalk.cyan(`http://localhost:${port}`)}`);
        console.log(`  ${chalk.dim('                  Serving static build from:')} ${staticDir}`);
        console.log('');
        console.log(`  ${chalk.bold('REST API:')}`);
        console.log(`    ${chalk.cyan(`http://localhost:${port}/api`)}`);
        console.log(`    ${chalk.cyan(`http://localhost:${port}/api/stories`)}`);
        console.log('');
        console.log(`  ${chalk.bold('MCP Protocol:')}`);
        console.log(`    ${chalk.cyan(`http://localhost:${port}/mcp`)}    ${chalk.dim('(Streamable HTTP - POST)')}`);
        console.log(`    ${chalk.cyan(`http://localhost:${port}/sse`)}    ${chalk.dim('(SSE Transport)')}`);
        console.log('');
        console.log(chalk.dim('  Press Ctrl+C to stop'));
        console.log('');
        resolve(server);
        return;
      }
      
      console.log('');
      console.log(chalk.blue('═══════════════════════════════════════════════════════════'));
      console.log(chalk.blue('  ⏳ Server started, waiting for Storybook...'));
      console.log(chalk.blue('═══════════════════════════════════════════════════════════'));
      console.log('');

      // Wait for Storybook to be ready (development mode with proxy)
      if (proxy && storybookProcess) {
        let storybookReady = false;
        const maxWaitTime = 120000;
        const startTime = Date.now();
        const checkInterval = 2000;

        while (!storybookReady && (Date.now() - startTime) < maxWaitTime) {
          try {
            const response = await fetch(`${storybookUrl}/index.json`);
            if (response.ok) {
              const data = await response.json();
              if (data.entries && Object.keys(data.entries).length > 0) {
                storybookReady = true;
                break;
              }
            }
          } catch (error) {
            // Storybook not ready yet
          }
          await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        if (storybookReady) {
          console.log('');
          console.log(chalk.green('═══════════════════════════════════════════════════════════'));
          console.log(chalk.green('  ✓ Storybook MCP API is ready!'));
          console.log(chalk.green('═══════════════════════════════════════════════════════════'));
          console.log('');
          console.log(`  ${chalk.bold('Storybook UI:')}    ${chalk.cyan(`http://localhost:${port}`)}`);
          console.log('');
          console.log(`  ${chalk.bold('REST API:')}`);
          console.log(`    ${chalk.cyan(`http://localhost:${port}/api`)}`);
          console.log(`    ${chalk.cyan(`http://localhost:${port}/api/stories`)}`);
          console.log('');
          console.log(`  ${chalk.bold('MCP Protocol:')}`);
          console.log(`    ${chalk.cyan(`http://localhost:${port}/mcp`)}    ${chalk.dim('(Streamable HTTP - POST)')}`);
          console.log(`    ${chalk.cyan(`http://localhost:${port}/sse`)}    ${chalk.dim('(SSE Transport)')}`);
          console.log('');
          console.log(chalk.dim('  Press Ctrl+C to stop'));
          console.log('');
        } else {
          console.log('');
          console.log(chalk.yellow('═══════════════════════════════════════════════════════════'));
          console.log(chalk.yellow('  ⚠️  Storybook is taking longer than expected'));
          console.log(chalk.yellow('═══════════════════════════════════════════════════════════'));
          console.log('');
          console.log(`  ${chalk.bold('Server:')}    ${chalk.cyan(`http://localhost:${port}`)}`);
          console.log(`  ${chalk.bold('REST API:')} ${chalk.cyan(`http://localhost:${port}/api`)}`);
          console.log(`  ${chalk.bold('MCP:')}      ${chalk.cyan(`http://localhost:${port}/mcp`)}`);
          console.log(`  ${chalk.bold('SSE:')}      ${chalk.cyan(`http://localhost:${port}/sse`)}`);
          console.log('');
          console.log(chalk.dim('  The server is running, but Storybook may still be starting.'));
          console.log(chalk.dim('  Press Ctrl+C to stop'));
          console.log('');
        }
      } else {
        console.log('');
        console.log(chalk.green('═══════════════════════════════════════════════════════════'));
        console.log(chalk.green('  ✓ Server started successfully!'));
        console.log(chalk.green('═══════════════════════════════════════════════════════════'));
        console.log('');
        console.log(`  ${chalk.bold('REST API:')}`);
        console.log(`    ${chalk.cyan(`http://localhost:${port}/api`)}`);
        console.log(`    ${chalk.cyan(`http://localhost:${port}/api/stories`)}`);
        console.log('');
        console.log(`  ${chalk.bold('MCP Protocol:')}`);
        console.log(`    ${chalk.cyan(`http://localhost:${port}/mcp`)}    ${chalk.dim('(Streamable HTTP - POST)')}`);
        console.log(`    ${chalk.cyan(`http://localhost:${port}/sse`)}    ${chalk.dim('(SSE Transport)')}`);
        console.log('');
        console.log(chalk.dim('  Press Ctrl+C to stop'));
        console.log('');
      }

      resolve(server);
    });

    // Handle shutdown
    const shutdown = () => {
      console.log(chalk.yellow('\n  Shutting down...'));
      if (storybookProcess) {
        storybookProcess.kill();
      }
      server.close(() => {
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

module.exports = {
  createApp,
  createToolHandlers,
  createMCPHandler,
  startServer,
  startStorybookProcess,
};
