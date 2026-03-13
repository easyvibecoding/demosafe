/**
 * Popup script — displays connection status and provides quick actions.
 */

interface DemoSafeState {
    isConnected: boolean;
    isDemoMode: boolean;
    activeContextName: string | null;
    patternCount: number;
}

function updateUI(state: DemoSafeState) {
    const connectionDot = document.getElementById('connectionDot')!;
    const connectionText = document.getElementById('connectionText')!;
    const modeText = document.getElementById('modeText')!;
    const contextText = document.getElementById('contextText')!;
    const patternCount = document.getElementById('patternCount')!;
    const toggleBtn = document.getElementById('toggleDemo')!;
    const headerIcon = document.getElementById('headerIcon')!;

    // Connection
    if (state.isConnected) {
        connectionDot.className = 'dot connected';
        connectionText.textContent = 'Connected';
    } else {
        connectionDot.className = 'dot offline';
        connectionText.textContent = 'Offline';
    }

    // Mode
    modeText.textContent = state.isDemoMode ? 'Demo' : 'Normal';
    headerIcon.textContent = state.isDemoMode ? '🔴' : '🛡️';

    // Toggle button
    if (state.isDemoMode) {
        toggleBtn.classList.add('active');
        toggleBtn.textContent = 'Exit Demo Mode';
    } else {
        toggleBtn.classList.remove('active');
        toggleBtn.textContent = 'Enter Demo Mode';
    }

    // Context
    contextText.textContent = state.activeContextName ?? '—';

    // Patterns
    patternCount.textContent = String(state.patternCount);
}

// Get initial state
chrome.runtime.sendMessage({ type: 'get_state' }, (response: DemoSafeState) => {
    if (response) updateUI(response);
});

// Listen for state updates
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'state_update') {
        updateUI(message.state);
    }
});

// Toggle demo mode
document.getElementById('toggleDemo')!.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'toggle_demo_mode' });
});
