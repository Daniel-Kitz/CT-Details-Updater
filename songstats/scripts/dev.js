#!/usr/bin/env node
import { spawn } from 'node:child_process';

const children = [];

function run(name, command, args, color) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const prefix = `\u001b[${color}m[${name}]\u001b[0m `;
  const pipe = (stream, target) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.replace(/\n$/, '').split('\n')) {
        target.write(`${prefix}${line}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', 'npx', ['tsx', 'watch', 'src/server/index.ts'], '36');
run('web', 'npx', ['vite'], '35');
