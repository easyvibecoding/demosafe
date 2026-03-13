.PHONY: help build-core build-vscode build-chrome build-all test clean codegen

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# === Swift Core ===
build-core: ## Build Swift Core (macOS app)
	cd packages/swift-core && swift build

test-core: ## Run Swift Core tests
	cd packages/swift-core && swift test

run-core: ## Run Swift Core in debug mode
	cd packages/swift-core && swift run DemoSafe

# === Shared IPC Protocol ===
build-shared: ## Build shared IPC protocol types
	npm run build --workspace=shared/ipc-protocol

codegen: build-shared ## Generate Swift types from TypeScript IPC definitions
	node scripts/codegen-swift-ipc.js

# === VS Code Extension ===
build-vscode: ## Build VS Code extension
	npm run build --workspace=packages/vscode-extension

test-vscode: ## Run VS Code extension tests
	npm run test --workspace=packages/vscode-extension

package-vscode: build-vscode ## Package VS Code extension as .vsix
	cd packages/vscode-extension && npx @vscode/vsce package

# === Chrome Extension ===
build-chrome: ## Build Chrome extension
	npm run build --workspace=packages/chrome-extension

# === All ===
build-all: build-shared codegen build-core build-vscode build-chrome ## Build everything

test-all: test-core test-vscode ## Run all tests

clean: ## Clean all build artifacts
	cd packages/swift-core && swift package clean
	rm -rf packages/vscode-extension/out packages/vscode-extension/dist
	rm -rf packages/chrome-extension/dist
	rm -rf shared/ipc-protocol/dist

type-check: ## Run TypeScript type checking across all workspaces
	npm run type-check

lint: ## Run linting across all workspaces
	npm run lint
