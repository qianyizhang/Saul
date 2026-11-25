# Deferred architecture review

Build the accepted [shared History interface](../contracts/history.md#accepted-interface) next.
It owns the remaining validation work from #1 and storage decomposition from #9.
The [cutover and acceptance criteria](../contracts/history.md#personal-data-cutover) supersede the
earlier proposal to start by extracting a projection from the dispatcher. Finding #5 is complete.
Configuration also owns the saved Write-preset lookup from #12.

| Finding                       | What to revisit                                                                                                                                         | Evidence for taking it                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #7 · Active configuration     | Isolate legacy storage shapes from consumers of [Saul configuration](../apps/saul/src/configuration/definition.ts).                                     | Identify a consumer still synchronizing two representations after the Connections work. Exercise old settings, unavailable presets and exact account and endpoint bindings before migrating it.   |
| #10 · Board ordering          | Give the [Board service](../apps/saul/native/board-service.mts) one scheduling policy for HTTP and MCP.                                                 | Decide whether session discovery must stay responsive during a stalled call. Check both transports for mutation order, independent diagnostics and recovery after a failed call.                  |
| #11 · Reading background host | Move Reading request handling, source reopening and subscriptions out of the [background entrypoint](../apps/saul/entrypoints/background.ts).           | Identify the Reading-owned listeners and their teardown. Exercise sender checks, page navigation, reconnects and preference broadcasts through the existing message envelopes.                    |
| #12 · Small abstractions      | Recheck the EZ key-store abstraction and model wrapper, remaining cross-feature imports of Reading value predicates, and installer payload enumeration. | Check each candidate’s callers after the slice. Preserve model availability while loading, identifier rules, and installed payload identities. Count the EZ model wrapper once across #7 and #12. |
