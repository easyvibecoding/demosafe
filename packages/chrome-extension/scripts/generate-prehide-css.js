#!/usr/bin/env node
/**
 * Build script: extracts preHideCSS from capture-patterns.ts
 * and generates a static CSS file for manifest.json injection.
 *
 * CSS injected via manifest.json "css" field loads BEFORE any JS,
 * eliminating the flash caused by waiting for JS to execute.
 *
 * Run: node scripts/generate-prehide-css.js
 * Output: dist/content-scripts/pre-hide.css
 */

const fs = require('fs');
const path = require('path');

const srcFile = path.join(__dirname, '..', 'src', 'content-scripts', 'capture-patterns.ts');
const outFile = path.join(__dirname, '..', 'dist', 'content-scripts', 'pre-hide.css');

const src = fs.readFileSync(srcFile, 'utf-8');

// Extract all preHideCSS values from the TypeScript source
const cssBlocks = [];
const regex = /preHideCSS:\s*`([^`]+)`/g;
let match;
while ((match = regex.exec(src)) !== null) {
    cssBlocks.push(match[1].trim());
}

// Also extract hostname → selectors mapping for comments
const hostnameRegex = /hostname:\s*'([^']+)'/g;
const hostnames = [];
while ((match = hostnameRegex.exec(src)) !== null) {
    hostnames.push(match[1]);
}

// Generate CSS with comments
let css = `/* Auto-generated from capture-patterns.ts — DO NOT EDIT MANUALLY */\n`;
css += `/* Run: node scripts/generate-prehide-css.js */\n`;
css += `/* Injected via manifest.json "css" field — loads before any JS */\n\n`;

for (const block of cssBlocks) {
    css += block + '\n\n';
}

// Ensure dist directory exists
const distDir = path.dirname(outFile);
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(outFile, css);
console.log(`Generated ${outFile} (${cssBlocks.length} CSS blocks, ${css.length} bytes)`);
