import SwiftUI

/// Visual overlay that covers an API key with masked text.
/// Fills the entire panel frame with a solid background to fully cover the key.
struct MaskOverlayView: View {
    let maskedText: String

    var body: some View {
        ZStack {
            // Solid background to fully cover the key area
            Color(nsColor: .textBackgroundColor)

            // Masked text aligned to top-left
            Text(maskedText)
                .font(.system(.body, design: .monospaced))
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(.horizontal, 2)
                .padding(.vertical, 1)
        }
    }
}
