#!/usr/bin/env bun

import { $ } from "bun";

// Load use-m and yargs dynamically
const { use } = eval(
  await fetch('https://unpkg.com/use-m/use.js').then(u => u.text())
);

const yargsModule = await use('yargs@latest');
const yargs = yargsModule.default || yargsModule;

// Configure command line arguments - prompt as positional argument
const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 <prompt>')
  .positional('prompt', {
    type: 'string',
    description: 'The prompt to send to Claude'
  })
  .demandCommand(1, 'You must provide a prompt')
  .help('h')
  .alias('h', 'help')
  .argv;

const prompt = argv._[0];

// Execute the claude command with fixed options for Docker environment
try {
  const result = await $`/Users/konard/.claude/local/claude -p '${prompt}' --output-format 'stream-json' --verbose --dangerously-skip-permissions | jq`;
  console.log(result.text());
} catch (error) {
  console.error('Error executing command:', error.message);
  process.exit(1);
}