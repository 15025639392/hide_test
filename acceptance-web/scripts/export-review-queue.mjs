import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReviewQueueBatchExportFromEvidenceTexts,
  buildReviewQueueExportFromEvidenceText
} from '../src/reviewQueueExport.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.inputPath || args.help) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const payload = await buildPayload(args);
const json = `${JSON.stringify(payload, null, 2)}\n`;

if (args.outputPath) {
  await mkdir(path.dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, json, 'utf8');
} else {
  process.stdout.write(json);
}

async function buildPayload(args) {
  const inputStat = await stat(args.inputPath);
  if (!inputStat.isDirectory()) {
    const evidenceText = await readFile(args.inputPath, 'utf8');
    return buildReviewQueueExportFromEvidenceText(evidenceText, {
      filePath: args.inputPath,
      filter: args.filter,
      statusByReviewKey: args.statusByReviewKey
    });
  }
  const files = await collectJsonlFiles(args.inputPath);
  const items = await Promise.all(files.map(async (filePath, index) => ({
    datasetId: `dataset-${index + 1}`,
    filePath,
    fileName: path.basename(filePath),
    text: await readFile(filePath, 'utf8')
  })));
  return buildReviewQueueBatchExportFromEvidenceTexts(items, {
    sourcePath: args.inputPath,
    filter: args.filter,
    statusByReviewKey: args.statusByReviewKey
  });
}

async function collectJsonlFiles(rootPath) {
  const files = [];
  await walk(rootPath);
  return files.sort((left, right) => left.localeCompare(right));

  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath);
      }
    }
  }
}

function parseArgs(argv) {
  const parsed = {
    inputPath: '',
    outputPath: '',
    filter: 'all',
    statusByReviewKey: {},
    help: false
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--out' || arg === '-o') {
      parsed.outputPath = requireValue(argv, ++index, arg);
    } else if (arg === '--filter') {
      parsed.filter = requireValue(argv, ++index, arg);
    } else if (arg === '--status') {
      const value = requireValue(argv, ++index, arg);
      const [reviewKey, status] = value.split('=');
      if (reviewKey && status) parsed.statusByReviewKey[reviewKey] = status;
    } else if (!parsed.inputPath) {
      parsed.inputPath = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printUsage() {
  const script = path.relative(process.cwd(), fileURLToPath(import.meta.url));
  process.stderr.write([
    `Usage: node ${script} <evidence.jsonl|directory> [--filter all|metric|diagnostic|highRisk|pending] [--out review-queue.json]`,
    '',
    'Examples:',
    `  npm run export-review-queue -- session/evidence.jsonl --filter diagnostic --out /tmp/session-review-queue.json`,
    `  npm run export-review-queue -- ../app/src/test/resources/replay-fixtures --filter highRisk --out /tmp/replay-review-queues.json`,
    `  npm run export-review-queue -- session/evidence.jsonl > /tmp/session-review-queue.json`,
    ''
  ].join('\n'));
}
