# System-Wide Masking: Advanced Secure Approach (Community Contribution Guide)

## Current State

The current system-wide masking uses **Accessibility overlay** (`AXObserver` + `NSPanel`) — a visual-only approach:
- ✅ Key not visible on screen
- ❌ `⌘C` copy still captures the original key
- ❌ Screen recording software may capture the original beneath the overlay

## More Secure Direction: ScreenCaptureKit + Virtual Camera

The most secure approach intercepts at the **frame output layer**, ensuring the original key **never appears in any output**.

### Architecture

```
[macOS Screen]
      ↓ ScreenCaptureKit
[Capture frame (CGImage/IOSurface)]
      ↓
[Detect API key positions]  ← Reuse existing pattern matching
      ↓
[Draw masking blocks on frame]
      ↓
[Output to Virtual Camera / Screen Share]
```

### Use Case Comparison

| Scenario | Overlay Approach | ScreenCaptureKit Approach |
|----------|-----------------|--------------------------|
| OBS livestream | ⚠️ Overlay may not be in capture | ✅ Output already masked |
| Google Meet screen share | ⚠️ Depends on window level | ✅ Virtual camera output masked |
| Screen recording | ⚠️ Same issue | ✅ Recording captures masked version |
| Copy/Paste | ❌ Original key still copyable | ❌ Same (not in frame layer) |

### Technical Components

#### 1. ScreenCaptureKit Capture

```swift
import ScreenCaptureKit

let content = try await SCShareableContent.current
let display = content.displays.first!
let filter = SCContentFilter(display: display, excludingWindows: [])

let config = SCStreamConfiguration()
config.width = display.width
config.height = display.height
config.pixelFormat = kCVPixelFormatType_32BGRA

let stream = SCStream(filter: filter, configuration: config, delegate: self)
try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .global())
try await stream.startCapture()
```

#### 2. Key Position Detection

**Option A: Vision Framework OCR**
```swift
import Vision

func detectKeys(in image: CGImage) -> [(String, CGRect)] {
    let request = VNRecognizeTextRequest { request, error in
        guard let results = request.results as? [VNRecognizedTextObservation] else { return }
        for observation in results {
            let text = observation.topCandidates(1).first?.string ?? ""
            let matches = maskingCoordinator.shouldMask(text: text)
            // observation.boundingBox → screen coordinates
        }
    }
    request.recognitionLevel = .fast  // Real-time needs fast mode
}
```

**Option B: AX API Coordinates (Recommended — No OCR needed)**

Reuse existing `SystemMaskingService`'s `AXBoundsForRange` coordinates to draw masking blocks directly on captured frames. Much faster than OCR.

```swift
let keyRects = systemMaskingService.getActiveOverlayRects()
let context = CGContext(data: ..., width: ..., height: ...)
for rect in keyRects {
    context.setFillColor(CGColor.white)
    context.fill(rect)
}
```

#### 3. Virtual Camera Output

Use [CoreMediaIO DAL Plugin](https://developer.apple.com/documentation/coremediaio) or [OBS Virtual Camera](https://obsproject.com/).

Third-party options:
- [mac-virtual-camera](https://github.com/pjb/mac-virtual-camera) — Swift implementation
- OBS Studio Virtual Camera API

### Lessons Learned (From Overlay Implementation)

1. **AXBoundsForRange is precise** — returns exact multi-line text screen coordinates, no estimation needed
2. **Coordinate conversion** — AX uses top-left origin, AppKit/CG uses bottom-left: `appKitY = primaryScreenHeight - axY - height`
3. **Multi-monitor** — use primary screen height as conversion reference
4. **Performance baseline** — pattern matching: 0.1-0.3ms, AX query + overlay: 2-6ms. ScreenCaptureKit bottleneck would be OCR (if used)
5. **30ms debounce is sufficient** — human flicker perception threshold is ~50ms
6. **Immediate scan on app switch** — don't wait for debounce, or key flashes for 500ms+
7. **Unique overlay IDs** — same keyId with multiple occurrences needs distinct IDs (keyId + match index)
8. **Reuse NSHostingView** — creating new views on every update causes accumulation

### Suggested Implementation Order

1. **OBS Plugin first** (easiest) — write an OBS Source Plugin that gets key coordinates from DemoSafe Core via IPC, draw masking on OBS scene
2. **Virtual Camera next** (moderate) — ScreenCaptureKit capture + AX coordinates + DAL Plugin output
3. **OCR last** (complex) — Vision framework OCR as fallback when AX API coordinates unavailable

### Reusable Files

| File | Reusable Content |
|------|-----------------|
| `Services/Accessibility/SystemMaskingService.swift` | AXObserver setup, focused element scanning, AXBoundsForRange |
| `Services/Masking/MaskingCoordinator.swift` | Pattern matching engine (`shouldMask()`) |
| `Views/Overlay/SystemOverlayController.swift` | Coordinate conversion (`convertAXToAppKit`) |
