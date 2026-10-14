import EZCheckSupport
import Foundation

@main struct Checks {
    @MainActor static func main() async {
        let cases =
            runnerChecks() + launcherChecks() + historyChecks() + identityChecks()
            + modelChecks() + templateChecks() + configurationChecks()
            + recipeHistoryChecks() + responsesChecks() + authenticationChecks()
        exit(await CheckRunner.run(cases))
    }
}
