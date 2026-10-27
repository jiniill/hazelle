#!/usr/bin/env node
import { spawn } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';

// Give the server its own process group: npm/tsx do not forward signals and could orphan Node with port/data lock.
// Keep Vite in the terminal group for keyboard input.
const server = spawn('npm', ['run', '-s', 'server'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true });
const vite = spawn('./node_modules/.bin/vite', process.argv.slice(2), { stdio: 'inherit' });

const stopServer = (signal) => {
  try {
    process.kill(-server.pid, signal);
  } catch {
    // The group is already gone.
  }
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopServer(signal);
    vite.kill(signal);
  });
}
vite.on('exit', (code) => {
  stopServer('SIGTERM');
  process.exitCode = code ?? 1;
});
// A child that cannot be spawned fires error, not exit: the other one must still be stopped.
vite.on('error', (error) => {
  console.error(error.message);
  stopServer('SIGTERM');
  process.exitCode = 1;
});
server.on('exit', () => vite.kill('SIGTERM'));
server.on('error', (error) => {
  console.error(error.message);
  vite.kill('SIGTERM');
  process.exitCode = 1;
});
