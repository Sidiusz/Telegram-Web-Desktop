'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

if (process.platform !== 'win32') {
  console.error('Windows release builds are currently supported on Windows only.');
  process.exit(2);
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.error(label + ' failed.');
    process.exit(result.status || 1);
  }
}

const localElectronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(localElectronExe)) {
  console.error('Local Electron runtime is missing. Run npm install before building.');
  process.exit(2);
}

const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
if (!fs.existsSync(npmCli)) {
  console.error('npm CLI is unavailable:', npmCli);
  process.exit(2);
}
run(process.execPath, [npmCli, 'test'], 'Regression tests');
run(process.execPath, [npmCli, 'run', 'test:smoke'], 'Smoke test');

const builderCli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
if (!fs.existsSync(builderCli)) {
  console.error('electron-builder CLI is unavailable:', builderCli);
  process.exit(2);
}
run(process.execPath, [builderCli, '--win', 'nsis', '--config.electronDist=node_modules/electron/dist'], 'Release build');

const artifacts = [
  path.join(root, 'dist', 'win-unpacked', 'Telegram Web Desktop.exe'),
  path.join(root, 'dist', `Telegram Web Desktop Setup ${pkg.version}.exe`),
];
for (const file of artifacts) {
  if (!fs.existsSync(file)) {
    console.error('Missing release artifact:', file);
    process.exit(3);
  }
}

console.log(`Release ${pkg.version} built successfully.`);
