import process from 'node:process';

const requiredMajor = 24;
const currentVersion = process.versions.node;
const currentMajor = Number.parseInt(currentVersion.split('.')[0] ?? '0', 10);

if (currentMajor !== requiredMajor) {
  process.stderr.write(
    `Node.js ${requiredMajor} LTS is required; current runtime is ${currentVersion}. ` +
      'Activate the version declared in .nvmrc/.node-version before running project checks.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Node.js runtime validated: ${currentVersion}\n`);
}
