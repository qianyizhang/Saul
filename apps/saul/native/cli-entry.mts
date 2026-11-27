#!/usr/bin/env node
import { runCli } from './cli.mts';

process.exitCode = await runCli(process.argv.slice(2));
