import { copyFileSync } from 'fs';
import { execSync } from 'child_process';
const cwd = '/workspaces/lumen-forge-platform';
copyFileSync('public/logo_navbar.svg', 'public/logo.svg');
console.log('copied OK');
execSync('git add public/logo.svg', {cwd});
console.log(execSync('git commit -m "feat: logo final vectorizado desde Inkscape"', {cwd}).toString());
console.log(execSync('git push origin main', {cwd}).toString());