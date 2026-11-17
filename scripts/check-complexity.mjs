#!/usr/bin/env node
// Deployment guard matching the Roast My Codebase complexity scanner's
// critical threshold. Keep functions below 25 decision points.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? '.');
const CRITICAL_THRESHOLD = 25;
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.git',
  '.turbo',
  '.cache',
  'out',
  '.output',
]);
const SKIPPED_NAMES = new Set([
  'if',
  'else',
  'for',
  'while',
  'switch',
  'catch',
  'import',
  'from',
  'return',
  'class',
  'interface',
  'type',
  'constructor',
]);
const FUNCTION_PATTERNS = [
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
  /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
  /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/,
  /^\s+(?:public|private|protected|static|async|\s)*\s*(\w+)\s*\([^)]*\)\s*(?::\s*\w[^{]*)?\s*\{/,
];
const CONSTRUCTOR_PATTERN = /^\s+constructor\s*\(/;
const CLEANUP_PATTERNS = [
  [/\/\/.*$/gm, ''],
  [/\/\*[\s\S]*?\*\//g, ''],
  [/"(?:[^"\\]|\\.)*"/g, '""'],
  [/'(?:[^'\\]|\\.)*'/g, "''"],
  [/`(?:[^`\\]|\\.)*`/g, '``'],
];
const DECISION_PATTERNS = [
  [/\bif\s*\(/g, 1],
  [/\belse\s+if\s*\(/g, 1],
  [/\bcase\s+/g, 1],
  [/\bwhile\s*\(/g, 1],
  [/\bfor\s*\(/g, 1],
  [/&&/g, 1],
  [/\|\|/g, 1],
  [/\?\./g, 1],
  [/\?\?/g, 1],
  [/\bcatch\s*\(/g, 1],
  [/\?(?![.?])/g, 1],
];
const ELSE_IF_PATTERN = /\belse\s+if\s*\(/g;

function walk(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walk(entryPath, files);
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      files.push(entryPath);
    }
  }
}

function extractFunctionBody(lines, startLine) {
  let braceCount = 0;
  let started = false;
  const bodyLines = [];

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const character of line) {
      if (character === '{') {
        braceCount++;
        started = true;
      } else if (character === '}') {
        braceCount--;
      }
    }
    bodyLines.push(line);
    if (started && braceCount === 0) return bodyLines.join('\n');
  }

  if (!started && bodyLines.length > 0) {
    return bodyLines.slice(0, 5).join('\n');
  }
  return null;
}

function extractFunctions(content) {
  const functions = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let fnName = null;
    for (const pattern of FUNCTION_PATTERNS) {
      const match = line.match(pattern);
      if (match && match[1]) {
        if (SKIPPED_NAMES.has(match[1])) continue;
        fnName = match[1];
        break;
      }
    }
    if (!fnName && CONSTRUCTOR_PATTERN.test(line)) fnName = 'constructor';
    if (fnName) {
      const body = extractFunctionBody(lines, i);
      if (body) functions.push({ name: fnName, line: i + 1, body });
    }
  }
  return functions;
}

function calculateComplexity(body) {
  let complexity = 1;
  let cleaned = body;
  for (const [pattern, replacement] of CLEANUP_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  for (const [pattern, weight] of DECISION_PATTERNS) {
    const matches = cleaned.match(new RegExp(pattern.source, pattern.flags));
    if (matches) complexity += matches.length * weight;
  }
  const elseIfMatches = cleaned.match(
    new RegExp(ELSE_IF_PATTERN.source, ELSE_IF_PATTERN.flags)
  );
  if (elseIfMatches) complexity -= elseIfMatches.length;
  return complexity;
}

function inspectFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const relativeFile = path.relative(ROOT, file);
  return extractFunctions(content).map((fn) => ({
    file: relativeFile,
    name: fn.name,
    line: fn.line,
    complexity: calculateComplexity(fn.body),
  }));
}

function main() {
  const files = [];
  walk(ROOT, files);
  const results = [];
  for (const file of files) results.push(...inspectFile(file));

  const maxComplexity = results.reduce(
    (max, result) => Math.max(max, result.complexity),
    0
  );
  const critical = results.filter(
    (result) => result.complexity >= CRITICAL_THRESHOLD
  );

  for (const result of results
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 8)) {
    console.log(
      `${String(result.complexity).padStart(3)}  ${result.file}:${result.line} ${result.name}`
    );
  }

  if (critical.length > 0) {
    console.error(
      `\nFAIL: ${critical.length} function(s) reached critical complexity (>= ${CRITICAL_THRESHOLD}).`
    );
    process.exitCode = 1;
  } else {
    console.log(
      `\nOK: 0 critical complexity findings across ${results.length} functions; max=${maxComplexity}.`
    );
  }
}

main();
