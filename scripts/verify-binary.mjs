#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const launcherPath = path.resolve(__dirname, '../dist/launcher.js');

console.log(`Verifying binary entry point at ${launcherPath}...`);

// Check file exists
if (!fs.existsSync(launcherPath)) {
  console.error(`❌ Launcher file not found: ${launcherPath}`);
  process.exit(1);
}

// Check shebang
const content = fs.readFileSync(launcherPath, 'utf8');
if (!content.startsWith('#!/usr/bin/env node')) {
  console.error('❌ Shebang not found in launcher. File should start with #!/usr/bin/env node');
  process.exit(1);
}

// Check file is readable and executable
try {
  fs.accessSync(launcherPath, fs.constants.R_OK);
} catch {
  console.error('❌ Launcher file is not readable');
  process.exit(1);
}

console.log('✅ Binary entry point is correctly configured');
console.log(`  - File exists: ${launcherPath}`);
console.log('  - Shebang present: #!/usr/bin/env node');
console.log('  - File is readable');
