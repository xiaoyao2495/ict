'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const testDirectory = path.resolve(__dirname, '..', 'test');
const files = fs.readdirSync(testDirectory)
  .filter((file) => file.endsWith('.test.js'))
  .sort();

for (const file of files) {
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(testDirectory, file)],
    {
      stdio: 'inherit',
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}

if (!process.exitCode) {
  console.log(
    '\n' + files.length + ' test files passed.'
  );
}
