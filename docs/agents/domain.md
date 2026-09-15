# Domain docs

**Single-context** repo: the domain glossary lives in `CONTEXT.md` at the repo root,
and architecture decisions live in `docs/adr/` with sequential four-digit prefixes.

## Before exploring

- Read `CONTEXT.md` and the ADRs in `docs/adr/` relevant to the work.
- If `CONTEXT-MAP.md` exists, follow its links to the relevant contexts and read
  their glossaries and context-scoped ADRs in `src/<context>/docs/adr/`.
- If a document is missing, proceed silently without requiring its creation.
  The `domain-modeling` skill creates documentation when terms or decisions are
  resolved.

## Use the glossary's vocabulary

Use the terms defined in `CONTEXT.md` in issue titles, proposals, hypotheses, and
test names. Avoid synonyms the glossary explicitly rejects. If a needed concept
is missing, reconsider the term or note the gap for `domain-modeling`.

## Flag ADR conflicts

Explicitly identify any existing ADR that a proposal contradicts and explain why
it should be reconsidered rather than silently overriding the decision.
