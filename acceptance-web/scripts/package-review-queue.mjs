import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReviewQueueBatchExportFromEvidenceTexts,
  buildReviewQueueExportFromEvidenceText
} from '../src/reviewQueueExport.mjs';
import {
  buildReviewQueueMarkdownReport,
  buildReviewQueueReportModel
} from '../src/reviewQueueReport.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const acceptanceWebRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(acceptanceWebRoot, '..');
const aiPromptSourcePath = path.join(
  repoRoot,
  'docs/review-queue-ai-alignment-prompt.md'
);

const args = parseArgs(process.argv.slice(2));
if (!args.inputPath || args.help) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const payload = await buildPayload(args);
const model = buildReviewQueueReportModel(payload);
const markdown = buildReviewQueueMarkdownReport(payload);
const outDir = args.outDir || process.cwd();
const baseName = args.baseName || defaultBaseName(args.inputPath);
const jsonPath = path.join(outDir, `${baseName}.json`);
const reportPath = path.join(outDir, `${baseName}.md`);
const promptPath = path.join(outDir, `${baseName}-prompt.md`);
const manifestPath = path.join(outDir, `${baseName}-manifest.json`);
const promptText = await readFile(aiPromptSourcePath, 'utf8');
const manifest = buildPackageManifest({
  args,
  baseName,
  jsonPath,
  reportPath,
  promptPath,
  manifestPath,
  issueCount: model.issues.length
});

await mkdir(outDir, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
await writeFile(reportPath, markdown, 'utf8');
await writeFile(promptPath, promptText, 'utf8');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

process.stdout.write([
  `reviewQueueJson=${jsonPath}`,
  `reviewQueueReport=${reportPath}`,
  `aiPrompt=${promptPath}`,
  `packageManifest=${manifestPath}`,
  `issueCount=${model.issues.length}`,
  ''
].join('\n'));

if (model.issues.length > 0) {
  process.stderr.write(
    `review queue package found ${model.issues.length} issue(s); package written but not safe to send\n`
  );
  process.exit(2);
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

function buildPackageManifest({
  args,
  baseName,
  jsonPath,
  reportPath,
  promptPath,
  manifestPath,
  issueCount
}) {
  return {
    schemaVersion: 'review-queue-ai-package-v1',
    generatedAt: new Date().toISOString(),
    inputPath: args.inputPath,
    filter: args.filter,
    baseName,
    safeToSend: issueCount === 0,
    issueCount,
    files: {
      reviewQueueJson: path.basename(jsonPath),
      reviewQueueReport: path.basename(reportPath),
      aiPrompt: path.basename(promptPath),
      packageManifest: path.basename(manifestPath)
    },
    contracts: [
      'track-rs/schemas/review-queue-ai-package.schema.json',
      'track-rs/schemas/review-queue.schema.json',
      'track-rs/schemas/review-queue-batch.schema.json',
      'track-rs/schemas/streaming-settlement-state.schema.json',
      'docs/platform-neutral-evidence-jsonl-contract.md',
      'docs/platform-neutral-track-engine-contract.md',
      'docs/streaming-scenario-window-settlement-plan.md'
    ],
    notes: [
      'Send the JSON, Markdown report, and AI prompt together.',
      'Do not treat review queue packages as engine input.',
      'If safeToSend=false, fix report issues before sending the package.'
    ]
  };
}

function parseArgs(argv) {
  const parsed = {
    inputPath: '',
    outDir: '',
    baseName: '',
    filter: 'all',
    statusByReviewKey: {},
    help: false
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--out-dir') {
      parsed.outDir = requireValue(argv, ++index, arg);
    } else if (arg === '--basename') {
      parsed.baseName = safeBaseName(requireValue(argv, ++index, arg));
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

function defaultBaseName(inputPath) {
  const parsed = path.parse(String(inputPath || 'review-queue'));
  const name = parsed.name || parsed.base || 'review-queue';
  return `${safeBaseName(name)}-review-queue`;
}

function safeBaseName(value) {
  return String(value || 'review-queue')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'review-queue';
}

function printUsage() {
  const script = path.relative(process.cwd(), scriptPath);
  process.stderr.write([
    `Usage: node ${script} <evidence.jsonl|directory> [--filter all|metric|diagnostic|highRisk|pending] [--out-dir dir] [--basename name]`,
    '',
    'Examples:',
    `  npm run package-review-queue -- session/evidence.jsonl --filter all --out-dir /tmp/track-review`,
    `  npm run package-review-queue -- ../app/src/test/resources/replay-fixtures --filter highRisk --out-dir /tmp/replay-review`,
    ''
  ].join('\n'));
}
