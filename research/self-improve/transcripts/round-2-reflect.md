# Reflect (a): cross-examination, round 2

Sources: round-1 transcripts, the five openings, BRIEF.md, dsh-facts.md,
bench/README.md, notes-*.md; no bench run; inferences labeled [reasoning].

## Answers

**1. (b) library — "lessons die with the run": the prototype's scope, not the option's.**

Conceded: the bench's reflect prototype keeps lessons in-run. Wrong
inference: that is bench scoping — each approach is "a minimal prototype of one
debate architecture" (bench/README.md); the library row demonstrates the store
because storage is (b)'s variable. My mechanism specifies the store: "Plugin
files in the plugin's own data directory, one per save" (advocate-reflect.md
§4), loaded via persona prompt sections with render-time variables (§5;
dsh-facts.md §2). dsh-facts.md §4: storage is only "files the plugin writes";
what none gets for free is the writer that converts repeated failure into the
right lesson. (b) concedes my loop is "a *better writer*" and composition "the
natural end state" (round-1-library). Every cross-session system (b) cites
(ExpeL, CLIN, AWM) keeps my write loop and adds a store. I concede (b)'s `asOf`
stamps and cross-save person layer are good increments — to a file format, not
an architecture. [reasoning]

**2. (c) curriculum — "knowledge is strictly post-wall": bounded tuition vs a prepaid budget.**

Conceded: my loop reacts. Corrected price: post-*signature* is not post-loss.
The locked walk ends `blocked` (bench/README.md); the K=3 signature trips after
three walks — minutes of game time [reasoning] — the directive lands in that
day's next prompt. P2-0019 lost days for skipping that turn; my ceiling is three
attempts plus one turn. (c) concedes the reactive case: urgent goals "degrade to
a route survey of the goal's own path" — my post-first-contact reaction with
more turns. The trade: three attempts + one turn, paid only where a wall exists,
versus a budgeted survey on every unlearned save even where the world documents
nothing, whose termination signals cannot certify the needed fact was found.
Conceded: observed beats inferred — hence searched facts enter as `hypothesis`,
promoting only on a confirming outcome. But the wall class shows the survey's
tuition: recording golem immunity at `observed` requires trying the golem —
"each swing is a failing task and drains health" (bench/README.md) — the same
failing task my detector consumes. [reasoning]

**3. (e) async — "the body waits through the reflection turn": and through every stage after it.**

Conceded: mine is synchronous; the idle rows (farm llm 0.36, mine llm 0.28,
hybrid 0.38) are real — the baseline's every-turn tax; my loop adds one capped
turn per stuck episode. Meanwhile (e)'s small brain freezes the
tail and safe-holds — "take no new semantic action" (its §3): the body is
equally inactive during (e)'s deliberation. The difference: mine resolves inside
the next prompt; (e) adds queue → next turn admission → big-brain ruling
(possibly one search) → adoption "at the *next step boundary*"
(§3–5), with delivery latency "an open spike item" and round-driver cadence
undocumented (its §4). "Both scenarios open stuck" cuts at (e) harder: both are
built so the direct plan is wrong from the start, and (e)'s small brain "never
invents approach steps" (§3) — every measured run spends its episode in the
exact safe-hold (e) prices me for, plus more stages. The
idle-0.00 rows still do not transfer: no model in the loop at all. [reasoning]

## New attacks

**(c) curriculum: the "honest gaps" defense collapses on its own trigger table.**

(c)'s round-1 answer to the confident-grinder attack: "missing facts as
`kind: 'unknown'`: honest gaps routed to the wiki search or the player." False
by (c)'s own mechanism: an `unknown` entry exists only where the survey
*encountered and noticed* a gap. A survey that never reached the notice board
writes neither a closure entry nor an unknown entry — unnoticed absence is
invisible to coverage rendering; the confident grinder survives in (c)'s
honesty costume. Concretely: an expired 8-turn budget or an early
`curriculum_done` leaves the guide silent on the closure; WORK begins; the goal
grinds the wall — P2-0019 plus a paid survey. Worse: the guide file now exists,
so trigger 1 never fires again; the only recovery is trigger 3 — "goal blocked
against an unrecorded obstacle" → a route survey *after* the first blocked
walk: my loop, conceded necessary, slower. (c) is not an alternative to the
reactive loop; it is a prepaid accelerant bolted onto it. And its round-1
latency defense ("survey legs are ideal PTC work") leans on a primitive its own
seams table files under "Batched survey legs (composition, not core)" — option
(d)'s, not (c)'s.

**(b) library: its RSIAgent citation disproves its "no reflection subsystem" claim.**

(b)'s round-1 answer: memory grows "from exactly these signals — 'verifier
verdicts, execution feedback, environment observations' — not from a separate
reflection subsystem." notes-rsi.md shows the opposite: RSIAgent's memory is
grown by dedicated curriculum, actor, and verifier agent roles with
distill-then-reconcile after each wave and "the actor's learning diagnosis
handed to the curriculum agent" — a multi-agent reflection subsystem. The
signals exist; the distillation is the subsystem, and that is what (b) lacks:
event 2's write stays discretionary — P2-0019's model re-walked for days rather
than writing anything — while event 1 is an unconditional "one model call per
game day," a standing tax even on quiet saves [reasoning: fixed per-day rate,
not gated on anything to learn]. A store whose writer is discretion
plus a daily toll does not own growth; the loop that decides *when* knowing
happens is the architecture.
