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
  .demandCommand(1, 'The prompt is required')
  .help('h')
  .alias('h', 'help')
  .argv;

const prompt = argv._[0];

const claudePath = '/Users/konard/.claude/local/claude';

try {
  const result = await $`${claudePath} -p '${prompt}' --output-format 'stream-json' --verbose --dangerously-skip-permissions --append-system-prompt 'All code changes must be tested before finishing the work.' --model sonnet | jq`;
  console.log(result.text());
} catch (error) {
  console.error('Error executing command:', error.message);
  process.exit(1);
}