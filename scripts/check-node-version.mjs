import process from 'node:process';

const requiredVersion = '24.18.0';
const currentVersion = process.versions.node;

if (currentVersion !== requiredVersion) {
  process.stderr.write(
    `Node.js ${requiredVersion} is required; current runtime is ${currentVersion}. ` +
      'Activate the version declared in .nvmrc/.node-version before running project checks.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Node.js runtime validated: ${currentVersion}\n`);
}
