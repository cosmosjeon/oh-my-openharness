import { stdin as input } from 'node:process';
import { handleFactoryHookStdin } from './runtime';

const chunks: Buffer[] = [];
for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

const result = await handleFactoryHookStdin(Buffer.concat(chunks).toString('utf8'));
process.stdout.write(result.stdout);
process.exitCode = result.exitCode;
