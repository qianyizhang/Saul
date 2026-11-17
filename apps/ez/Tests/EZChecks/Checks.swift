import Foundation
import SaulTestSupport

@main struct Checks {
    @MainActor static func main() async {
        let cases =
            runnerChecks() + launcherChecks() + historyChecks() + sharedHistoryChecks()
            + modelChecks() + templateChecks() + configurationChecks()
            + spellingComparisonChecks() + recipeHistoryChecks() + responsesChecks()
            + shortcutChecks() + sharedContractChecks() + providerChecks()
            + actionContractChecks() + searchImageChecks() + connectionChecks()
        exit(await CheckRunner.run(cases))
    }
}
