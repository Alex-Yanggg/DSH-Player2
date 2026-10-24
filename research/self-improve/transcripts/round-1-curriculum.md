# Curriculum (c): cross-examination, round 1

Sources: the five openings, BRIEF.md, dsh-facts.md, bench/README.md,
`bench/lib/approach-async.ts`, `bench/matrix-async.log` (in-flight,
unofficial), round-1 cross-exams; no bench runs by me.

## Attacks

### (b) library: a warehouse is not a supply chain

(b) claims retrieval is "the cheapest architecture in LLM calls we have ever
measured in this repo: … mine 8/10 at 0.1 … and farm 10/10 at
0.0" (her opening). Those rows hit ~0 calls only after a
separate authoring run paid discovery — bench/README.md: round 1 "primes the
on-disk skill libraries (one authoring run each)". Storage
is not acquisition: authoring was billed apart, and her mechanism keeps
billing — "one model call per game day" distill plus "one call per session"
reconcile forever, stale lessons costing rewrites under no cap; re-authoring
on drift is unbounded.

Her layers answer where lessons live, not where they come from — her own
Anticipated-1 heading asks "who fills it?". Her main writer, the day-end
distill, fires after the day is lost: P2-0019 lost "days" (BRIEF.md), so the
spring-5 lesson lands days late, distilled from episodes showing "walk
blocked", never "until spring 5" — knowable "only from the world or the wiki"
(bench/README.md). On a fresh save she concedes the sheet "is empty …
behaves exactly like today's product," and "an empty library plus a passive loop grows slowly; option (c)'s survey is
the accelerant". Her
owner-mandated brief — defend "what gets distilled when" — distills whatever
failure already produced. CLIN's bottleneck (her citation) is the verdict: insights "come only from self-experience; if the agent never reaches
the relevant area … it never forms the needed memory and keeps failing"
(notes-classics.md). A store whose only producer is failure
is my survey with the survey deleted.

### (e) async: the big brain has no way to learn the world

(e)'s binding design: the big brain "plans, reflects and web-searches
ASYNCHRONOUSLY and never blocks the body"; the small brain "keeps acting on
the current plan" (BRIEF.md amendment). The plans come from a brain
that must know the world, and (e)'s only learning trigger is escalation on
repeated failure (§2, §7) — reflect's loop on another clock: the world is
learned only after K=3 failures. (e) concedes exploration is
borrowed: "(c)'s exploration is what the big brain plans when a goal is
blocked-but-waitable" (its §7) — with nothing triggering it before the wall.

Its prototype proves it: the async big brain's only knowledge tools are
"observe/web_search/web_fetch" — no lesson tool, no guide — with `newShared()`
state per run (`bench/lib/approach-async.ts`): every session starts knowing
nothing. An in-flight run log in the bench directory
(`bench/matrix-async.log`; unofficial) shows the small brain
executing an ignorant big brain: repeated-failure counts of 5-15 on locked
(nine of ten seeds; one hit 35); 4 of 10 wall seeds failed with the highest
counts (19-20). The body re-walks into the closure because no survey read the
notice board (bench/README.md): throughput multiplies blind grinding; my
survey prevents it. Even trigger timing is admitted: escalation is
"delivered at the next turn admission" while "the goal round driver's
continuation trigger timing is not documented" — "an open spike item" (§4).

### (a) reflect: lessons written after the wall

(a)'s search "fires only inside a triggered reflection — never per action,
never on a timer" (§6): knowledge is strictly
post-wall. On the closure class, (a) pays three blocked walks plus a search
turn (one full model turn,
dsh-facts.md §1), writing the spring-5 fact as a hypothesis inferred from
failure; the survey reads the notice board (bench/README.md) and
copies it at `observed` confidence: zero failures, zero searches, and — by
(a)'s own RSIAgent citation — the better, environment-grounded tier. (a)
concedes the boundary: wiki-less games leave it "observation-only … just not
the closure class" (#3) — yet the closure fact was never wiki-only: it is in
the world. Its own words convict it: "the first failed attempt of any kind is tuition"; "(c) could in
principle front-run some of that" (#5) — tuition P2-0019 paid in lost days.

## Answering the predictable

**Expected attack 1 — "the survey multiplies round-trips on an idle-heavy
body" (d: knowledge options "multiply round-trips on the worst substrate"; e:
"(c) explores but must still act through the same blocking loop").** Survey
legs are ideal PTC work — one model turn programs walk-look-read-record
(dsh-facts.md §3): near one round-trip per leg, not four. Survey
days are dense with done body tasks; unsurveyed days with `blocked` retries — the behavior `repeated_failures_mean` targets (bench/README.md).
Cost is paid once per save: the guide persists in plugin files (dsh-facts.md
§4) and later sessions load it free — "re-pays its cost every session" is
false by (b)'s own persistence logic.
Urgent goals degrade to a route survey of the goal's own path — the locked
scenario's notice board.

**Expected attack 2 — "termination cannot certify coverage; a survey ending
'done' without the fact marks the save learned forever — a confident grinder"
(reflect's round-1 answer).** Nothing marks a save "learned": coverage
is rendered state, not belief; every entry carries `confidence` and `asOf` —
expired facts render as expired hypotheses, missing facts as
`kind: "unknown"`: honest gaps routed to the wiki search or the player. A wrong "done" self-corrects at the first contradicting outcome;
the grinder needs the guide to assert an absence, and absences are data, not
assertions. [Reasoning] The reactive alternative is the
worse grinder: failure-lessons alone stay ignorant of all not yet failed.
