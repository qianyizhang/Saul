import Foundation
import SaulTestSupport

@testable import EZApplication

@main struct StateChecks {
    @MainActor static func main() async {
        exit(
            await CheckRunner.run(
                recipeStateChecks() + historyStateChecks() + historyPagingStateChecks()
                    + configurationStateChecks()
                    + shortcutStateChecks() + selectedTextChecks() + quickLookupStateChecks()
                    + attemptStateChecks() + illustrationStateChecks() + searchImageStateChecks()))
    }
}
