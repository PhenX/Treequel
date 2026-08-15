# ADR 0011 — Date-part extraction: a dialect seam and a UTC contract

Status: accepted

## Context

The `WellKnown` registry lists `getFullYear`, `getMonth`, and `getDate` as recognized calls — the surface first-party
providers commit to — but the SQL translator never implemented them. A column-rooted `u.at.getFullYear()` fell through
`translateCall` to the default `R2001` failure, and the `SqlDialect` seam had no hook for date fields. So the vocabulary
advertised a capability no SQL provider delivered: the getters worked only in the memory provider, which runs the JS
getters directly.

Two semantic details make date extraction more than a mechanical mapping, because the memory provider is the reference:

- **`getMonth()` is 0-based** (January is `0`), while `EXTRACT`/`strftime` return 1-based calendar months.
- **The JS getters read local time.** `getFullYear()` returns the year in the process time zone. SQLite's `strftime`
  reads UTC only — it has no session time zone — so UTC is the one zone every provider can agree on.

## Decision

A `dateExtract(part, expr)` method on `SqlDialect`, where `part` is `"year" | "month" | "day"` and the result is an
integer-valued SQL expression. The translator maps the three getters to it and owns the JS-specific 0-based adjustment,
so each dialect stays a plain field extraction:

- `getFullYear()` → `dateExtract("year", …)`
- `getMonth()` → `(dateExtract("month", …) - 1)` — the calendar month, made 0-based
- `getDate()` → `dateExtract("day", …)`

The dialects implement the field read: Postgres `CAST(EXTRACT(<FIELD> FROM …) AS INTEGER)`, SQLite
`CAST(strftime('<fmt>', …) AS INTEGER)`. SQLite has no date type, so its `coerceValue` now serializes a bound `Date` to
an ISO-8601 UTC string — the form `strftime` reads and the form whose lexical order matches chronological order.

**The contract: date parts are read in UTC.** This matches the JS getters when the process runs in UTC; the test suite
pins `TZ=UTC` so the memory reference and the SQL providers agree deterministically. Outside UTC the getters read a
different zone than the SQL, so the parity holds only when process and database share UTC — otherwise cross the
`.inMemory()` boundary and let the getters run in JS.

## Consequences

- The three date getters now translate on both first-party dialects, and the shared vocabulary reflects reality.
- Other `Date` methods (`getHours`, `getDay`, `toISOString`, …) remain `R2001` — recognized only where listed, and
  otherwise a fail-fast error pointing at `.inMemory()`, never a silent client-side scan.
- A new dialect implements one more small method. The 0-based-month quirk lives once, in the translator, not in each
  dialect.
- Date-part parity is a documented UTC limitation, not an implicit assumption. A future zone-aware extraction (reading
  the field in a caller-chosen zone) can extend the seam without changing these call sites.
