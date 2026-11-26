import EZCore
import SaulNativeValues
import SwiftUI

struct RetryAttemptNotice: View {
    @ObservedObject var lookup: LookupSession
    let entry: HistoryEntry
    var onReview: () -> Void = {}

    var body: some View {
        if entry.isRetryable {
            VStack(alignment: .leading, spacing: 8) {
                if lookup.retryPreparingID == entry.id {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text("Loading saved input image…")
                        Button("Stop") { lookup.stop() }
                    }
                } else {
                    Button("Retry same request", systemImage: "arrow.clockwise") { lookup.retry(entry.id) }
                        .disabled(!lookup.canRetry(entry))
                        .help("Start a new request with the original inputs and preset")
                }
                if let failure = lookup.retryFailure, failure.entryID == entry.id {
                    Text(failure.message).foregroundStyle(.red).textSelection(.enabled)
                    Button("Review request") {
                        lookup.reuse(entry)
                        lookup.showsMainComposer = true
                        onReview()
                    }.disabled(!lookup.canRetry(entry))
                }
            }.font(AppStyle.caption).controlSize(.small)
        }
    }
}
