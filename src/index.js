/**
 * Storybook MCP API - Programmatic interface
 * 
 * Unified server with REST API + MCP protocol on a single port
 * 
 * @example
 * const { createApp, startServer } = require('storybook-mcp-api');
 */

const { createApp, createToolHandlers, createMCPRouter, startServer, startStorybookProcess } = require('./server');
const { detectStorybookVersion, findStorybookConfig, detectFramework } = require('./utils');
const { extractComponentDocs, extractStoryExamples, parseStoryFile, generateUsageExample } = require('./parsers');

module.exports = {
  // Server
  createApp,
  createToolHandlers,
  createMCPRouter,
  startServer,
  startStorybookProcess,
  
  // Utils
  detectStorybookVersion,
  findStorybookConfig,
  detectFramework,
  
  // Parsers
  extractComponentDocs,
  extractStoryExamples,
  parseStoryFile,
  generateUsageExample,
};


