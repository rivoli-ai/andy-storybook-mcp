# storybook-mcp-api

[![npm version](https://img.shields.io/npm/v/storybook-mcp-api.svg)](https://www.npmjs.com/package/storybook-mcp-api)
[![npm downloads](https://img.shields.io/npm/dm/storybook-mcp-api.svg)](https://www.npmjs.com/package/storybook-mcp-api)
[![license](https://img.shields.io/npm/l/storybook-mcp-api.svg)](https://github.com/benamaraissam/storybook-mcp-api/blob/main/LICENSE)
[![GitHub](https://img.shields.io/github/stars/benamaraissam/storybook-mcp-api?style=social)](https://github.com/benamaraissam/storybook-mcp-api)

**Unified Storybook server with REST API + MCP protocol on a single port**

Access your Storybook stories via REST API endpoints or MCP (Model Context Protocol) for AI assistants - all from one server!

📦 **[View on npm](https://www.npmjs.com/package/storybook-mcp-api)** | 🐙 **[View on GitHub](https://github.com/benamaraissam/storybook-mcp-api)**

## Features

- 🚀 **Single Port** - REST API and MCP on the same server
- 📚 **REST API** - `/api/*` endpoints for HTTP clients
- 🤖 **MCP Protocol** - `/mcp` and `/sse` for AI assistant integration
- 🔄 **SSE Support** - Server-Sent Events transport for real-time communication
- 📖 **Full Documentation** - Component docs, code examples, usage snippets
- 🎯 **Framework Support** - Angular, React, Vue, Svelte, Web Components
- 📦 **Storybook 8/9/10** - Works with latest Storybook versions

## Installation

```bash
# Using npx (no installation required)
npx storybook-mcp-api

# Or install globally
npm install -g storybook-mcp-api

# Or as a dev dependency
npm install --save-dev storybook-mcp-api
```

## Quick Start

Navigate to your Storybook project and run:

```bash
npx storybook-mcp-api
# or shorter alias
npx sb-mcp-api
```

This will:
1. Start Storybook on an internal port
2. Start the API server on port 6006
3. Proxy Storybook through the same port

Access your stories at:
- **Storybook UI**: http://localhost:6006
- **REST API**: http://localhost:6006/api
- **MCP Protocol**: http://localhost:6006/mcp or http://localhost:6006/sse

## Endpoints

### REST API

| Endpoint | Description |
|----------|-------------|
| `GET /api` | API documentation |
| `GET /api/stories` | List all stories |
| `GET /api/stories/:storyId` | Get story details |
| `GET /api/docs/:storyId` | Get full documentation |
| `GET /api/stories/kind/:kind` | Filter by category |

### MCP Protocol

#### Streamable HTTP Transport (`/mcp`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | `POST` | JSON-RPC requests (recommended) |
| `/mcp` | `GET` | Server info (discovery) |

#### SSE Transport (`/sse`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sse` | `GET` | SSE connection (establishes session) |
| `/sse` | `POST` | Send messages (with or without sessionId) |
| `/sse/messages` | `POST` | Send messages to SSE session |

### MCP Tools

- **list_stories** - List all available stories
  - Optional: `kind` parameter to filter by category
- **get_story** - Get story details
  - Required: `storyId` parameter
- **get_story_docs** - Get full documentation with code examples
  - Required: `storyId` parameter

## Usage Examples

### REST API

```bash
# List all stories
curl http://localhost:6006/api/stories

# Get story details
curl http://localhost:6006/api/stories/example-button--primary

# Get documentation
curl http://localhost:6006/api/docs/example-button--docs
```

### MCP Protocol (HTTP Stream)

```bash
# Initialize
curl -X POST http://localhost:6006/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}'

# List tools
curl -X POST http://localhost:6006/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Call tool
curl -X POST http://localhost:6006/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_stories","arguments":{}}}'
```

### Cursor IDE / Claude Desktop Configuration

Add to your MCP settings (usually `~/.cursor/mcp.json` or `~/.config/claude/mcp.json`):

**Option 1: Streamable HTTP (Recommended)**
```json
{
  "mcpServers": {
    "storybook": {
      "url": "http://localhost:6006/mcp"
    }
  }
}
```

**Option 2: SSE Transport**
```json
{
  "mcpServers": {
    "storybook": {
      "url": "http://localhost:6006/sse"
    }
  }
}
```

Both transports work, but Streamable HTTP (`/mcp`) is more reliable and stateless.

## CLI Options

```bash
npx storybook-mcp-api [options]

Options:
  -p, --port <number>          Port for the server (default: 6006)
  -s, --storybook-port <number> Internal Storybook port (default: 6010)
  --static [path]               Production mode: serve pre-built Storybook (auto-detects if no path)
  --generate-api [path]         Generate static API JSON files (no server needed)
  --no-proxy                    Run API only (requires Storybook running separately)
  --storybook-url <url>         URL of existing Storybook instance
  -d, --dir <path>              Project directory (default: current directory)
  -h, --help                    Display help
```

## Deployment Options

Choose the deployment mode that fits your needs:

| Mode | Command | Storybook UI | REST API | MCP Protocol | Server Required |
|------|---------|--------------|----------|--------------|-----------------|
| **Development** | `npx storybook-mcp-api` | ✅ Live | ✅ Dynamic | ✅ Full | Node.js |
| **Static Server** | `--static` | ✅ Built | ✅ Dynamic | ✅ Full | Node.js |
| **Pure Static** | `--generate-api` | ✅ Built | ✅ JSON files | ❌ None | nginx/CDN only |

### When to use each:

- **Development**: Local development, hot-reload, debugging
- **Static Server** (`--static`): Production with MCP support, lightweight Node.js
- **Pure Static** (`--generate-api`): Maximum performance, CDN deployment, no server needed

---

## Production Deployment

For production, you can serve a pre-built Storybook instead of running it in development mode.

### Option 1: Static Server (Node.js - REST + MCP)

Serve pre-built Storybook with full API and MCP support:

```bash
# 1. Build Storybook (during CI/CD)
npm run build-storybook

# 2. Install globally on production server
npm install -g storybook-mcp-api

# 3. Run (auto-detects output directory)
storybook-mcp-api --static
```

**Features:**
- ✅ Storybook UI (pre-built)
- ✅ REST API (`/api/*`) - dynamic responses
- ✅ MCP Protocol (`/mcp`, `/sse`) - full support
- ✅ Lightweight - no Storybook dev server

**Auto-detection:** The `--static` flag auto-detects the output directory from:
1. `angular.json` → `build-storybook.options.outputDir`
2. Common defaults: `storybook-static`, `dist/storybook`, `build/storybook`

Or specify explicitly:
```bash
storybook-mcp-api --static ./custom-output-dir
```

> ⚠️ **Note:** Avoid using `npx` in production as it downloads packages on every run. Install globally instead.

#### Docker Example

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy pre-built Storybook
COPY storybook-static ./storybook-static

# Install storybook-mcp-api globally
RUN npm install -g storybook-mcp-api

EXPOSE 6006

CMD ["storybook-mcp-api", "--static", "./storybook-static"]
```

#### PM2 Example

```bash
# Install globally (recommended for production)
npm install -g storybook-mcp-api pm2

# Start with PM2
pm2 start storybook-mcp-api --name storybook-api -- --static --port 6006

# Save and auto-restart on reboot
pm2 save
pm2 startup
```

#### nginx Reverse Proxy (with MCP/SSE support)

```nginx
upstream storybook_api {
    server 127.0.0.1:6006;
    keepalive 64;
}

server {
    listen 80;
    server_name your-domain.com;

    # All requests
    location / {
        proxy_pass http://storybook_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SSE endpoint - disable buffering!
    location /sse {
        proxy_pass http://storybook_api;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }
}
```

---

### Option 2: Pure Static (No Node.js - REST only)

Generate static JSON API files that can be served by **nginx, Apache, S3, or any CDN** - no Node.js required!

**Features:**
- ✅ Storybook UI (pre-built)
- ✅ REST API (static JSON files)
- ❌ MCP Protocol (not available - requires server)
- ✅ Zero runtime dependencies
- ✅ CDN/S3 compatible

#### Integrate into Build (Recommended)

Add to your project's `package.json`:

```json
{
  "scripts": {
    "build-storybook": "storybook build",
    "postbuild-storybook": "storybook-mcp-api --generate-api"
  },
  "devDependencies": {
    "storybook-mcp-api": "^1.4.3"
  }
}
```

Then just run:
```bash
npm run build-storybook
```

The API files are generated automatically after the build!

#### Manual Generation (CI/CD)

For CI/CD pipelines, you can use npx since it runs once during build:

```bash
# 1. Build Storybook
npx storybook build

# 2. Generate static API files (auto-detects build directory)
npx storybook-mcp-api --generate-api
```

Or install as dev dependency (faster in CI with caching):

```bash
npm install --save-dev storybook-mcp-api
npm run build-storybook && storybook-mcp-api --generate-api
```

This creates JSON files inside your Storybook build:
```
storybook-static/
├── api/
│   ├── index.json           # API info
│   ├── stories.json         # All stories
│   ├── stories/
│   │   ├── example-button--primary.json
│   │   └── ...
│   ├── docs/
│   │   ├── example-button--primary.json
│   │   └── ...
│   └── nginx.conf.example   # nginx config
├── index.html
└── ...
```

**nginx Configuration:**

```nginx
server {
    listen 80;
    root /var/www/storybook-static;

    # Serve Storybook UI
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Serve static API
    location /api {
        default_type application/json;
        add_header Access-Control-Allow-Origin *;
        try_files $uri $uri.json =404;
    }
}
```

> **Note:** MCP protocol (`/mcp`, `/sse`) requires a running Node.js server. The static API only supports REST endpoints.

## Programmatic Usage

```javascript
const { createApp, startServer } = require('storybook-mcp-api');

const config = {
  port: 6006,
  storybookPort: 6010,
  storybookUrl: 'http://localhost:6010',
  projectDir: process.cwd(),
  proxy: true,
};

startServer(config);
```

## Testing

```bash
# Run unit tests
npm test

# Run integration tests with Storybook 8, 9, 10 examples
npm run test:integration

# Test specific Storybook version
npm run test:sb8
npm run test:sb9
npm run test:sb10
```

## Examples

### Run API Only (Storybook already running)

```bash
# If Storybook is running on port 6006
npx storybook-mcp-api --no-proxy --storybook-url http://localhost:6006 --port 3000
```

### Custom Ports

```bash
npx storybook-mcp-api --port 8080 --storybook-port 9000
```

## Supported Frameworks

- ✅ Angular
- ✅ React
- ✅ Vue
- ✅ Svelte
- ✅ Web Components
- ✅ Any Storybook project

## Supported Storybook Versions

- ✅ Storybook 8.x (tested with Angular 17)
- ✅ Storybook 9.x (tested with Angular 18)
- ✅ Storybook 10.x (tested with Angular 21)

## Example Projects

Check out the [examples](https://github.com/benamaraissam/storybook-mcp-api/tree/main/examples) folder for working projects:
- `test-sb8` - Angular 17 + Storybook 8
- `test-sb9` - Angular 18 + Storybook 9
- `test-sb10` - Angular 21 + Storybook 10

To run an example:
```bash
cd examples/test-sb8
npm install
npx storybook-mcp-api
```

## License

MIT

