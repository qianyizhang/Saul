# Migration status

The local source migration is complete: Chrome code lives in `apps/saul`, native
code in `apps/ez`, and shared design/contracts/tooling at the root. Both original
histories are preserved (Saul `c5561df`, EZ `5e96905`; import `af526ac`, migration
`0fe5829`). Install EZ with `make -C apps/ez install` after quitting it.
See [selective setup](setup.md) for signing prerequisites and other components.

## Publication hold

EZ was private and Saul public on GitHub when inspected on 2026-10-20. The user
chose to keep the migration local until destination visibility is decided.
Do not push the combined history or archive either copy of EZ before that decision
and a verified destination push. The original EZ checkout remains intact for recovery.

## Installed identities and artifacts

The source move did not replace installed applications, move credentials or change
bundle/extension identities. EZ's ignored signing fingerprint is retained at
`apps/ez/.local/signing-identity`; its private key remains in Keychain.

The existing root `.output/chrome-mv3` is deliberately retained at its loaded
extension path. It is an installed artifact, not a source compatibility layer;
remove it only after an explicit identity/data-preserving Chrome upgrade. New
browser builds belong under `apps/saul`; native builds belong under `apps/ez`.
Disposable diagnostics use root `.artifacts/` under the [artifact policy](artifacts.md).
Obsolete root WXT metadata and disposable test reports are removed.
Benchmark measurements remain under `apps/saul/docs/benchmarks`.

## Verification — 2026-10-20

| Scope                  | Evidence                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Shared tooling/setup   | 20 tests passed, including dry-run, literal subprocess arguments, component isolation and failure ordering               |
| Browser unit/transport | 182 tests passed; socket tests used approved local access                                                                |
| Native                 | 62 core + 24 state cases, installation recovery fixtures, static checks and preview-script compilation passed            |
| Design                 | All four generated outputs match source receipt `71cb2beb35f2`                                                           |
| Browser artifact       | Production ZIP built at the app-owned path; MV3 manifest and background entry verified                                   |
| Native artifact        | Built from the monorepo using the retained signer; ZIP extraction preserved valid signature and `local.ez.app` identity  |
| Browser integration    | Migration run: 72 passed, 5 expected skips. Application runtime and browser harness are unchanged by this cleanup        |
| CI                     | Workflow/static checks pass locally; native CI now retains a development app ZIP alongside the separate browser artifact |

Application runtime/resource files and benchmark bytes remain unchanged by the
reconciliation. The duplicate installer and native hook forwarding scripts are
removed; callers use their current owners directly. The running EZ app was not
replaced. Hosted CI and live-provider authentication/inference remain unverified;
publication is held, and CI's ad-hoc app artifact is not a notarized public release.
