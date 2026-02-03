/**
 * Utility functions for Storybook MCP API
 */

const fs = require('fs');
const path = require('path');

/**
 * Detect Storybook version from package.json
 */
function detectStorybookVersion(projectDir) {
  try {
    const packageJsonPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Check for storybook package
    const storybookVersion = deps['storybook'] || deps['@storybook/core'];
    if (storybookVersion) {
      const match = storybookVersion.match(/(\d+)/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    // Check for framework-specific packages
    const frameworkPackages = [
      '@storybook/angular',
      '@storybook/react',
      '@storybook/vue3',
      '@storybook/svelte',
      '@storybook/web-components',
    ];

    for (const pkg of frameworkPackages) {
      if (deps[pkg]) {
        const match = deps[pkg].match(/(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Find Storybook config directory
 */
function findStorybookConfig(projectDir) {
  const possiblePaths = [
    path.join(projectDir, '.storybook'),
    path.join(projectDir, 'storybook'),
  ];

  for (const configPath of possiblePaths) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

/**
 * Detect the framework being used
 */
function detectFramework(projectDir) {
  try {
    const packageJsonPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return 'unknown';
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps['@storybook/angular'] || deps['@angular/core']) return 'angular';
    if (deps['@storybook/react'] || deps['react']) return 'react';
    if (deps['@storybook/vue3'] || deps['vue']) return 'vue';
    if (deps['@storybook/svelte'] || deps['svelte']) return 'svelte';
    if (deps['@storybook/web-components']) return 'web-components';

    return 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

module.exports = {
  detectStorybookVersion,
  findStorybookConfig,
  detectFramework,
};


