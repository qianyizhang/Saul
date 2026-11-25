import EZCore
import SaulNativeValues
import SwiftUI

struct RetryAttemptNotice: View {
    @ObservedObject var model: AppModel
    let entry: HistoryEntry
    var onReview: () -> Void = {}

    var body: some View {
        if entry.isRetryable {
            VStack(alignment: .leading, spacing: 8) {
                if model.retryPreparingID == entry.id {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text("Loading saved input image…")
                        Button("Stop") { model.stop() }
                    }
                } else {
                    Button("Retry same request", systemImage: "arrow.clockwise") { model.retry(entry.id) }
                        .disabled(!model.canRetry(entry))
                        .help("Start a new request with the original inputs and preset")
                }
                if let failure = model.retryFailure, failure.entryID == entry.id {
                    Text(failure.message).foregroundStyle(.red).textSelection(.enabled)
                    Button("Review request") {
                        model.reuse(entry)
                        model.showsMainComposer = true
                        onReview()
                    }.disabled(!model.canRetry(entry))
                }
            }.font(AppStyle.caption).controlSize(.small)
        }
    }
}
