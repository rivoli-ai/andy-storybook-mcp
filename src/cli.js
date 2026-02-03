#!/usr/bin/env node

/**
 * Storybook MCP API CLI
 * 
 * Unified server with REST API + MCP protocol on a single port
 * 
 * Usage:
 *   npx storybook-mcp-api [options]
 *   npx storybook-mcp-api --port 6006
 *   npx storybook-mcp-api --static                     # Auto-detect from angular.json
 *   npx storybook-mcp-api --static ./storybook-static  # Explicit path
 *   npx storybook-mcp-api --generate-api              # Generate static API files
 */

const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const { startServer, createToolHandlers } = require('./server');
const { detectStorybookVersion, findStorybookConfig, detectFramework } = require('./utils');

/**
 * Auto-detect Storybook build output directory
 * Checks angular.json, then common defaults
 */
function detectStorybookOutputDir(projectDir) {
  // Check angular.json for build-storybook outputDir
  const angularJsonPath = path.join(projectDir, 'angular.json');
  if (fs.existsSync(angularJsonPath)) {
    try {
      const angularJson = JSON.parse(fs.readFileSync(angularJsonPath, 'utf8'));
      for (const project of Object.values(angularJson.projects || {})) {
        const buildStorybook = project.architect?.['build-storybook'];
        if (buildStorybook?.options?.outputDir) {
          const outputDir = path.join(projectDir, buildStorybook.options.outputDir);
          if (fs.existsSync(outputDir)) {
            return { dir: outputDir, source: 'angular.json' };
          }
        }
      }
    } catch (error) {
      // Ignore parse errors
    }
  }
  
  // Check common default directories
  const defaultDirs = ['storybook-static', 'dist/storybook', 'build/storybook'];
  for (const dir of defaultDirs) {
    const fullPath = path.join(projectDir, dir);
    if (fs.existsSync(fullPath) && fs.existsSync(path.join(fullPath, 'index.json'))) {
      return { dir: fullPath, source: 'auto-detected' };
    }
  }
  
  return null;
}

/**
 * Generate static API JSON files inside Storybook build
 * This allows serving everything via nginx/CDN without a Node.js server
 * Uses the same tool handlers as dev mode for full documentation
 */
async function generateStaticApi(staticDir, projectDir) {
  const indexJsonPath = path.join(staticDir, 'index.json');
  if (!fs.existsSync(indexJsonPath)) {
    throw new Error(`No index.json found in ${staticDir}`);
  }

  // Create tool handlers to get full documentation (same as dev mode)
  const { createToolHandlers } = require('./server');
  const handlers = createToolHandlers({
    storybookUrl: 'unused', // We use staticDir instead
    projectDir,
    staticDir,
  });

  // Create api directory
  const apiDir = path.join(staticDir, 'api');
  if (!fs.existsSync(apiDir)) {
    fs.mkdirSync(apiDir, { recursive: true });
  }

  // Read index.json
  const indexData = JSON.parse(fs.readFileSync(indexJsonPath, 'utf8'));
  const entries = indexData.entries || {};
  const stories = Object.values(entries);

  // Generate /api/index.json (API info)
  const apiInfo = {
    success: true,
    name: 'Storybook MCP API',
    version: '1.4.0',
    mode: 'static',
    endpoints: {
      'GET /api': 'This documentation',
      'GET /api/stories.json': 'Get all stories',
      'GET /api/stories/{storyId}.json': 'Get story details',
      'GET /api/docs/{storyId}.json': 'Get story documentation',
    },
    note: 'This is a static API. MCP protocol requires a running server.',
  };
  fs.writeFileSync(path.join(apiDir, 'index.json'), JSON.stringify(apiInfo, null, 2));
  console.log(chalk.green('  ✓') + ' Generated /api/index.json');

  // Generate /api/stories.json (all stories) - use handler for consistency
  const storiesResult = await handlers.listStories({});
  fs.writeFileSync(path.join(apiDir, 'stories.json'), JSON.stringify(storiesResult, null, 2));
  console.log(chalk.green('  ✓') + ` Generated /api/stories.json (${storiesResult.count} stories)`);

  // Create stories and docs subdirectories
  const storiesDir = path.join(apiDir, 'stories');
  const docsDir = path.join(apiDir, 'docs');
  if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  // Generate individual story and docs files using handlers (full documentation)
  let storyCount = 0;
  let docsCount = 0;

  for (const entry of stories) {
    const storyId = entry.id;
    const safeId = storyId.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Generate /api/stories/{storyId}.json - uses handler for full details
    const storyResult = await handlers.getStory({ storyId });
    fs.writeFileSync(path.join(storiesDir, `${safeId}.json`), JSON.stringify(storyResult, null, 2));
    storyCount++;

    // Generate /api/docs/{storyId}.json - uses handler for full documentation
    const docsResult = await handlers.getStoryDocs({ storyId });
    fs.writeFileSync(path.join(docsDir, `${safeId}.json`), JSON.stringify(docsResult, null, 2));
    docsCount++;
  }

  console.log(chalk.green('  ✓') + ` Generated ${storyCount} story files in /api/stories/`);
  console.log(chalk.green('  ✓') + ` Generated ${docsCount} docs files in /api/docs/`);

  // Generate nginx config example
  const nginxConfig = `# nginx configuration for static Storybook API
# Add this to your server block

location /api {
    alias ${staticDir}/api;
    default_type application/json;
    add_header Access-Control-Allow-Origin *;
    
    # Rewrite for pretty URLs
    try_files $uri $uri.json =404;
}

location /api/stories/ {
    alias ${staticDir}/api/stories/;
    default_type application/json;
    add_header Access-Control-Allow-Origin *;
}

location /api/docs/ {
    alias ${staticDir}/api/docs/;
    default_type application/json;
    add_header Access-Control-Allow-Origin *;
}
`;
  fs.writeFileSync(path.join(apiDir, 'nginx.conf.example'), nginxConfig);
  console.log(chalk.green('  ✓') + ' Generated /api/nginx.conf.example');

  return { apiDir, storyCount, docsCount };
}

const program = new Command();

program
  .name('storybook-mcp-api')
  .description('Unified Storybook server with REST API + MCP protocol on a single port')
  .version('1.0.0')
  .option('-p, --port <number>', 'Port to run the server on', '6006')
  .option('-s, --storybook-port <number>', 'Internal port for Storybook', '6010')
  .option('--no-proxy', 'Run API only (don\'t start/proxy Storybook)')
  .option('--storybook-url <url>', 'URL of running Storybook instance')
  .option('--static [path]', 'Serve a pre-built Storybook (auto-detects from angular.json or defaults)')
  .option('--generate-api [path]', 'Generate static API JSON files inside Storybook build (no server needed)')
  .option('-d, --dir <path>', 'Project directory (default: current directory)', process.cwd())
  .action(async (options) => {
    console.log('');
    console.log(chalk.magenta('╔═══════════════════════════════════════════════════════════╗'));
    console.log(chalk.magenta('║') + chalk.bold.white('        Storybook MCP API Server                          ') + chalk.magenta('║'));
    console.log(chalk.magenta('║') + chalk.dim('        REST API + MCP Protocol • Single Port             ') + chalk.magenta('║'));
    console.log(chalk.magenta('╚═══════════════════════════════════════════════════════════╝'));
    console.log('');

    const projectDir = options.dir;
    const port = parseInt(options.port, 10);
    
    // Check for --generate-api mode (generate static files and exit)
    if (options.generateApi !== undefined) {
      let targetDir;
      
      if (typeof options.generateApi === 'string' && options.generateApi !== '') {
        targetDir = path.resolve(options.generateApi);
      } else {
        const detected = detectStorybookOutputDir(projectDir);
        if (detected) {
          targetDir = detected.dir;
          console.log(chalk.green('✓') + ` Auto-detected Storybook build: ${chalk.bold(targetDir)}`);
        } else {
          console.error(chalk.red('✗') + ' Could not auto-detect Storybook build directory');
          console.error(chalk.dim('  Build Storybook first: npx storybook build'));
          process.exit(1);
        }
      }
      
      console.log('');
      console.log(chalk.blue('→') + ' Generating static API files...');
      console.log('');
      
      try {
        const result = await generateStaticApi(targetDir, projectDir);
        console.log('');
        console.log(chalk.green('═══════════════════════════════════════════════════════════'));
        console.log(chalk.green('  ✓ Static API generated successfully!'));
        console.log(chalk.green('═══════════════════════════════════════════════════════════'));
        console.log('');
        console.log(`  ${chalk.bold('Output:')} ${result.apiDir}`);
        console.log('');
        console.log(`  ${chalk.bold('Files generated:')}`);
        console.log(`    • /api/index.json`);
        console.log(`    • /api/stories.json`);
        console.log(`    • /api/stories/*.json (${result.storyCount} files)`);
        console.log(`    • /api/docs/*.json (${result.docsCount} files)`);
        console.log(`    • /api/nginx.conf.example`);
        console.log('');
        console.log(chalk.dim('  You can now serve everything with nginx or any static server.'));
        console.log(chalk.dim('  See /api/nginx.conf.example for nginx configuration.'));
        console.log('');
        process.exit(0);
      } catch (error) {
        console.error(chalk.red('✗') + ` Error: ${error.message}`);
        process.exit(1);
      }
    }
    
    // Check for static mode (production)
    let staticDir = null;
    if (options.static !== undefined) {
      // If path provided, use it; otherwise auto-detect
      if (typeof options.static === 'string' && options.static !== '') {
        staticDir = path.resolve(options.static);
      } else {
        // Auto-detect from angular.json or defaults
        const detected = detectStorybookOutputDir(projectDir);
        if (detected) {
          staticDir = detected.dir;
          console.log(chalk.green('✓') + ` Auto-detected Storybook build: ${chalk.bold(staticDir)}`);
          console.log(chalk.dim(`  Source: ${detected.source}`));
        } else {
          console.error(chalk.red('✗') + ' Could not auto-detect Storybook build directory');
          console.error(chalk.dim('  Try one of:'));
          console.error(chalk.dim('    npx storybook build -o storybook-static'));
          console.error(chalk.dim('    npx storybook-mcp-api --static ./your-output-dir'));
          process.exit(1);
        }
      }
      
      // Verify the static directory exists
      if (!fs.existsSync(staticDir)) {
        console.error(chalk.red('✗') + ` Static directory not found: ${staticDir}`);
        process.exit(1);
      }
      
      // Check for index.json (required for API)
      const indexJsonPath = path.join(staticDir, 'index.json');
      if (!fs.existsSync(indexJsonPath)) {
        console.error(chalk.red('✗') + ` No index.json found in ${staticDir}`);
        console.error(chalk.dim('  Make sure you built Storybook with: npx storybook build'));
        process.exit(1);
      }
      
      console.log(chalk.green('✓') + ` Static mode: serving from ${chalk.bold(staticDir)}`);
      console.log(chalk.cyan('  Production ready - no Storybook dev server'));
    }
    
    // Only detect version/framework in non-static mode
    let version = null;
    let framework = 'unknown';
    let configDir = null;
    
    if (!staticDir) {
      // Detect Storybook version
      version = detectStorybookVersion(projectDir);
      if (version) {
        console.log(chalk.green('✓') + ` Detected Storybook version: ${chalk.bold(version)}`);
      } else {
        console.log(chalk.yellow('⚠') + ' Could not detect Storybook version');
      }

      // Detect framework
      framework = detectFramework(projectDir);
      if (framework !== 'unknown') {
        console.log(chalk.green('✓') + ` Detected framework: ${chalk.bold(framework)}`);
      } else {
        console.log(chalk.yellow('⚠') + ' Could not detect framework');
      }

      // Find Storybook config
      configDir = findStorybookConfig(projectDir);
      if (configDir) {
        console.log(chalk.green('✓') + ` Found Storybook config: ${chalk.dim(configDir)}`);
      } else {
        console.log(chalk.yellow('⚠') + ' Could not find .storybook directory');
      }
    }

    console.log('');
    console.log(chalk.blue('→') + ` Server will run on port ${chalk.bold(port)}`);
    console.log(chalk.dim(`  • REST API:  /api/*`));
    console.log(chalk.dim(`  • MCP HTTP:  /mcp`));
    console.log(chalk.dim(`  • MCP SSE:   /sse`));

    const config = {
      port,
      storybookPort: parseInt(options.storybookPort, 10),
      storybookUrl: options.storybookUrl || `http://localhost:${options.storybookPort}`,
      projectDir,
      configDir,
      proxy: staticDir ? false : (options.proxy !== false),
      staticDir,  // New: serve static build
      version,
      framework,
    };

    try {
      await startServer(config);
    } catch (error) {
      console.error(chalk.red('Error starting server:'), error.message);
      process.exit(1);
    }
  });

program.parse();


