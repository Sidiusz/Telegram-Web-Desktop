'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

if (process.platform !== 'win32') {
  console.error('Signed release builds are currently configured for Windows only.');
  process.exit(2);
}

if (!process.env.WIN_CSC_LINK && !process.env.CSC_LINK) {
  console.error('Refusing to create a release: WIN_CSC_LINK/CSC_LINK is not configured.');
  console.error('Use npm run build for a local unsigned test build.');
  process.exit(2);
}

const builder = path.join(root, 'node_modules', '.bin', 'electron-builder.cmd');
const result = spawnSync(builder, ['--win', 'nsis', '--config.forceCodeSigning=true'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.status !== 0) process.exit(result.status || 1);
const artifacts = [
  path.join(root, 'dist', 'win-unpacked', 'Telegram Web Desktop.exe'),
  path.join(root, 'dist', `Telegram Web Desktop Setup ${pkg.version}.exe`),
];
for (const file of artifacts) {
  if (!fs.existsSync(file)) {
    console.error('Missing release artifact:', file);
    process.exit(3);
  }
  const escaped = file.replace(/'/g, "''");
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'; ` +
    `if($s.Status -ne 'Valid'){Write-Error ('Invalid Authenticode: '+$s.Status); exit 4}; ` +
    `Write-Output ($s.SignerCertificate.Subject)`], {
    encoding: 'utf8', windowsHide: true,
  });
  if (ps.status !== 0) {
    process.stderr.write(ps.stderr || ps.stdout || 'Authenticode validation failed\n');
    process.exit(ps.status || 4);
  }
  console.log('Valid Authenticode:', path.basename(file), '-', ps.stdout.trim());
}
console.log(`Signed release ${pkg.version} passed Authenticode verification.`);
