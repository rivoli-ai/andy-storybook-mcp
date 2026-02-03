/**
 * Story and component file parsers
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract JSDoc comments and metadata from component file
 */
function extractComponentDocs(componentFilePath) {
  try {
    if (!fs.existsSync(componentFilePath)) {
      return null;
    }

    const content = fs.readFileSync(componentFilePath, 'utf8');
    const docs = {
      properties: {},
      description: '',
    };

    // Extract class/component description
    const classDocMatch = content.match(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*(?:@Component|export\s+(?:default\s+)?(?:function|class|const))/);
    if (classDocMatch) {
      docs.description = classDocMatch[1].replace(/^\s*\*\s?/gm, '').trim();
    }

    // Extract selector (Angular)
    const selectorMatch = content.match(/selector:\s*['"]([^'"]+)['"]/);
    if (selectorMatch) {
      docs.selector = selectorMatch[1];
    }

    // Extract template (Angular inline)
    const templateMatch = content.match(/template:\s*`([\s\S]*?)`/);
    if (templateMatch) {
      docs.template = templateMatch[1].trim();
    }

    // Extract templateUrl (Angular external)
    const templateUrlMatch = content.match(/templateUrl:\s*['"]([^'"]+)['"]/);
    if (templateUrlMatch) {
      docs.templateUrl = templateUrlMatch[1];
      const templatePath = path.resolve(path.dirname(componentFilePath), templateUrlMatch[1]);
      if (fs.existsSync(templatePath)) {
        docs.template = fs.readFileSync(templatePath, 'utf8').trim();
      }
    }

    // Extract Angular @Input/@Output properties
    const propDocRegex = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*@(Input|Output)\(\)\s*(\w+)/g;
    let match;
    while ((match = propDocRegex.exec(content)) !== null) {
      const description = match[1].replace(/^\s*\*\s?/gm, '').trim();
      const decorator = match[2];
      const propertyName = match[3];
      const isRequired = description.includes('@required');

      docs.properties[propertyName] = {
        description: description.replace(/@required/g, '').trim(),
        type: decorator.toLowerCase(),
        required: isRequired,
      };
    }

    // Extract React props (from PropTypes or TypeScript interface)
    const propsInterfaceMatch = content.match(/interface\s+\w*Props\s*\{([\s\S]*?)\}/);
    if (propsInterfaceMatch) {
      const propsStr = propsInterfaceMatch[1];
      const propRegex = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*(\w+)(\?)?:\s*([^;]+)/g;
      while ((match = propRegex.exec(propsStr)) !== null) {
        const description = match[1].replace(/^\s*\*\s?/gm, '').trim();
        const propName = match[2];
        const optional = !!match[3];
        const propType = match[4].trim();

        docs.properties[propName] = {
          description,
          tsType: propType,
          required: !optional,
        };
      }
    }

    // Extract TypeScript property types
    const propTypeRegex = /(\w+)(?:\?)?:\s*([^=;]+)(?:\s*=\s*([^;]+))?;/g;
    while ((match = propTypeRegex.exec(content)) !== null) {
      const propertyName = match[1];
      const type = match[2].trim();
      const defaultValue = match[3] ? match[3].trim() : undefined;

      if (docs.properties[propertyName]) {
        docs.properties[propertyName].tsType = type;
        if (defaultValue) {
          docs.properties[propertyName].defaultValue = defaultValue;
        }
      }
    }

    // Extract component code
    const classMatch = content.match(/@Component[\s\S]*?export\s+class\s+\w+[\s\S]*?\n\}/);
    if (classMatch) {
      docs.componentCode = classMatch[0];
    }

    // React functional component
    const funcMatch = content.match(/export\s+(?:default\s+)?function\s+\w+[\s\S]*?\n\}/);
    if (funcMatch && !docs.componentCode) {
      docs.componentCode = funcMatch[0];
    }

    return docs;
  } catch (error) {
    return null;
  }
}

/**
 * Extract story examples from story file
 */
function extractStoryExamples(storyFilePath) {
  try {
    if (!fs.existsSync(storyFilePath)) {
      return null;
    }

    const content = fs.readFileSync(storyFilePath, 'utf8');
    const examples = {
      stories: {},
      imports: [],
      meta: null,
    };

    // Extract imports
    const importMatches = content.match(/^import\s+.*?;$/gm);
    if (importMatches) {
      examples.imports = importMatches;
    }

    // Extract meta/default export
    const metaMatch = content.match(/const\s+meta[^=]*=\s*\{[\s\S]*?\};?\s*export\s+default\s+meta/);
    if (metaMatch) {
      examples.meta = metaMatch[0];
    } else {
      const altMetaMatch = content.match(/export\s+default\s+\{[\s\S]*?\}\s*(?:as|;)/);
      if (altMetaMatch) {
        examples.meta = altMetaMatch[0];
      }
    }

    // Extract each story export
    const storyRegex = /export\s+const\s+(\w+)(?::\s*\w+)?\s*=\s*\{([\s\S]*?)\};/g;
    let match;
    while ((match = storyRegex.exec(content)) !== null) {
      const storyName = match[1];
      const storyContent = match[2];

      const argsMatch = storyContent.match(/args:\s*\{([\s\S]*?)\}/);
      let args = {};
      if (argsMatch) {
        const argsStr = argsMatch[1];
        const argLines = argsStr.split(',');
        argLines.forEach(line => {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).trim();
            let value = line.substring(colonIdx + 1).trim().replace(/,\s*$/, '');
            if (key) args[key] = value;
          }
        });
      }

      examples.stories[storyName] = {
        code: `export const ${storyName} = {${storyContent}};`,
        args,
      };
    }

    return examples;
  } catch (error) {
    return null;
  }
}

/**
 * Parse story file and extract metadata
 */
function parseStoryFile(filePath, storyId, projectDir) {
  try {
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, 'utf8');
    const storyData = { id: storyId, filePath };

    // Extract component reference
    const componentMatch = content.match(/component:\s*(\w+)/);
    if (componentMatch) {
      storyData.component = componentMatch[1];

      // Find component file
      const importMatch = content.match(new RegExp(`import\\s*\\{[^}]*${componentMatch[1]}[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`));
      if (importMatch) {
        const storyDir = path.dirname(filePath);
        let componentFilePath = path.resolve(storyDir, importMatch[1]);
        
        // Try different extensions
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
        for (const ext of extensions) {
          const fullPath = componentFilePath.endsWith(ext) ? componentFilePath : componentFilePath + ext;
          if (fs.existsSync(fullPath)) {
            const componentDocs = extractComponentDocs(fullPath);
            if (componentDocs) {
              storyData.componentDocs = componentDocs;
            }
            break;
          }
        }
      }
    }

    // Extract argTypes
    const argTypesBlockMatch = content.match(/argTypes:\s*\{([\s\S]*?)\},?\s*(?:\/\/|args:|tags:|$)/);
    if (argTypesBlockMatch) {
      storyData.argTypes = {};
      const propRegex = /(\w+):\s*\{([^{}]*)\}/g;
      let match;
      while ((match = propRegex.exec(argTypesBlockMatch[1])) !== null) {
        const controlMatch = match[2].match(/control:\s*['"]([^'"]+)['"]/);
        if (controlMatch) {
          storyData.argTypes[match[1]] = { control: controlMatch[1] };
        }
      }
    }

    // Extract story-specific args
    const storyName = storyId.split('--')[1];
    if (storyName && storyName !== 'docs') {
      const pascalName = storyName.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
      const storyPattern = new RegExp(`export\\s+const\\s+${pascalName}[^=]*=\\s*\\{[^}]*args:\\s*\\{([^}]+)\\}`, 's');
      const storyMatch = content.match(storyPattern);

      if (storyMatch) {
        storyData.args = {};
        const argLines = storyMatch[1].split(',');
        argLines.forEach(line => {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).trim();
            let value = line.substring(colonIdx + 1).trim().replace(/,\s*$/, '').replace(/^['"]|['"]$/g, '');
            if (value === 'true') value = true;
            else if (value === 'false') value = false;
            else if (!isNaN(value) && value !== '') value = Number(value);
            if (key) storyData.args[key] = value;
          }
        });
      }
    }

    return storyData;
  } catch (error) {
    return null;
  }
}

/**
 * Generate HTML usage example
 */
function generateUsageExample(selector, args, storyName, framework = 'angular') {
  if (!selector) return null;

  const attrs = Object.entries(args || {})
    .map(([key, value]) => {
      if (value === 'true' || value === true) {
        return framework === 'angular' ? `[${key}]="true"` : `${key}={true}`;
      }
      if (value === 'false' || value === false) {
        return framework === 'angular' ? `[${key}]="false"` : `${key}={false}`;
      }
      if (typeof value === 'string') {
        if (value.startsWith("'") || value.startsWith('"')) {
          return `${key}=${value}`;
        }
        return `${key}="${value}"`;
      }
      return framework === 'angular' ? `[${key}]="${value}"` : `${key}={${value}}`;
    })
    .join('\n    ');

  return `<!-- ${storyName} Example -->\n<${selector}\n    ${attrs}>\n</${selector}>`;
}

module.exports = {
  extractComponentDocs,
  extractStoryExamples,
  parseStoryFile,
  generateUsageExample,
};


