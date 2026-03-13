import * as vscode from 'vscode';
import { PatternCache, PatternEntry } from './pattern-cache';

export interface ScanMatch {
    range: vscode.Range;
    maskedText: string;
    keyId: string;
    serviceName: string;
    pattern: string;
}

/**
 * Scans document text against cached patterns.
 * Uses compiled RegExp for each pattern entry.
 * Invalidates compiled cache when patterns are updated.
 */
export class PatternScanner {
    private cache: PatternCache;
    private compiledPatterns = new Map<string, RegExp>();
    private lastCacheVersion = -1;

    constructor(cache: PatternCache) {
        this.cache = cache;
    }

    /**
     * Scan a document for all matching API key patterns.
     * Returns matches sorted by position in the document.
     */
    scan(document: vscode.TextDocument): ScanMatch[] {
        const patterns = this.cache.getPatterns();
        if (patterns.length === 0) return [];

        // Recompile if cache version changed
        if (this.cache.getVersion() !== this.lastCacheVersion) {
            this.compiledPatterns.clear();
            this.lastCacheVersion = this.cache.getVersion();
        }

        const text = document.getText();
        const matches: ScanMatch[] = [];

        for (const entry of patterns) {
            const regex = this.getCompiledPattern(entry);
            if (!regex) continue;

            regex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(text)) !== null) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                matches.push({
                    range: new vscode.Range(startPos, endPos),
                    maskedText: entry.maskedPreview,
                    keyId: entry.keyId,
                    serviceName: entry.serviceName,
                    pattern: entry.pattern,
                });

                // Guard against zero-length matches causing infinite loops
                if (match[0].length === 0) {
                    regex.lastIndex++;
                }
            }
        }

        // Sort by position, then resolve overlaps (longest match wins)
        matches.sort((a, b) => a.range.start.compareTo(b.range.start));
        return this.resolveOverlaps(matches);
    }

    /**
     * Quick check if a document likely contains any keys (without full scan).
     */
    hasAnyMatch(document: vscode.TextDocument): boolean {
        const text = document.getText();
        const patterns = this.cache.getPatterns();
        for (const entry of patterns) {
            const regex = this.getCompiledPattern(entry);
            if (!regex) continue;
            regex.lastIndex = 0;
            if (regex.test(text)) return true;
        }
        return false;
    }

    private getCompiledPattern(entry: PatternEntry): RegExp | null {
        const cached = this.compiledPatterns.get(entry.keyId);
        if (cached) return cached;

        try {
            const regex = new RegExp(entry.pattern, 'g');
            this.compiledPatterns.set(entry.keyId, regex);
            return regex;
        } catch {
            // Invalid pattern — skip silently
            return null;
        }
    }

    /**
     * Remove overlapping matches, keeping the longest match at each position.
     */
    private resolveOverlaps(matches: ScanMatch[]): ScanMatch[] {
        if (matches.length <= 1) return matches;

        const resolved: ScanMatch[] = [matches[0]];
        for (let i = 1; i < matches.length; i++) {
            const current = matches[i];
            const last = resolved[resolved.length - 1];

            // Check overlap
            if (current.range.start.isBefore(last.range.end)) {
                // Keep the longer match
                const lastLength = last.range.end.character - last.range.start.character;
                const currentLength = current.range.end.character - current.range.start.character;
                if (currentLength > lastLength) {
                    resolved[resolved.length - 1] = current;
                }
            } else {
                resolved.push(current);
            }
        }
        return resolved;
    }
}
