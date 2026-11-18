# Migration status

The local source migration is complete: Chrome code lives in `apps/saul`, native
code in `apps/ez`, and shared design/contracts/tooling at the root. Both original
histories are preserved (Saul `c5561df`, EZ `5e96905`; import `af526ac`, migration
`0fe5829`). Install EZ with `make -C apps/ez install` after quitting it.
See [selective setup](setup.md) for signing prerequisites and other components.

## Publication decision

EZ was private and Saul public on GitHub when inspected on 2026-10-20. The initial
decision held the migration locally until destination visibility was chosen.
On 2026-11-02, the user confirmed the current public `qianyizhang/Saul` remote as
the destination and authorized syncing the integrated main there. The earlier
publication hold is resolved; normal repository checks still govern pushes.
The original EZ checkout remains intact for recovery; this decision does not
authorize archiving or deleting it.

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

At source reconciliation `8cd540e`, the Chrome ZIP contained the expected MV3
manifest and background entry. The EZ ZIP preserved the retained signature and
`local.ez.app` identity after extraction. Installation recovery fixtures passed
and the running EZ app stayed in place. Hosted CI and live-provider authentication
and inference were outside this verification.
[Reconciliation record](https://github.com/qianyizhang/Saul/blob/8cd540eef197647fb010edd3148d2098b44eec21/docs/migration.md#verification--2026-10-20)
