#!/usr/bin/env node
import { startBoardWeb } from './board-http.mts';
const { url, server } = await startBoardWeb();
console.log(`Saul Tab board: ${url}`);
const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
