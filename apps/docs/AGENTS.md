# apps/docs — Area Guide

Rules for the VitePress site beyond the root guide (which owns [voice](../../AGENTS.md#voice), the positioning line,
and the generated-pages rule). This file owns the information architecture.

## Sidebar sections are reader tasks — file new pages by reader, not by arrival order

The sections in `.vitepress/config.ts`, in reading order:

| Section | Reader | Rule |
|---|---|---|
| Start here | Anyone new | Concepts and the quick start. Getting started stays a quick start — setup depth belongs on the dedicated pages, not accreted here. |
| Querying | App developers using queries | Opens with the basics page (`queries.md`), closes with `sql-providers.md`. A new query feature's page goes between them. |
| Build & tooling | People wiring Greffon into a repo | Build paths, editor, lint. |
| Extending | Provider authors | The SPI surface. |
| Background | Evaluators & C# arrivals | Lineage and comparisons. |
| Reference | Everyone | Generated pages only. |

A page serving two audiences is split, not filed twice: user-facing setup goes to its user section, author-facing
protocol to Extending.

## Linking

- Every new guide page is linked from at least one existing page in the same commit — no sidebar-only orphans.
- Guide pages end with a short "Where to go next" list continuing the arc, except pure reference pages.
- Pages live flat under `/guide/`; sidebar grouping is free to change, file renames break inbound links — regroup
  rather than rename.
- **Never move `/errors`.** Its `#Rxxxx` anchors are emitted by build errors, editor squiggles, and lint output.
- Runnable examples (`examples/*`) are linked from the page that teaches their story, as
  `https://github.com/PhenX/Greffon/tree/main/examples/<name>`.

## Accuracy

Operator tables, signatures, and config snippets are checked against the package sources they document — the
`Queryable` interface, `TableMeta`, plugin options — in the same commit that changes either side.
