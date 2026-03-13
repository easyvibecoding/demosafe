#!/usr/bin/env node

/**
 * Codegen: TypeScript IPC types → Swift Codable structs.
 * Source of truth: shared/ipc-protocol/src/index.ts
 * Output: packages/swift-core/DemoSafe/Services/IPC/GeneratedTypes.swift
 *
 * TODO: Implement actual codegen parsing.
 * For now, this is a placeholder that documents the intent.
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(
    __dirname,
    '../packages/swift-core/DemoSafe/Services/IPC/GeneratedTypes.swift'
);

const header = `// AUTO-GENERATED — Do not edit manually.
// Generated from shared/ipc-protocol/src/index.ts
// Run: make codegen

import Foundation

// TODO: Implement codegen from TypeScript → Swift
// For now, manually keep Swift types in sync with TypeScript definitions.
`;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, header);
console.log(`Generated: ${OUTPUT_PATH}`);
