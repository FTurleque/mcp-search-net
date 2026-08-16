import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const stages = [
  ['format', ['run', 'format:check']],
  ['lint', ['run', 'lint']],
  ['typecheck', ['run', 'typecheck']],
  ['build', ['run', 'build']],
  ['client-contract', ['run', 'client:contract-report']],
  ['coverage', ['run', 'test:coverage']],
];

for (const [name, args] of stages) {
  const result = spawnSync(npm, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status === 0) {
    process.stdout.write(`CHECK_STAGE_PASS ${name}\n`);
    continue;
  }
  const tail = output.slice(-12000);
  const encoded = Buffer.from(tail, 'utf8').toString('base64');
  process.stdout.write(`::error title=CHECK_STAGE_${name}::${encoded}\n`);
  process.exitCode = result.status ?? 1;
  break;
}
