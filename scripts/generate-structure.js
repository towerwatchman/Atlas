const fs = require('fs').promises;
const path = require('path');

async function generateStructure(dir, prefix = '', exclude = ['node_modules', '.git', 'dist']) {
  let output = '';
  try {
    const items = (await fs.readdir(dir)).filter(
      item => !exclude.includes(item) && (!item.startsWith('.') || item === '.env')
    );

    if (items.length === 0) {
      return `${prefix}(empty directory)\n`;
    }

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const fullPath = path.join(dir, item);
      let stats;
      try {
        stats = await fs.stat(fullPath);
      } catch (err) {
        console.error(`Error reading stats for ${fullPath}: ${err.message}`);
        continue;
      }
      const isLast = index === items.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      let line = `${prefix}${connector}${item}`;
      if (stats.isFile()) {
        line += ` (${stats.size} bytes)`;
      }
      output += `${line}\n`;

      // Skip contents of public/images/tickers but still show the folder
      const relativePath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
      if (stats.isDirectory() && relativePath !== 'public/images/tickers') {
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        output += await generateStructure(fullPath, newPrefix, exclude);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}: ${err.message}`);
  }
  return output;
}

async function main() {
  const projectDir = process.cwd();
  const structure = await generateStructure(projectDir);

  if (structure) {
    console.log(structure); // Output to stdout for redirection
  } else {
    console.error('No structure generated. Check if the directory is empty or all items are excluded.');
  }
}

main().catch(err => console.error(`Error in main: ${err.message}`));