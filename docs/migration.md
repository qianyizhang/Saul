# Monorepo migration

## Source and scope

The migration starts from Saul `c5561df` and EZ `5e96905` (2026-10-20).
EZ is imported with its original history as a merge parent; both original tips
remain ancestors of the monorepo. Browser sources move to `apps/saul`; native
sources live in `apps/ez`. Original dependency resolutions are retained.

Shared owners: design/generation, vocabulary, semantic interfaces, template
conformance fixtures, selective setup and root development hooks/CI. Application
implementations, stored records, credentials, IDs and execution remain separate.
No UI redesign, live upgrade, OAuth replacement, sync or mobile implementation is
part of this change. An opt-in replacement contract and naming reminder live in
[architecture](architecture.md).

## Retirement sequence

Verify both apps and history ancestry in an isolated checkout, integrate into the
Saul checkout, then push and verify the destination commit. Only then archive the
old GitHub EZ repository and mark its local checkout retired. Keep that checkout,
including ignored local signing/development state, as a recovery copy. Active
changes belong in `apps/ez`. Archiving is not deletion or credential migration.

## Publication hold

On 2026-10-20, EZ was private and Saul public on GitHub. The user chose to keep
this migration local until destination visibility is decided. Do not push the
combined history or archive either copy of EZ before that decision and a verified
destination push. The local monorepo is the implementation candidate; the original
EZ checkout remains intact.

## Verification

Verified in the isolated migration checkout on 2026-10-20:

| Gate                         | Result                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Design receipts              | All four CSS/TypeScript/Swift outputs match `71cb2beb35f2`                                                                 |
| Shared tooling and setup     | 8 tooling tests and 7 setup tests passed                                                                                   |
| Browser unit/transport       | 187 unique cases passed; socket-dependent files required approved local socket access                                      |
| Browser integration          | 72 passed, 5 expected optional/disabled skips, disposable profiles                                                         |
| Native checks                | 62 core + 24 state checks passed, including the shared fixture                                                             |
| Native installation recovery | Existing signing/process/failure/rollback fixtures passed                                                                  |
| Production packaging         | Chrome bundle built; native release app built and signature verified                                                       |
| Selective installation       | Real extension + both helper artifacts installed and verified under a disposable directory, without Codex registration     |
| Root hooks                   | Formatting, lint, types, links, static workflow/shell/Swift checks and generic file checks passed                          |
| Source preservation          | 121 browser runtime/resource/benchmark files and 34 native runtime/resource files byte-identical to the original checkouts |

Sandboxed native packaging reported `Invalid Iconset` despite valid PNG dimensions;
approved packaging succeeded without source changes. Browser startup and socket
checks used the repository's required execution permissions. Dependencies were
installed from the existing cache with unchanged resolved versions.

Installed apps, live provider consent/inference and hosted CI were not exercised.
The root installer deliberately refuses an existing unpacked extension destination;
it does not migrate profile-local data or claim a seamless loaded-extension upgrade.
