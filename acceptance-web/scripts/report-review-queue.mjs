import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReviewQueueMarkdownReport,
  buildReviewQueueReportModel
} from '../src/reviewQueueReport.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.inputPath || args.help) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const payload = JSON.parse(await readFile(args.inputPath, 'utf8'));
const model = buildReviewQueueReportModel(payload);
const markdown = buildReviewQueueMarkdownReport(payload);

if (args.outputPath) {
  await mkdir(path.dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, markdown, 'utf8');
} else {
  process.stdout.write(markdown);
}

if (args.failOnIssues && model.issues.length > 0) {
  process.stderr.write(
    `review queue report found ${model.issues.length} issue(s); refusing to pass --fail-on-issues\n`
  );
  process.exit(2);
}

function parseArgs(argv) {
  const parsed = {
    inputPath: '',
    outputPath: '',
    failOnIssues: false,
    help: false
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--out' || arg === '-o') {
      parsed.outputPath = requireValue(argv, ++index, arg);
    } else if (arg === '--fail-on-issues') {
      parsed.failOnIssues = true;
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
    `Usage: node ${script} <review-queue.json> [--out review-queue-report.md]`,
    `       node ${script} <review-queue.json> --fail-on-issues`,
    '',
    'Examples:',
    `  npm run report-review-queue -- /tmp/review-queue.json --out /tmp/review-queue-report.md`,
    `  npm run report-review-queue -- /tmp/review-queue.json --fail-on-issues`,
    `  npm run report-review-queue -- /tmp/replay-review-queues.json`,
    ''
  ].join('\n'));
}
