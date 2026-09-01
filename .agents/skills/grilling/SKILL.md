---
name: grilling
version: "1.1.1"
last_updated: 2026-08-20
description: >-
  Decision-interview primitive: frontier-batch rounds by default, recommended
  answers, facts from the tree, and no implementation. Use when a plan needs
  stress-testing or when another planning skill needs a shared grill loop.
---

# Grilling

Run a focused decision interview before implementation. This skill clarifies
and locks decisions; it does not implement them.

Vocabulary adapted from [mattpocock/skills](https://github.com/mattpocock/skills)
(`grilling`, `batch-grill-me`).

## Frontier-batch loop (default)

1. Restate the user's intent in one precise sentence when the request is fuzzy.
2. Map the open space as a design tree; the **frontier** is every decision whose
   prerequisites are settled.
3. Ask the **whole frontier in one numbered round**. Each item: question +
   recommended answer (+ brief alternative cost when material).
4. Wait for the batch. Accept `1. yes  2. your rec  3. defer` style replies.
5. Treat each first answer as **direction**, not a lock. Restate the proposed
   locks, probe material scope/boundary/exception ambiguity, and let the user
   correct the wording.
6. Lock what settled; recompute the frontier; run the next round.
7. **Never** put a question in the same round as another answer it depends on.
   Facts you can look up are not frontier questions—resolve them yourself (or
   dispatch read-only legwork) without blocking independent decisions.

Use serial one-question rounds only when the user asks for them. A frontier with
one unblocked decision is naturally a one-question round; do not delay it to
manufacture a batch.

## Standing rules

- **Facts vs decisions.** Look up code, docs, and the tree. Put only real
  product, domain, safety, or architecture choices to the user.
- **No implementation.** Do not switch into implementation mid-grill unless the
  user explicitly leaves the interview.
- **Completion.** Shared understanding is confirmed, or residual uncertainty is
  named as open questions or backlog—never guessed closed.

## Question standard

Each question must be concrete enough that the answer can change the design:

- The branch being resolved.
- Repository evidence or glossary/ADR conflict when relevant.
- Recommended answer (the user may reply `your rec`).
- Consequence of choosing differently when material.

When the user asks for Chinese, grill in Chinese; keep code and glossary
identifiers in English.

## Pitfalls

- Batching dependent questions in one frontier round.
- Quizzing the user for facts the tree already answers.
- Implementing because the design feels clear.
- Moving on after a first answer without a proposed lock.
