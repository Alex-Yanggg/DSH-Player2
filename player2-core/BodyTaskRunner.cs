using System;
using System.Collections.Generic;
using System.Linq;

namespace DSHPlayer2.Core;

/// <summary>What the body did on the last unpaused tick, measured by the adapter.</summary>
public readonly record struct BodyTickFacts(
    long Tick,
    string Location,
    int TileX,
    int TileY,
    bool HeldMovement,
    double DisplacementPx,
    double? NearestMonsterTiles);

/// <summary>The buttons the adapter applies on this tick.</summary>
public sealed record BodyTickCommand(IReadOnlyCollection<string> Held, IReadOnlyCollection<string> Pressed);

/// <summary>
/// Plays one raw input sequence tick by tick (P2-0021). It knows buttons,
/// durations and stop conditions; it does not know what any button means in
/// the game. Durations count unpaused ticks, so an open chat (which pauses
/// single-player Stardew) pauses the sequence instead of eating it.
/// </summary>
public sealed class BodyTaskRunner
{

    private readonly BodyTask task;
    private readonly int[] stepTicks;
    private readonly List<BodyEvent> events = new();
    private readonly int? blockedTicks;
    private int step;
    private int stepTick;
    private int stillTicks;
    private bool blockedReported;
    private string? startLocation;

    public BodyTaskRunner(BodyTask task, IReadOnlyCollection<BodyInputDescriptor> declared, bool cheatsAllowed, double tickMs, int maxSteps, int maxStepMs)
    {
        this.task = task ?? throw new ArgumentNullException(nameof(task));
        this.stepTicks = task.Steps.Select(s => s.Ms <= 0 ? 1 : Math.Max(1, (int)Math.Round(s.Ms / tickMs))).ToArray();
        this.blockedTicks = task.Until?.BlockedMs is { } ms ? Math.Max(1, (int)Math.Round(ms / tickMs)) : null;
        var known = declared.ToDictionary(input => input.Id, StringComparer.Ordinal);
        if (task.Steps.Count > maxSteps)
        {
            this.Fail($"too-many-steps: {task.Steps.Count} > {maxSteps}");
            return;
        }
        foreach (var s in task.Steps)
        {
            if (s.Ms > maxStepMs)
            {
                this.Fail($"step-too-long: {s.Ms} ms > {maxStepMs} ms");
                return;
            }
            foreach (var id in (s.Hold ?? Array.Empty<string>()).Concat(s.Press ?? Array.Empty<string>()))
            {
                if (!known.TryGetValue(id, out var input))
                {
                    this.Fail($"unknown-input: {id}");
                    return;
                }
                if (input.Cheat == true && !cheatsAllowed)
                {
                    this.Fail($"cheat-off: {id} is a cheat input and no cheat switch is on");
                    return;
                }
                var pressed = s.Press?.Contains(id) == true;
                if (pressed && input.Kind == "hold")
                {
                    this.Fail($"wrong-kind: {id} must be held, not pressed");
                    return;
                }
                if (!pressed && input.Kind == "press")
                {
                    this.Fail($"wrong-kind: {id} is a press button");
                    return;
                }
            }
        }
        this.Status = "running";
    }

    public BodyTask Task => this.task;
    public string Status { get; private set; } = "accepted";
    public string? Reason { get; private set; }
    public int Step => this.step;
    public IReadOnlyList<BodyEvent> Events => this.events;
    public bool IsTerminal => this.Status is "done" or "interrupted" or "failed" or "cancelled";
    public int Update { get; private set; }

    /// <summary>
    /// Advances one unpaused tick. <paramref name="facts"/> describe the result
    /// of the previous tick; the returned command is what to apply now.
    /// </summary>
    public BodyTickCommand Tick(BodyTickFacts facts)
    {
        if (this.IsTerminal) return Empty;
        this.startLocation ??= facts.Location;
        if (this.CheckUntil(facts)) return Empty;
        if (this.stepTick >= this.stepTicks[this.step])
        {
            this.step++;
            this.stepTick = 0;
            this.Update++;
            if (this.step >= this.stepTicks.Length)
            {
                this.Finish("done", "completed", facts.Tick);
                return Empty;
            }
        }
        var current = this.task.Steps[this.step];
        var pressed = this.stepTick == 0 ? (IReadOnlyCollection<string>)(current.Press ?? Array.Empty<string>()) : Array.Empty<string>();
        this.stepTick++;
        return new BodyTickCommand(current.Hold ?? Array.Empty<string>(), pressed);
    }

    /// <summary>The plugin cancelled this task, or a newer one replaced it.</summary>
    public void Cancel(string reason, long tick)
    {
        if (!this.IsTerminal) this.Finish("cancelled", reason, tick);
    }

    /// <summary>Records an adapter event (tool used, item picked up, warp) without ending the task.</summary>
    public void Note(long tick, string kind, string detail)
    {
        if (this.events.Count >= 32) this.events.RemoveAt(0);
        this.events.Add(new BodyEvent(tick, kind, detail.Length > 240 ? detail[..240] : detail));
        this.Update++;
    }

    /// <summary>The adapter could not carry out a step (no body, location gone).</summary>
    public void FailNow(string reason, long tick)
    {
        if (!this.IsTerminal) this.Finish("failed", reason, tick);
    }

    public BodyTaskStatus ToStatus(long stateRevision, string updatedAt)
    {
        return new BodyTaskStatus(BodyChannel.ProtocolVersion, this.task.TaskId, this.task.Seq, this.Status, this.Update,
            this.step, this.events.ToArray(), this.Reason, stateRevision, updatedAt);
    }

    private static readonly BodyTickCommand Empty = new(Array.Empty<string>(), Array.Empty<string>());

    private bool CheckUntil(BodyTickFacts facts)
    {
        var until = this.task.Until;
        if (until?.Arrive is { } arrive && string.Equals(arrive.Location, facts.Location, StringComparison.Ordinal)
            && Math.Abs(arrive.X - facts.TileX) <= arrive.Radius && Math.Abs(arrive.Y - facts.TileY) <= arrive.Radius)
        {
            this.Finish("done", "arrived", facts.Tick);
            return true;
        }
        if (until?.Warped == true && this.startLocation is not null && !string.Equals(this.startLocation, facts.Location, StringComparison.Ordinal))
        {
            this.Finish("done", "warped", facts.Tick);
            return true;
        }
        if (until?.MonsterWithin is { } within && facts.NearestMonsterTiles is { } nearest && nearest <= within)
        {
            this.Finish("interrupted", "monster", facts.Tick);
            return true;
        }
        if (facts.HeldMovement)
        {
            this.stillTicks = facts.DisplacementPx < 0.5 ? this.stillTicks + 1 : 0;
            if (this.blockedTicks is { } limit && this.stillTicks >= limit)
            {
                this.Finish("interrupted", "blocked", facts.Tick);
                return true;
            }
            if (this.stillTicks >= 30 && !this.blockedReported)
            {
                this.blockedReported = true;
                this.Note(facts.Tick, "blocked", $"no movement at {facts.Location} {facts.TileX},{facts.TileY}");
            }
        }
        else
        {
            this.stillTicks = 0;
        }
        return false;
    }

    private void Fail(string reason)
    {
        this.Status = "failed";
        this.Reason = reason;
        this.Update++;
    }

    private void Finish(string status, string reason, long tick)
    {
        this.Status = status;
        this.Reason = reason;
        this.Note(tick, status, reason);
    }
}
