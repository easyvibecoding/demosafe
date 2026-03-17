#!/usr/bin/env node
/**
 * Build script: extracts preHideCSS from capture-patterns.ts
 * and generates PER-PLATFORM CSS files for manifest.json injection.
 *
 * Each platform gets its own CSS file, injected only on its URLs.
 * This eliminates cross-platform CSS collisions.
 *
 * Run: node scripts/generate-prehide-css.js
 * Output: dist/css/prehide-{hostname}.css for each platform
 *         dist/css/manifest-css-entries.json (for reference)
 */

const fs = require('fs');
const path = require('path');

const srcFile = path.join(__dirname, '..', 'src', 'content-scripts', 'capture-patterns.ts');
const outDir = path.join(__dirname, '..', 'dist', 'css');

const src = fs.readFileSync(srcFile, 'utf-8');

// Parse capture-patterns.ts to extract hostname → preHideCSS mapping
// Strategy: split by pattern entries, extract preHideCSS and all hostnames from each
const patterns = [];

// Split source into individual pattern entries (between { id: '...' })
const entries = src.split(/(?=\{\s*\n\s*id:\s*')/);

for (const entry of entries) {
    // Extract preHideCSS
    const cssMatch = entry.match(/preHideCSS:\s*`([^`]+)`/);
    if (!cssMatch) continue;
    const css = cssMatch[1].trim();

    // Extract id
    const idMatch = entry.match(/id:\s*'([^']+)'/);
    const id = idMatch ? idMatch[1] : 'unknown';

    // Extract ALL hostnames from platformSelectors in this entry
    const hostnameRegex = /hostname:\s*'([^']+)'/g;
    let hostMatch;
    const hostnames = [];
    while ((hostMatch = hostnameRegex.exec(entry)) !== null) {
        hostnames.push(hostMatch[1]);
    }

    if (hostnames.length > 0) {
        patterns.push({ id, css, hostnames });
    }
}

let match;

// Group CSS by hostname (merge if multiple patterns share a hostname)
const hostnameCSS = {};
for (const pattern of patterns) {
    for (const hostname of pattern.hostnames) {
        if (!hostnameCSS[hostname]) hostnameCSS[hostname] = [];
        hostnameCSS[hostname].push(pattern.css);
    }
}

// Ensure output directory exists
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

// Generate per-hostname CSS files
const generated = [];
for (const [hostname, cssBlocks] of Object.entries(hostnameCSS)) {
    const safeName = hostname.replace(/[^a-z0-9]/g, '-');
    const fileName = `prehide-${safeName}.css`;
    const filePath = path.join(outDir, fileName);

    let css = `/* Pre-hide CSS for ${hostname} — AUTO-GENERATED, DO NOT EDIT */\n`;
    css += `/* Source: capture-patterns.ts */\n\n`;
    for (const block of cssBlocks) {
        css += block + '\n\n';
    }

    fs.writeFileSync(filePath, css);
    generated.push({ hostname, fileName, filePath, size: css.length });
}

// Save manifest reference
const manifestEntries = generated.map(g => ({
    hostname: g.hostname,
    cssFile: `dist/css/${g.fileName}`,
}));
fs.writeFileSync(
    path.join(outDir, 'manifest-css-entries.json'),
    JSON.stringify(manifestEntries, null, 2)
);

console.log(`Generated ${generated.length} per-platform CSS files:`);
for (const g of generated) {
    console.log(`  ${g.fileName} (${g.hostname}, ${g.size} bytes)`);
}
