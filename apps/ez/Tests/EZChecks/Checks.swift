import EZCheckSupport
import Foundation

@main struct Checks {
    @MainActor static func main() async {
        let cases =
            runnerChecks() + launcherChecks() + historyChecks() + sharedHistoryChecks() + identityChecks()
            + modelChecks() + templateChecks() + configurationChecks()
            + spellingComparisonChecks() + recipeHistoryChecks() + responsesChecks() + authenticationChecks()
            + shortcutChecks() + sharedContractChecks() + illustrationChecks() + providerChecks()
            + actionContractChecks() + searchImageChecks() + connectionChecks()
        exit(await CheckRunner.run(cases))
    }
}
