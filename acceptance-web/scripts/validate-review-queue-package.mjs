import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const acceptanceWebRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(acceptanceWebRoot, '..');
const manifestSchemaPath = path.join(
  repoRoot,
  'track-rs/schemas/review-queue-ai-package.schema.json'
);

const args = parseArgs(process.argv.slice(2));
if (!args.manifestPath || args.help) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const manifest = JSON.parse(await readFile(args.manifestPath, 'utf8'));
const schema = JSON.parse(await readFile(manifestSchemaPath, 'utf8'));
const issues = await validatePackageManifest(manifest, schema, args.manifestPath);

if (issues.length > 0) {
  for (const issue of issues) {
    process.stderr.write(`review queue package issue: ${issue}\n`);
  }
  process.exit(2);
}

process.stdout.write(`reviewQueuePackageManifest=${args.manifestPath}\n`);
process.stdout.write('reviewQueuePackageValid=true\n');

async function validatePackageManifest(manifest, schema, manifestPath) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be a JSON object'];
  }

  for (const field of schema.required || []) {
    if (!Object.hasOwn(manifest, field)) {
      issues.push(`missing required field ${field}`);
    }
  }

  const expectedSchemaVersion = schema.properties?.schemaVersion?.const;
  if (manifest.schemaVersion !== expectedSchemaVersion) {
    issues.push(`schemaVersion must be ${expectedSchemaVersion}`);
  }

  const filterEnum = schema.properties?.filter?.enum || [];
  if (!filterEnum.includes(manifest.filter)) {
    issues.push(`filter must be one of ${filterEnum.join(', ')}`);
  }

  if (typeof manifest.safeToSend !== 'boolean') {
    issues.push('safeToSend must be boolean');
  }
  if (!Number.isInteger(manifest.issueCount) || manifest.issueCount < 0) {
    issues.push('issueCount must be a non-negative integer');
  }
  if (manifest.safeToSend !== (manifest.issueCount === 0)) {
    issues.push('safeToSend must equal issueCount === 0');
  }

  const files = manifest.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    issues.push('files must be an object');
  } else {
    const packageDir = path.dirname(manifestPath);
    const requiredFiles = schema.properties?.files?.required || [];
    for (const field of requiredFiles) {
      const fileName = files[field];
      if (typeof fileName !== 'string' || fileName.length === 0) {
        issues.push(`files.${field} must be a file name`);
        continue;
      }
      if (fileName.includes('/') || fileName.includes('\\')) {
        issues.push(`files.${field} must not include path separators`);
        continue;
      }
      const filePath = path.join(packageDir, fileName);
      try {
        await access(filePath);
      } catch {
        issues.push(`files.${field} does not exist: ${fileName}`);
      }
    }
    issues.push(...await validatePackageFileContents(files, packageDir, manifestPath));
  }

  const requiredContract = schema.properties?.contracts?.contains?.const;
  if (!Array.isArray(manifest.contracts)) {
    issues.push('contracts must be an array');
  } else if (requiredContract && !manifest.contracts.includes(requiredContract)) {
    issues.push(`contracts must include ${requiredContract}`);
  }

  if (!Array.isArray(manifest.notes)) {
    issues.push('notes must be an array');
  }

  return issues;
}

async function validatePackageFileContents(files, packageDir, manifestPath) {
  const issues = [];
  const reviewQueueJsonPath = packageFilePath(files.reviewQueueJson, packageDir);
  const reportPath = packageFilePath(files.reviewQueueReport, packageDir);
  const promptPath = packageFilePath(files.aiPrompt, packageDir);
  const packageManifestPath = packageFilePath(files.packageManifest, packageDir);

  if (reviewQueueJsonPath) {
    try {
      const payload = JSON.parse(await readFile(reviewQueueJsonPath, 'utf8'));
      if (!['review-queue-v1', 'review-queue-batch-v1'].includes(payload.schemaVersion)) {
        issues.push('files.reviewQueueJson must be review-queue-v1 or review-queue-batch-v1');
      }
    } catch {
      issues.push('files.reviewQueueJson must be valid JSON');
    }
  }

  if (reportPath) {
    try {
      const report = await readFile(reportPath, 'utf8');
      if (!report.includes('review-queue-alignment-report-v1')) {
        issues.push('files.reviewQueueReport must contain review-queue-alignment-report-v1');
      }
    } catch {
      issues.push('files.reviewQueueReport must be readable');
    }
  }

  if (promptPath) {
    try {
      const prompt = await readFile(promptPath, 'utf8');
      if (!prompt.includes('Review Queue AI 对齐提示词')) {
        issues.push('files.aiPrompt must contain the fixed review queue AI prompt');
      }
    } catch {
      issues.push('files.aiPrompt must be readable');
    }
  }

  if (packageManifestPath && path.resolve(packageManifestPath) !== path.resolve(manifestPath)) {
    issues.push('files.packageManifest must point to the manifest being validated');
  }

  return issues;
}

function packageFilePath(fileName, packageDir) {
  if (typeof fileName !== 'string' || fileName.length === 0) return null;
  if (fileName.includes('/') || fileName.includes('\\')) return null;
  return path.join(packageDir, fileName);
}

function parseArgs(argv) {
  const parsed = {
    manifestPath: '',
    help: false
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (!parsed.manifestPath) {
      parsed.manifestPath = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printUsage() {
  const script = path.relative(process.cwd(), scriptPath);
  process.stderr.write([
    `Usage: node ${script} <review-queue-package-manifest.json>`,
    '',
    'Examples:',
    `  npm run validate-review-queue-package -- /tmp/track-review/session-review-queue-manifest.json`,
    ''
  ].join('\n'));
}
