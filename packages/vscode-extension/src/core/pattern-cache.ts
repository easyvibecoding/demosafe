import * as vscode from 'vscode';

export interface PatternEntry {
    keyId: string;
    serviceId: string;
    serviceName: string;
    pattern: string;
    maskFormat: {
        showPrefix: number;
        showSuffix: number;
        maskChar: string;
        separator: string;
    };
    maskedPreview: string;
}

const CACHE_KEY = 'demosafe.patternCache';
const VERSION_KEY = 'demosafe.patternCacheVersion';

/**
 * Persistent pattern cache stored in VS Code globalState.
 * Survives extension restarts and provides offline masking capability.
 */
export class PatternCache {
    private patterns: PatternEntry[] = [];
    private version: number = 0;
    private globalState: vscode.Memento;

    constructor(globalState: vscode.Memento) {
        this.globalState = globalState;
        this.loadFromStorage();
    }

    getPatterns(): PatternEntry[] {
        return this.patterns;
    }

    getVersion(): number {
        return this.version;
    }

    updateFull(version: number, patterns: PatternEntry[]) {
        this.version = version;
        this.patterns = patterns;
        this.persistToStorage();
    }

    updateIncremental(action: 'add' | 'update' | 'delete', keyId: string, _pattern?: string) {
        if (action === 'delete') {
            this.patterns = this.patterns.filter(p => p.keyId !== keyId);
        }
        // add/update handled via full sync for now
        this.persistToStorage();
    }

    hasCache(): boolean {
        return this.patterns.length > 0;
    }

    private loadFromStorage() {
        const cached = this.globalState.get<PatternEntry[]>(CACHE_KEY);
        if (cached) {
            this.patterns = cached;
            this.version = this.globalState.get<number>(VERSION_KEY) ?? 0;
        }
    }

    private persistToStorage() {
        this.globalState.update(CACHE_KEY, this.patterns);
        this.globalState.update(VERSION_KEY, this.version);
    }
}
