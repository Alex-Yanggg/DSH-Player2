using System;
using System.Collections.Generic;
using System.Linq;
using DSHPlayer2.Core;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewValley;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The companion's body (P2-0022): its own farmer at its own seat
/// (<see cref="CompanionSeat"/>), driven by a virtual controller. The adapter
/// does two things only: it plays the plugin's raw button sequences on that
/// controller and exports what the seat sees (<see cref="BodyStateExporter"/>).
/// Every button does what the game binds it to; nothing here knows what a
/// tool, crop, door or shop is. Runs on the seat screen.
/// </summary>
internal sealed class BodyAdapter
{
    /// <summary>Native emote names (the co-op chat's /emote); declared first, the input list below reads them.</summary>
    private static readonly string[] Emotes = { "happy", "sad", "heart", "exclamation", "question", "laugh", "angry", "surprised", "sleep", "music", "yes", "no", "hi" };

    /// <summary>The controller the game reads for the seat. Descriptions follow the game's own controller layout.</summary>
    public static readonly BodyInputDescriptor[] Inputs = new BodyInputDescriptor[]
    {
        new("DPadUp", "hold", "Walk up (north) while held; in a menu, move the cursor up. A short tap turns to face up.", Role: "up"),
        new("DPadRight", "hold", "Walk right (east) while held; in a menu, move the cursor right.", Role: "right"),
        new("DPadDown", "hold", "Walk down (south) while held; in a menu, move the cursor down.", Role: "down"),
        new("DPadLeft", "hold", "Walk left (west) while held; in a menu, move the cursor left.", Role: "left"),
        new("ControllerA", "press", "A: the action button on what you face (talk, harvest, plant the held seed, pick up, open doors and shop counters, sleep in bed); in a menu, select or buy what the cursor is on.", Role: "action"),
        new("ControllerX", "press", "X: use the selected tool or weapon on the tile you face (uses stamina)."),
        new("ControllerB", "press", "B: open the inventory menu; in a menu, back out or close it (the inventory will not close while an item is held on the cursor; put it down with A first)."),
        new("ControllerY", "press", "Y: the game's Y button (crafting menu; in some menus, a secondary action)."),
        new("LeftShoulder", "press", "LB: rotate the backpack so the previous row of 12 becomes the toolbar (no change with a single row)."),
        new("RightShoulder", "press", "RB: rotate the backpack so the next row of 12 becomes the toolbar (no change with a single row)."),
        new("ControllerStart", "press", "Start: the game menu."),
        new("ControllerBack", "press", "Back: the journal."),
    // No LT/RT: SMAPI sets only a trigger's analog value and the game reads trigger button flags, so they never register.
    // SlotN is the keyboard's toolbar hotkey (1-9, 0, -, =); a real key press would switch the seat out of gamepad mode.
    // EmoteX is the co-op chat's /emote: an emote bubble over your head that every farmer sees, no words needed.
    }.Concat(Enumerable.Range(1, 12).Select(n => new BodyInputDescriptor($"Slot{n}", "press", $"Select toolbar slot {n} (outside menus).")))
     .Concat(Emotes.Select(name => new BodyInputDescriptor($"Emote{char.ToUpperInvariant(name[0])}{name[1..]}", "press", $"Show the {name} emote over your head."))).ToArray();

    private const int MaxSteps = 64;
    private const int MaxStepMs = 10_000;
    /// <summary>The cached grid keeps refreshing this long after the last input.</summary>
    private const int ActiveGraceTicks = 180;

    private readonly IMonitor monitor;
    private readonly IInputHelper input;
    private readonly Func<bool> cheatSetting;
    private readonly BodyChannel channel;
    private readonly BodyStateExporter exporter;
    private readonly HashSet<SButton> down = new();
    private bool attached;
    private bool declare;
    private BodyTaskRunner? runner;
    private int lastStatusUpdate = -1;
    private int lastSeq;
    private int activeUntilTick = -1;
    private Vector2 lastPosition;
    private string? lastLocation;
    private bool lastHeldMovement;
    private double lastDisplacement;

    public BodyAdapter(IMonitor monitor, IInputHelper input, BodyChannel channel, Func<bool> cheatSetting)
    {
        this.monitor = monitor;
        this.input = input;
        this.channel = channel;
        this.cheatSetting = cheatSetting;
        this.exporter = new BodyStateExporter(monitor);
    }

    public string? SessionRoot { get; private set; }

    /// <summary>Binds the body to one person and save; the seat declares itself on its next tick.</summary>
    public void Attach(string sessionRoot)
    {
        if (this.SessionRoot != sessionRoot || !this.attached)
        {
            this.Detach("session-changed");
            this.SessionRoot = sessionRoot;
            // Pending work of another save is dropped with the old binding.
            this.channel.Attach(sessionRoot);
            this.attached = true;
        }
        this.declare = true;
    }

    public void Detach(string reason)
    {
        this.CancelActive(reason);
        this.runner = null;
        this.attached = false;
        this.SessionRoot = null;
        this.lastSeq = 0;
    }

    /// <summary>The player's own stop takes the body back, like grabbing the controller.</summary>
    public void CancelActive(string reason)
    {
        if (this.runner is { IsTerminal: false })
        {
            this.runner.Cancel(reason, Game1.ticks);
            this.WriteStatus();
        }
    }

    /// <summary>Seat screen, every tick before the game reads input.</summary>
    public void OnTick()
    {
        if (!this.attached) return;
        var farmer = CompanionSeat.Playing ? Game1.player : null;
        var paused = farmer is null || !Game1.shouldTimePass();
        this.channel.SetPaused(paused);
        if (farmer is not null && this.declare) this.Declare(farmer);
        if (farmer is not null) this.Measure(farmer);
        this.PollInput(farmer);
        IReadOnlyCollection<string> held = Array.Empty<string>();
        IReadOnlyCollection<string> pressed = Array.Empty<string>();
        if (this.runner is { IsTerminal: false } active)
        {
            if (farmer is null) active.FailNow("no-body: the companion is not in the world", Game1.ticks);
            else if (!paused)
            {
                var command = active.Tick(this.Facts(farmer));
                held = command.Held;
                pressed = command.Pressed;
                this.activeUntilTick = Game1.ticks + ActiveGraceTicks;
            }
        }
        this.Play(held, pressed);
        if (farmer is not null && !farmer.UsingTool && Context.IsPlayerFree && pressed.LastOrDefault(id => id.StartsWith("Slot")) is { } slot)
            farmer.CurrentToolIndex = int.Parse(slot[4..]) - 1;
        if (farmer is not null && pressed.LastOrDefault(id => id.StartsWith("Emote")) is { } emote)
            farmer.netDoEmote(emote[5..].ToLowerInvariant());
        if (farmer is not null && Game1.ticks <= this.activeUntilTick) this.exporter.RefreshRow(farmer);
        if (farmer is not null && this.channel.StateWanted) this.WriteState(farmer, paused);
        if (this.runner is not null && this.runner.Update != this.lastStatusUpdate) this.WriteStatus();
    }

    /// <summary>
    /// Holds and taps the seat's controller buttons for this tick through
    /// SMAPI's input overrides. Held buttons are pressed again every tick; a
    /// button let go is released explicitly, because the game window may be
    /// unfocused (SMAPI then keeps the last state).
    /// </summary>
    private void Play(IReadOnlyCollection<string> held, IReadOnlyCollection<string> pressed)
    {
        var want = new HashSet<SButton>();
        foreach (var id in held.Concat(pressed))
        {
            if (Enum.TryParse<SButton>(id, out var button)) want.Add(button);
        }
        foreach (var button in want) this.input.Press(button);
        foreach (var button in this.down.Where(button => !want.Contains(button))) this.input.Suppress(button);
        this.down.Clear();
        this.down.UnionWith(want);
    }

    private void Declare(Farmer farmer)
    {
        this.declare = false;
        try
        {
            this.exporter.InvalidateGrid();
            this.channel.WriteDeclaration(new BodyDeclaration(
                BodyChannel.ProtocolVersion,
                "stardew-smapi",
                "stardew-valley",
                BodyWire.Now(),
                new BodyStateDescriptor("world_state", "world_map",
                    "Raw Stardew Valley state as the companion's own farmer sees it: its location map as one character per tile, objects and terrain features as the game holds them, characters, warps, both farmers' inventories, the clock, and the menu open on its screen. world_map is the location graph.",
                    BodyStateExporter.Fields,
                    BodyStateExporter.Legend),
                Inputs,
                new BodyLimits(MaxSteps, MaxStepMs, 1000d / 60d, Math.Max(1, farmer.getMovementSpeed()), 64),
                new BodyCheats(this.cheatSetting())));
            var bytes = this.channel.WriteWorld(this.exporter.BuildWorld());
            this.monitor.Log($"Player2 body declared {Inputs.Length} controller buttons; world graph {bytes} bytes.", LogLevel.Trace);
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body could not write its declaration: {ex.Message}", LogLevel.Error);
        }
    }

    /// <summary>What the last tick did: how far the farmer moved under held directions, and warps.</summary>
    private void Measure(Farmer farmer)
    {
        var location = farmer.currentLocation?.NameOrUniqueName;
        this.lastDisplacement = location == this.lastLocation ? Vector2.Distance(this.lastPosition, farmer.Position) : 0;
        this.lastHeldMovement = this.down.Any(button => button is SButton.DPadUp or SButton.DPadRight or SButton.DPadDown or SButton.DPadLeft);
        if (this.lastLocation is not null && location != this.lastLocation)
        {
            this.runner?.Note(Game1.ticks, "warped", $"{this.lastLocation} -> {location}");
            this.exporter.InvalidateGrid();
        }
        this.lastLocation = location;
        this.lastPosition = farmer.Position;
    }

    private void PollInput(Farmer? farmer)
    {
        try
        {
            if (this.runner is { IsTerminal: false } running && this.channel.IsCancelled(running.Task.Seq, running.Task.TaskId))
            {
                running.Cancel("cancelled", Game1.ticks);
            }
            var pending = this.channel.PendingTaskSequences(this.lastSeq);
            if (pending.Count == 0) return;
            // Newest wins, like a player changing the input: older unanswered
            // tasks are answered as superseded instead of replayed.
            foreach (var stale in pending.Take(pending.Count - 1)) this.AnswerStale(stale);
            var seq = pending[^1];
            this.lastSeq = seq;
            if (this.runner is { IsTerminal: false } previous)
            {
                previous.Cancel("preempted", Game1.ticks);
                this.WriteStatus();
            }
            this.runner = new BodyTaskRunner(this.channel.ReadTask(seq), Inputs, this.CheatsAllowed(), 1000d / 60d, MaxSteps, MaxStepMs);
            this.lastStatusUpdate = -1;
            if (farmer is null && !this.runner.IsTerminal) this.runner.FailNow("no-body: the companion is not in the world", Game1.ticks);
            this.WriteStatus();
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body could not read input: {ex.Message}", LogLevel.Warn);
        }
    }

    private void AnswerStale(int seq)
    {
        var stale = new BodyTaskRunner(this.channel.ReadTask(seq), Inputs, false, 1000d / 60d, MaxSteps, MaxStepMs);
        stale.Cancel("superseded", Game1.ticks);
        this.channel.WriteStatus(stale.ToStatus(this.exporter.Revision, BodyWire.Now()));
    }

    private bool CheatsAllowed() => this.cheatSetting() || this.channel.ReadCheatGrant() is { Granted: true };

    private BodyTickFacts Facts(Farmer farmer)
    {
        double? nearest = null;
        foreach (var character in farmer.currentLocation.characters)
        {
            if (character is StardewValley.Monsters.Monster { IsInvisible: false } monster)
            {
                var d = Vector2.Distance(monster.Tile, farmer.Tile);
                nearest = nearest is null ? d : Math.Min(nearest.Value, d);
            }
        }
        return new BodyTickFacts(Game1.ticks, farmer.currentLocation.NameOrUniqueName, farmer.TilePoint.X, farmer.TilePoint.Y,
            this.lastHeldMovement, this.lastDisplacement, nearest);
    }

    private void WriteState(Farmer farmer, bool paused)
    {
        try
        {
            this.channel.WriteState(this.exporter.BuildState(farmer, paused, this.runner is { IsTerminal: false } r ? r.Task.Seq : null, this.lastHeldMovement && this.lastDisplacement > 0));
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body state export failed: {ex.Message}", LogLevel.Warn);
        }
    }

    private void WriteStatus()
    {
        if (!this.attached || this.runner is null) return;
        try
        {
            this.channel.WriteStatus(this.runner.ToStatus(this.exporter.Revision, BodyWire.Now()));
            this.lastStatusUpdate = this.runner.Update;
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body status write failed: {ex.Message}", LogLevel.Warn);
        }
    }
}
