# System-Wide Masking：進階安全方案（社群貢獻方向）

## 現況

目前的 System-wide masking 使用 **Accessibility overlay**（`AXObserver` + `NSPanel`），是視覺遮蔽方案：
- ✅ 螢幕上看不到 key
- ❌ `⌘C` 複製仍可取得原始 key
- ❌ 螢幕錄影軟體可能錄到 overlay 下方的原始畫面（取決於 window level 順序）

## 更安全的方向：ScreenCaptureKit + Virtual Camera

最安全的方案是在**畫面輸出層**攔截，讓原始 key **從未出現在任何輸出中**。

### 概念架構

```
[macOS 螢幕]
      ↓ ScreenCaptureKit
[擷取畫面 frame (CGImage/IOSurface)]
      ↓
[OCR 偵測 API key 位置]  ← 可複用現有的 pattern matching
      ↓
[在 frame 上繪製遮蔽區塊]
      ↓
[輸出到 Virtual Camera / 螢幕分享]
```

### 適用場景

| 場景 | overlay 方案 | ScreenCaptureKit 方案 |
|------|------------|---------------------|
| OBS 直播 | ⚠️ overlay 可能不在錄製範圍 | ✅ 輸出已遮蔽 |
| Google Meet 螢幕分享 | ⚠️ 取決於 window level | ✅ virtual camera 輸出已遮蔽 |
| 螢幕錄影 | ⚠️ 同上 | ✅ 錄到的就是遮蔽後的 |
| Copy/Paste | ❌ 原始 key 仍可複製 | ❌ 同樣無法防止（不在畫面層） |

### 技術元件

#### 1. ScreenCaptureKit 擷取

```swift
import ScreenCaptureKit

// 取得可擷取的螢幕
let content = try await SCShareableContent.current
let display = content.displays.first!

// 建立 filter（擷取整個螢幕）
let filter = SCContentFilter(display: display, excludingWindows: [])

// 建立串流
let config = SCStreamConfiguration()
config.width = display.width
config.height = display.height
config.pixelFormat = kCVPixelFormatType_32BGRA

let stream = SCStream(filter: filter, configuration: config, delegate: self)
try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .global())
try await stream.startCapture()
```

#### 2. OCR 偵測 key 位置

兩種方案：

**方案 A：Vision framework（Apple 原生 OCR）**
```swift
import Vision

func detectKeys(in image: CGImage) -> [(String, CGRect)] {
    let request = VNRecognizeTextRequest { request, error in
        guard let results = request.results as? [VNRecognizedTextObservation] else { return }
        for observation in results {
            let text = observation.topCandidates(1).first?.string ?? ""
            // 複用 MaskingCoordinator 的 pattern matching
            let matches = maskingCoordinator.shouldMask(text: text)
            // observation.boundingBox → 螢幕座標
        }
    }
    request.recognitionLevel = .fast  // 即時處理需要 fast mode
    let handler = VNImageRequestHandler(cgImage: image)
    try? handler.perform([request])
}
```

**方案 B：已知座標直接遮蔽（搭配 AX API）**

不用 OCR — 複用現有 `SystemMaskingService` 的 `AXBoundsForRange` 座標，直接在擷取的 frame 上繪製遮蔽區塊。這比 OCR 快得多。

```swift
// 從 SystemMaskingService 取得已偵測的 key 座標
let keyRects = systemMaskingService.getActiveOverlayRects()

// 在 frame 上繪製遮蔽
let context = CGContext(data: ..., width: ..., height: ...)
for rect in keyRects {
    context.setFillColor(CGColor.white)
    context.fill(rect)
    // 可選：繪製 masked text
}
```

#### 3. Virtual Camera 輸出

使用 [CoreMediaIO DAL Plugin](https://developer.apple.com/documentation/coremediaio) 或 [OBS Virtual Camera](https://obsproject.com/) 將處理後的 frame 作為虛擬攝影機輸出。

第三方選項：
- [mac-virtual-camera](https://github.com/pjb/mac-virtual-camera) — Swift 實作
- OBS Studio 的 Virtual Camera API

### 已踩過的坑（省下你的時間）

從 overlay 方案開發中學到的經驗：

1. **AXBoundsForRange 是精確的** — 不需要估算字元寬度，直接用 AX API 取得多行文字的精確螢幕座標
2. **座標轉換** — AX 用左上角原點，AppKit/CoreGraphics 用左下角，轉換公式：`appKitY = primaryScreenHeight - axY - height`
3. **多螢幕** — 用 primary screen height 作為轉換基準
4. **效能基準** — Pattern matching 只要 0.1-0.3ms，AX 查詢 + overlay 更新 2-6ms。ScreenCaptureKit 方案的瓶頸會在 OCR（如果用的話）
5. **30ms debounce 足夠** — 人眼感知閃爍的閾值約 50ms，30ms debounce 夠快
6. **App 切換要立即掃描** — 不能等 debounce，否則切回時 key 會閃現 500ms+
7. **Overlay ID 要唯一** — 同一個 keyId 的多個出現需要不同的 overlay ID（用 keyId + match index）
8. **NSHostingView 要重用** — 每次 `new NSHostingView` 會造成 view 累積

### 建議實作順序

1. **先做 OBS 插件**（最簡單）— 寫一個 OBS Source Plugin，從 DemoSafe Core 取得 key 座標（via IPC），在 OBS 的畫面上繪製遮蔽區塊
2. **再做 Virtual Camera**（中等）— 用 ScreenCaptureKit 擷取 + AX 座標繪製遮蔽 + DAL Plugin 輸出
3. **最後做 OCR**（最複雜）— 如果 AX API 座標不可用（某些 app 不支援），用 Vision framework OCR 作為 fallback

### 相關檔案

| 檔案 | 可複用內容 |
|------|---------|
| `Services/Accessibility/SystemMaskingService.swift` | AXObserver 設定、focused element 掃描、AXBoundsForRange 座標取得 |
| `Services/Masking/MaskingCoordinator.swift` | Pattern matching 引擎（`shouldMask()`） |
| `Views/Overlay/SystemOverlayController.swift` | 座標轉換 (`convertAXToAppKit`) |
