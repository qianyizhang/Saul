# Shared contracts

Saul and EZ implement these shared guarantees in TypeScript and Swift.

## Action preparation

[Actions and attempts](actions-and-attempts.md#action-preparation) owns template
inputs, substitution and preparation.

## Execution

[Attempt execution](actions-and-attempts.md#execution) owns completion, Stop,
saved success and retry.

## History operations

[History](history.md) owns SQLite, deletion and legacy imports.

## Connections and presets

[Configuration](configuration.md#connections-and-presets) owns saved choices.
[Credentials](credentials.md) owns account and key access, consent and catalog
refresh.

### Connection data upgrades

See [configuration upgrades](configuration.md#connection-data-upgrades).

## Unified configuration scopes

See [scope and revision rules](configuration.md#unified-configuration-scopes).

## Presentation

[Design](../DESIGN.md) owns shared visual and interaction rules.
