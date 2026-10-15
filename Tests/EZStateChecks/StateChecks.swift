import EZCheckSupport
import Foundation

@main struct StateChecks {
    @MainActor static func main() async {
        exit(
            await CheckRunner.run(
                recipeStateChecks() + historyStateChecks() + configurationStateChecks()
                    + shortcutStateChecks()))
    }
}
