/**
 * Popup script — displays connection status, demo mode, and capture mode controls.
 */

interface DemoSafeState {
    isConnected: boolean;
    isDemoMode: boolean;
    activeContextName: string | null;
    patternCount: number;
    isCaptureMode: boolean;
    captureTimeoutEnd: number | null;
    capturedCount: number;
    connectionPath: 'ws' | 'nmh' | 'offline';
}

const CONNECTION_LABELS: Record<DemoSafeState['connectionPath'], string> = {
    ws: 'Connected (WebSocket)',
    nmh: 'Connected (NMH)',
    offline: 'Offline',
};

let countdownInterval: ReturnType<typeof setInterval> | null = null;

function updateUI(state: DemoSafeState) {

    const connectionDot = document.getElementById('connectionDot')!;
    const connectionText = document.getElementById('connectionText')!;
    const modeText = document.getElementById('modeText')!;
    const contextText = document.getElementById('contextText')!;
    const patternCount = document.getElementById('patternCount')!;
    const toggleBtn = document.getElementById('toggleDemo')!;
    const headerIcon = document.getElementById('headerIcon')!;
    const captureRow = document.getElementById('captureRow')!;
    const captureText = document.getElementById('captureText')!;
    const captureDot = document.getElementById('captureDot')!;
    const captureBtn = document.getElementById('toggleCapture')!;

    // Connection — show path info (NMH is one-shot relay, shown as reachable but not persistent)
    const path = state.connectionPath ?? (state.isConnected ? 'ws' : 'offline');
    const isReachable = state.isConnected || path === 'nmh';
    if (path === 'nmh') {
        connectionDot.className = 'dot nmh';
        connectionText.textContent = CONNECTION_LABELS.nmh;
    } else if (state.isConnected) {
        connectionDot.className = 'dot connected';
        connectionText.textContent = CONNECTION_LABELS.ws;
    } else {
        connectionDot.className = 'dot offline';
        connectionText.textContent = CONNECTION_LABELS.offline;
    }

    // Mode
    modeText.textContent = state.isDemoMode ? 'Demo' : 'Normal';
    headerIcon.textContent = state.isDemoMode ? '🔴' : '🛡️';

    // Toggle demo button
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

    // Capture mode — show when reachable (WS or NMH)
    if (isReachable) {
        captureRow.style.display = '';
        captureBtn.style.display = '';

        if (state.isCaptureMode) {
            captureDot.className = 'dot capture';
            captureBtn.classList.add('active');
            captureBtn.textContent = state.capturedCount > 0
                ? `Stop Capture (${state.capturedCount} found)`
                : 'Stop Capture';
            startCountdown(state.captureTimeoutEnd);
        } else {
            captureDot.className = 'dot offline';
            captureText.textContent = 'Inactive';
            captureBtn.classList.remove('active');
            captureBtn.textContent = 'Start Capture';
            stopCountdown();
        }
    } else {
        captureRow.style.display = 'none';
        captureBtn.style.display = 'none';
        stopCountdown();
    }
}

function startCountdown(endTimestamp: number | null) {
    stopCountdown();
    if (!endTimestamp) {
        document.getElementById('captureText')!.textContent = 'Active';
        return;
    }

    const tick = () => {
        const remaining = Math.max(0, Math.floor((endTimestamp - Date.now()) / 1000));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        document.getElementById('captureText')!.textContent =
            `Active (${minutes}:${String(seconds).padStart(2, '0')})`;

        if (remaining <= 0) {
            stopCountdown();
            document.getElementById('captureText')!.textContent = 'Inactive';
        }
    };

    tick();
    countdownInterval = setInterval(tick, 1000);
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
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

// Toggle capture mode
document.getElementById('toggleCapture')!.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'toggle_capture_mode' });
});
