# Migration status

The local source migration is complete: Chrome code lives in `apps/saul`, native
code in `apps/ez`, and shared design/contracts/tooling at the root. Both original
histories are preserved (Saul `c5561df`, EZ `5e96905`; import `af526ac`, migration
`0fe5829`). Install EZ with `make -C apps/ez install` after quitting it.
See [selective setup](setup.md) for signing prerequisites and other components.

## Publication decision

On 2026-11-02, the user approved syncing the integrated `main` to the public
`qianyizhang/Saul` repository. Keep the original EZ checkout for recovery.

## Installed identities and artifacts

The source move left installed apps and credentials in place. The root
`.output/chrome-mv3` is the retained installation from before the move. Follow
the [installation invariants](setup.md#existing-installations-and-repository-migration)
before replacing it. The [artifact policy](artifacts.md) covers build paths,
disposable diagnostics and retained benchmarks.

## Verification — 2026-10-20

At source reconciliation `8cd540e`, the Chrome ZIP contained the expected MV3
manifest and background entry. The EZ ZIP preserved the retained signature and
`local.ez.app` identity after extraction. Installation recovery fixtures passed
and the running EZ app stayed in place. Hosted CI and live-provider authentication
and inference were outside this verification.
[Reconciliation record](https://github.com/qianyizhang/Saul/blob/8cd540eef197647fb010edd3148d2098b44eec21/docs/migration.md#verification--2026-10-20)
