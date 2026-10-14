using System;
using System.Collections.Generic;
using System.Linq;
using DSHPlayer2.Core;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewValley;
using StardewValley.Tools;

namespace DSHPlayer2.Stardew;

/// <summary>
/// P2-0021 body adapter: the hand-controller adapter board between the DSH
/// plugin and the companion's body. It does two things only: it exports the
/// game's state as raw as it can (<see cref="BodyStateExporter"/>) and it
/// plays raw input sequences on the body. It has no "walk to", no "chop the
/// tree", and makes no decision; buttons do what the game does for a farmer.
///
/// SMAPI cannot inject device input, and the companion is not the local
/// player anyway (S9), so the input layer is the plan's fallback: each button
/// is the in-game call a farmer's button reaches (collision-checked walking,
/// <see cref="Tool.DoFunction"/>, <see cref="MeleeWeapon.DoDamage"/>, the
/// action button on the faced tile), still without translating any meaning.
/// </summary>
internal sealed class BodyAdapter
{
    public static readonly BodyInputDescriptor[] Inputs =
    {
        new("MoveUp", "hold", "Walk up (north) while held; the game's collision applies, and walking into a map-edge warp changes location."),
        new("MoveRight", "hold", "Walk right (east) while held."),
        new("MoveDown", "hold", "Walk down (south) while held."),
        new("MoveLeft", "hold", "Walk left (west) while held."),
        new("FaceUp", "press", "Tap up: turn to face north without stepping."),
        new("FaceRight", "press", "Tap right: turn to face east without stepping."),
        new("FaceDown", "press", "Tap down: turn to face south without stepping."),
        new("FaceLeft", "press", "Tap left: turn to face west without stepping."),
        new("UseTool", "press", "Use the selected toolbar item on the faced tile, as the farmer's tool button does: hoe tills or digs spots, watering can waters or refills at water, pickaxe breaks stones, axe chops, scythe and weapons swing at the tiles and monsters in front. Uses body stamina."),
        new("Action", "press", "The action button on the faced tile: harvest a ready crop, plant the selected seed in empty tilled soil, pick up forage, go through a door, open a shop counter (the shop's stock then appears as body.menu), or whatever the game itself does when a farmer presses action on the object or plant there (load or empty a machine with the selected item, open a chest, shake a tree); any text or menu the game shows is reported in the task's events."),
        new("DropItem", "press", "Drop the whole selected stack on the ground in front (a farmer can pick it up)."),
        new("Slot1", "press", "Select toolbar slot 1."), new("Slot2", "press", "Select toolbar slot 2."), new("Slot3", "press", "Select toolbar slot 3."),
        new("Slot4", "press", "Select toolbar slot 4."), new("Slot5", "press", "Select toolbar slot 5."), new("Slot6", "press", "Select toolbar slot 6."),
        new("Slot7", "press", "Select toolbar slot 7."), new("Slot8", "press", "Select toolbar slot 8."), new("Slot9", "press", "Select toolbar slot 9."),
        new("Slot10", "press", "Select toolbar slot 10."), new("Slot11", "press", "Select toolbar slot 11."), new("Slot12", "press", "Select toolbar slot 12."),
        new("MenuUp", "press", "In an open menu (body.menu): move the cursor up one line."),
        new("MenuDown", "press", "In an open menu: move the cursor down one line."),
        new("MenuConfirm", "press", "In an open shop menu: buy one of the item under the cursor, paid from the player's wallet (the body has none)."),
        new("MenuClose", "press", "Close the open menu. Walking away from the counter also closes it."),
        new("NoClip", "modifier", "Cheat: while held together with a direction, walking ignores collision.", Cheat: true),
    };

    private const int MaxSteps = 64;
    private const int MaxStepMs = 10_000;
    private const int InputPollTicks = 6;
    private const int StateTicks = 30;
    private const int FastStateTicks = 6;
    // A reflex loop reads state and sends its next input between tasks, so the
    // fast cadence (state every 6 ticks, input every tick) lasts this long after
    // a fast-state task ends.
    private const int FastGraceTicks = 120;
    private const int SpeechPollTicks = 15;

    private readonly IMonitor monitor;
    private readonly Func<NativeCompanion?> body;
    private readonly Func<bool> cheatSetting;
    private readonly Action<string> speak;
    private readonly BodyStateExporter exporter;
    private readonly Dictionary<Debris, int> droppedByBody = new();
    private BodyShop? shop;
    private BodyBridgeFiles? files;
    private BodyTaskRunner? runner;
    private int lastStatusUpdate = -1;
    private int lastSeq;
    private int inputCountdown;
    private int fastUntilTick = -1;
    private int lastWorldTick = -1;
    private int stateCountdown;
    private int speechCountdown;
    private bool forceState;

    public BodyAdapter(IMonitor monitor, Func<NativeCompanion?> body, Func<bool> cheatSetting, Action<string> speak)
    {
        this.monitor = monitor;
        this.body = body;
        this.cheatSetting = cheatSetting;
        this.speak = speak;
        this.exporter = new BodyStateExporter(monitor);
    }

    public string? SessionRoot { get; private set; }

    /// <summary>Binds the lane to one person and save and declares what it exports and accepts.</summary>
    public void Attach(string sessionRoot)
    {
        if (this.SessionRoot == sessionRoot && this.files is not null)
        {
            this.WriteDeclarationAndWorld();
            return;
        }
        this.Detach("session-changed");
        this.SessionRoot = sessionRoot;
        this.files = new BodyBridgeFiles(sessionRoot);
        try
        {
            this.files.SweepOlderThan(TimeSpan.FromDays(1), DateTimeOffset.UtcNow);
            // Tasks written while the game was not running are stale: answer
            // them cancelled instead of replaying old input into a new day.
            foreach (var seq in this.files.PendingTaskSequences(0))
            {
                this.lastSeq = Math.Max(this.lastSeq, seq);
                this.TryAnswerStale(seq);
            }
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body lane could not tidy old frames: {ex.Message}", LogLevel.Warn);
        }
        this.WriteDeclarationAndWorld();
        this.forceState = true;
    }

    public void Detach(string reason)
    {
        if (this.runner is { IsTerminal: false })
        {
            this.runner.Cancel(reason, Game1.ticks);
            this.WriteStatus();
        }
        this.runner = null;
        this.body()?.SetHeld(Array.Empty<string>());
        this.files = null;
        this.SessionRoot = null;
        this.lastSeq = 0;
        this.droppedByBody.Clear();
        this.shop = null;
    }

    /// <summary>Re-writes the location graph (day start).</summary>
    public void WriteDeclarationAndWorld()
    {
        if (this.files is null) return;
        try
        {
            this.exporter.InvalidateGrid();
            this.files.WriteDeclaration(this.Declaration());
            var bytes = this.files.WriteWorld(this.exporter.BuildWorld());
            this.monitor.Log($"Player2 body lane declared {Inputs.Length} inputs; world graph {bytes} bytes.", LogLevel.Trace);
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body lane could not write its declaration: {ex.Message}", LogLevel.Error);
        }
    }

    /// <summary>The player's own movement command takes the body back, like grabbing the controller.</summary>
    public void CancelActive(string reason)
    {
        if (this.runner is { IsTerminal: false })
        {
            this.runner.Cancel(reason, Game1.ticks);
            this.body()?.SetHeld(Array.Empty<string>());
            this.forceState = true;
            this.WriteStatus();
        }
    }

    /// <summary>One game tick (called after the game's own update).</summary>
    public void OnTick()
    {
        if (this.files is null) return;
        var actor = this.body();
        // The game freezes its world (Game1.ticks stops) when the window loses
        // focus, while SMAPI keeps ticking this lane: that is a pause too.
        var worldTicked = Game1.ticks != this.lastWorldTick;
        this.lastWorldTick = Game1.ticks;
        var paused = !worldTicked || !(Game1.activeClickableMenu is null && !Game1.eventUp && Game1.shouldTimePass());
        if (actor is not null && !paused && actor.currentLocation is not null && actor.LastUpdateTick != Game1.ticks)
        {
            // Off-screen locations do not tick their characters in single
            // player; the body keeps walking there the way a farmer would.
            actor.update(Game1.currentGameTime, actor.currentLocation);
        }
        if (this.runner is { IsTerminal: false, Task.FastState: true }) this.fastUntilTick = Game1.ticks + FastGraceTicks;
        var fast = Game1.ticks <= this.fastUntilTick;
        if (fast) this.stateCountdown = Math.Min(this.stateCountdown, FastStateTicks);
        if (--this.inputCountdown <= 0 || fast)
        {
            this.inputCountdown = InputPollTicks;
            this.PollInput(actor);
        }
        if (this.runner is { IsTerminal: false } active)
        {
            if (actor?.currentLocation is null)
            {
                active.FailNow("no-body", Game1.ticks);
            }
            else if (!paused)
            {
                this.CheckWalkWarp(actor, active);
                var command = active.Tick(this.Facts(actor));
                actor.SetHeld(command.Held);
                foreach (var press in command.Pressed) this.Press(actor, press, active);
            }
            if (active.IsTerminal)
            {
                actor?.SetHeld(Array.Empty<string>());
                this.forceState = true;
            }
        }
        if (actor is not null && !paused && Game1.ticks % 4 == 0) this.PickUpNearby(actor);
        if (!paused) this.exporter.RefreshRow(actor);
        if (--this.stateCountdown <= 0 || this.forceState)
        {
            this.stateCountdown = fast ? FastStateTicks : StateTicks;
            this.WriteState(actor, paused);
        }
        if (this.runner is not null && this.runner.Update != this.lastStatusUpdate) this.WriteStatus();
        if (--this.speechCountdown <= 0)
        {
            this.speechCountdown = SpeechPollTicks;
            this.PollSpeech();
        }
    }

    private bool CheatsAllowed()
    {
        return this.cheatSetting() || this.files?.ReadCheatGrant() is { Granted: true };
    }

    private BodyDeclaration Declaration()
    {
        return new BodyDeclaration(
            BodyBridgeFiles.ProtocolVersion,
            "stardew-smapi",
            "stardew-valley",
            DecisionBridgeRules.TimestampNow(),
            new BodyStateDescriptor("state.json", "world.json",
                "Raw Stardew Valley state around the companion's body: the body's location map as one character per tile, objects and terrain features as the game holds them, characters, warps, both farmers' inventories, and the clock. world.json is the location graph.",
                BodyStateExporter.Fields,
                BodyStateExporter.Legend),
            Inputs,
            new BodyLimits(MaxSteps, MaxStepMs, 1000d / 60d, NativeCompanion.InputWalkPxPerTick, 64),
            new BodyCheats(this.cheatSetting()));
    }

    private void PollInput(NativeCompanion? actor)
    {
        if (this.files is null) return;
        try
        {
            if (this.runner is { IsTerminal: false } running && this.files.IsCancelled(running.Task.Seq, running.Task.TaskId))
            {
                running.Cancel("cancelled", Game1.ticks);
                actor?.SetHeld(Array.Empty<string>());
                this.forceState = true;
            }
            var pending = this.files.PendingTaskSequences(this.lastSeq);
            if (pending.Count == 0) return;
            // Newest wins, like a player changing the input: older unanswered
            // tasks are answered as superseded instead of replayed.
            foreach (var stale in pending.Take(pending.Count - 1)) this.TryAnswerStale(stale, "superseded");
            var seq = pending[^1];
            BodyTask task;
            try
            {
                task = this.files.ReadTask(seq);
            }
            catch (Exception ex) when (ex is System.Text.Json.JsonException or System.IO.InvalidDataException)
            {
                // A malformed frame is skipped for good and logged; an IO race retries next poll.
                this.lastSeq = seq;
                this.monitor.Log($"Player2 body lane refused malformed task {seq}: {ex.Message}", LogLevel.Warn);
                return;
            }
            this.lastSeq = seq;
            if (this.runner is { IsTerminal: false } previous)
            {
                previous.Cancel("preempted", Game1.ticks);
                this.WriteStatus();
            }
            this.runner = new BodyTaskRunner(task, Inputs, this.CheatsAllowed(), 1000d / 60d, MaxSteps, MaxStepMs);
            this.lastStatusUpdate = -1;
            if (actor is null && !this.runner.IsTerminal) this.runner.FailNow("no-body: the companion is not in the world", Game1.ticks);
            if (actor is not null && !this.runner.IsTerminal) actor.StopForInput();
            this.forceState = true;
            this.WriteStatus();
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body lane could not read input: {ex.Message}", LogLevel.Warn);
        }
    }

    private void TryAnswerStale(int seq, string reason = "stale")
    {
        try
        {
            var task = this.files!.ReadTask(seq);
            var stale = new BodyTaskRunner(task, Inputs, false, 1000d / 60d, MaxSteps, MaxStepMs);
            stale.Cancel(reason, Game1.ticks);
            this.files.WriteStatus(stale.ToStatus(this.exporter.Revision, DecisionBridgeRules.TimestampNow()));
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body lane skipped unreadable task {seq}: {ex.Message}", LogLevel.Warn);
        }
    }

    private BodyTickFacts Facts(NativeCompanion actor)
    {
        double? nearest = null;
        foreach (var character in actor.currentLocation.characters)
        {
            if (character is StardewValley.Monsters.Monster monster && !monster.IsInvisible)
            {
                var d = Vector2.Distance(monster.Tile, actor.Tile);
                nearest = nearest is null ? d : Math.Min(nearest.Value, d);
            }
        }
        return new BodyTickFacts(Game1.ticks, actor.currentLocation.NameOrUniqueName, actor.TilePoint.X, actor.TilePoint.Y,
            actor.LastHeldMovement, actor.LastDisplacementPx, nearest);
    }

    /// <summary>Walking into a warp changes location, exactly as it does for a farmer.</summary>
    private void CheckWalkWarp(NativeCompanion actor, BodyTaskRunner active)
    {
        if (actor.LastAttemptedBox is not { } box) return;
        // Asked as the farmer avatar: villager-only warps are not a farmer's exits.
        var warp = actor.currentLocation.isCollidingWithWarp(box, actor.Avatar);
        if (warp is null || Game1.getLocationFromName(warp.TargetName) is null) return;
        actor.LastAttemptedBox = null;
        var from = actor.currentLocation.NameOrUniqueName;
        Game1.warpCharacter(actor, warp.TargetName, new Point(warp.TargetX, warp.TargetY));
        active.Note(Game1.ticks, "warped", $"{from} -> {warp.TargetName} {warp.TargetX},{warp.TargetY}");
        this.exporter.InvalidateGrid();
        this.forceState = true;
    }

    private void Press(NativeCompanion actor, string id, BodyTaskRunner active)
    {
        try
        {
            switch (id)
            {
                case "FaceUp": actor.Face(0); break;
                case "FaceRight": actor.Face(1); break;
                case "FaceDown": actor.Face(2); break;
                case "FaceLeft": actor.Face(3); break;
                case "UseTool": this.UseTool(actor, active); break;
                case "Action": this.Action(actor, active); break;
                case "DropItem": this.Drop(actor, active); break;
                case "MenuUp": this.MoveCursor(-1, active); break;
                case "MenuDown": this.MoveCursor(1, active); break;
                case "MenuConfirm": this.Confirm(actor, active); break;
                case "MenuClose":
                    active.Note(Game1.ticks, this.shop is null ? "no-menu" : "menu-closed", this.shop?.ShopId ?? "no menu is open");
                    this.shop = null;
                    break;
                default:
                    if (id.StartsWith("Slot", StringComparison.Ordinal) && int.TryParse(id[4..], out var slot))
                    {
                        actor.Avatar.CurrentToolIndex = Math.Clamp(slot - 1, 0, Math.Max(0, actor.Avatar.Items.Count - 1));
                        var item = actor.Avatar.CurrentItem;
                        active.Note(Game1.ticks, "selected", $"slot {slot}: {item?.DisplayName ?? "empty"}");
                    }
                    break;
            }
        }
        catch (Exception ex)
        {
            // A game exception is reported as what happened, never hidden.
            active.Note(Game1.ticks, "error", $"{id}: {ex.GetType().Name}: {ex.Message}");
            this.monitor.Log($"Player2 body input {id} threw: {ex}", LogLevel.Warn);
        }
        this.exporter.InvalidateAround(actor, FacedTile(actor));
        this.forceState = true;
    }

    private static Point FacedTile(NativeCompanion actor)
    {
        var t = actor.TilePoint;
        return actor.FacingDirection switch { 0 => new Point(t.X, t.Y - 1), 1 => new Point(t.X + 1, t.Y), 2 => new Point(t.X, t.Y + 1), _ => new Point(t.X - 1, t.Y) };
    }

    private static void SyncAvatar(NativeCompanion actor)
    {
        var avatar = actor.Avatar;
        avatar.currentLocation = actor.currentLocation;
        avatar.Position = actor.AvatarPosition;
        avatar.FacingDirection = actor.FacingDirection;
    }

    private void UseTool(NativeCompanion actor, BodyTaskRunner active)
    {
        SyncAvatar(actor);
        var avatar = actor.Avatar;
        var location = actor.currentLocation;
        var tile = FacedTile(actor);
        var item = avatar.CurrentItem;
        if (item is not Tool tool)
        {
            active.Note(Game1.ticks, "nothing-to-use", item is null ? "selected slot is empty" : $"{item.DisplayName} is not a tool");
            return;
        }
        var stamina = avatar.Stamina;
        if (tool is MeleeWeapon weapon)
        {
            location.playSound(weapon.isScythe() ? "swordswipe" : "swordswipe");
            var center = actor.GetBoundingBox().Center;
            var reach = new Point(center.X + (tile.X - actor.TilePoint.X) * 64, center.Y + (tile.Y - actor.TilePoint.Y) * 64);
            weapon.DoDamage(location, reach.X, reach.Y, actor.FacingDirection, 1, avatar);
        }
        else
        {
            tool.DoFunction(location, tile.X * 64 + 32, tile.Y * 64 + 32, 1, avatar);
        }
        actor.Avatar.lastClick = new Vector2(tile.X * 64 + 32, tile.Y * 64 + 32);
        active.Note(Game1.ticks, "used", $"{tool.DisplayName} at {tile.X},{tile.Y}; stamina {stamina:0} -> {avatar.Stamina:0}");
    }

    private void Action(NativeCompanion actor, BodyTaskRunner active)
    {
        SyncAvatar(actor);
        var avatar = actor.Avatar;
        var location = actor.currentLocation;
        var tile = FacedTile(actor);
        var vector = new Vector2(tile.X, tile.Y);
        if (location.terrainFeatures.TryGetValue(vector, out var feature) && feature is StardewValley.TerrainFeatures.HoeDirt dirt)
        {
            if (dirt.crop is { } crop && dirt.readyForHarvest())
            {
                var debrisBefore = location.debris.Count;
                var playerBefore = CountItem(Game1.player, crop.indexOfHarvest.Value);
                // The game drops harvested produce into the player's current location;
                // when the body harvests elsewhere, those items belong where it stands.
                var spill = Game1.currentLocation;
                var spillBefore = spill?.debris.Count ?? 0;
                var harvested = crop.harvest(tile.X, tile.Y, dirt, null, isForcedScytheHarvest: true);
                if (spill is not null && !ReferenceEquals(spill, location))
                {
                    for (var i = spillBefore; i < spill.debris.Count; i++) location.debris.Add(spill.debris[i]);
                    while (spill.debris.Count > spillBefore) spill.debris.RemoveAt(spill.debris.Count - 1);
                }
                if (harvested)
                {
                    if (!crop.RegrowsAfterHarvest()) dirt.destroyCrop(showAnimation: true);
                    var toPlayer = CountItem(Game1.player, crop.indexOfHarvest.Value) - playerBefore;
                    active.Note(Game1.ticks, "harvested", $"{ItemName(crop.indexOfHarvest.Value)} at {tile.X},{tile.Y}; dropped {location.debris.Count - debrisBefore} on the ground, {toPlayer} went to the player");
                }
                else
                {
                    active.Note(Game1.ticks, "harvest-refused", $"the game did not harvest {tile.X},{tile.Y}");
                }
                return;
            }
            if (dirt.crop is null && avatar.CurrentItem is StardewValley.Object seed && seed.Category is StardewValley.Object.SeedsCategory or StardewValley.Object.fertilizerCategory)
            {
                var fertilizer = seed.Category == StardewValley.Object.fertilizerCategory;
                if (dirt.plant(seed.ItemId, avatar, fertilizer))
                {
                    avatar.reduceActiveItemByOne();
                    active.Note(Game1.ticks, fertilizer ? "fertilized" : "planted", $"{seed.DisplayName} at {tile.X},{tile.Y}");
                }
                else
                {
                    active.Note(Game1.ticks, "plant-refused", $"the game refused {seed.DisplayName} at {tile.X},{tile.Y} (season, soil or tile)");
                }
                return;
            }
        }
        if (location.objects.TryGetValue(vector, out var obj) && obj.IsSpawnedObject)
        {
            var leftover = avatar.addItemToInventory(obj);
            if (leftover is null)
            {
                location.objects.Remove(vector);
                location.playSound("pickUpItem");
                active.Note(Game1.ticks, "picked-up", $"{obj.DisplayName} at {tile.X},{tile.Y}");
            }
            else
            {
                active.Note(Game1.ticks, "inventory-full", $"no room for {obj.DisplayName}");
            }
            return;
        }
        if (this.NativeInteract(actor, active, location, tile)) return;
        if (BodyStateExporter.ActionWarpAt(location, tile.X, tile.Y) is { } door && Game1.getLocationFromName(door.To) is not null)
        {
            var from = location.NameOrUniqueName;
            Game1.warpCharacter(actor, door.To, new Point(door.ToX, door.ToY));
            active.Note(Game1.ticks, "warped", $"{from} -> {door.To} {door.ToX},{door.ToY} (door)");
            return;
        }
        // A shop counter: the property may sit on the faced tile or the one behind it.
        var behind = new Point(tile.X + (tile.X - actor.TilePoint.X), tile.Y + (tile.Y - actor.TilePoint.Y));
        foreach (var counter in new[] { tile, behind })
        {
            var shopId = BodyShop.ShopIdAt(location, counter, out var raw);
            if (shopId is not null)
            {
                this.shop = BodyShop.TryOpen(location, counter, shopId, out var refusal);
                active.Note(Game1.ticks, this.shop is null ? "shop-refused" : "menu-opened", this.shop is null ? refusal : $"{shopId}: {this.shop.CursorLine()}");
                return;
            }
            if (raw is not null)
            {
                active.Note(Game1.ticks, "tile-action", $"the tile at {counter.X},{counter.Y} has a game action this body cannot operate: {raw}");
                return;
            }
        }
        active.Note(Game1.ticks, "nothing-there", $"no action at {tile.X},{tile.Y}");
    }

    /// <summary>
    /// Anything else on the faced tile gets the game's own interaction, as the
    /// action button would give a farmer: an object's drop-in and its
    /// <see cref="StardewValley.Object.checkForAction"/> (machines, chests,
    /// placed items), then a terrain feature's use action (shaking a tree or a
    /// bush). Nothing here knows what the thing is. A menu the game opens is
    /// read into the body's notes (a shop's stock becomes body.menu) and closed,
    /// so it never stays on the player's screen; produce the game drops where
    /// the player stands is moved to where the body stands.
    /// </summary>
    private bool NativeInteract(NativeCompanion actor, BodyTaskRunner active, GameLocation location, Point tile)
    {
        var vector = new Vector2(tile.X, tile.Y);
        var avatar = actor.Avatar;
        var hasObject = location.objects.TryGetValue(vector, out var obj);
        var hasFeature = location.terrainFeatures.TryGetValue(vector, out var feature);
        if (!hasObject && !hasFeature) return false;
        var menuBefore = Game1.activeClickableMenu;
        var spill = Game1.currentLocation;
        var spillBefore = spill?.debris.Count ?? 0;
        var playerAt = (Game1.player.currentLocation, Game1.player.TilePoint);
        string kind;
        string detail;
        if (hasObject)
        {
            var name = obj!.DisplayName;
            var held = avatar.CurrentItem;
            var heldStack = held?.Stack ?? 0;
            if (held is not null && obj.performObjectDropInAction(held, false, avatar))
            {
                // Some machines take their input from the stack themselves; for the
                // rest the caller takes one, as the farmer's action button does.
                if (held.Stack == heldStack) avatar.reduceActiveItemByOne();
                else if (held.Stack <= 0) avatar.Items[avatar.CurrentToolIndex] = null;
                (kind, detail) = ("dropped-in", $"{held.DisplayName} into {name} at {tile.X},{tile.Y}");
            }
            else if (obj.checkForAction(avatar))
            {
                (kind, detail) = ("interacted", $"{name} at {tile.X},{tile.Y}");
            }
            else
            {
                (kind, detail) = ("no-response", $"{name} at {tile.X},{tile.Y} did nothing");
            }
        }
        else if (feature!.performUseAction(vector))
        {
            (kind, detail) = ("interacted", $"{feature.GetType().Name} at {tile.X},{tile.Y}");
        }
        else
        {
            return false;
        }
        if (spill is not null && !ReferenceEquals(spill, location))
        {
            for (var i = spillBefore; i < spill.debris.Count; i++) location.debris.Add(spill.debris[i]);
            while (spill.debris.Count > spillBefore) spill.debris.RemoveAt(spill.debris.Count - 1);
        }
        active.Note(Game1.ticks, kind, detail);
        this.CaptureMenu(actor, active, location, tile, menuBefore);
        if (!ReferenceEquals(Game1.player.currentLocation, playerAt.currentLocation) || Game1.player.TilePoint != playerAt.TilePoint || Game1.locationRequest is not null)
        {
            active.Note(Game1.ticks, "player-affected", "the game's interaction moved or warped the player, not the body");
        }
        return true;
    }

    /// <summary>A menu the game opened for the body's interaction: read it, then close it.</summary>
    private void CaptureMenu(NativeCompanion actor, BodyTaskRunner active, GameLocation location, Point tile, StardewValley.Menus.IClickableMenu? before)
    {
        var menu = Game1.activeClickableMenu;
        if (menu is null || ReferenceEquals(menu, before)) return;
        switch (menu)
        {
            case StardewValley.Menus.ShopMenu shopMenu:
                this.shop = BodyShop.FromStock(location, tile, shopMenu.ShopId ?? "shop", shopMenu.itemPriceAndStock);
                active.Note(Game1.ticks, "menu-opened", $"{this.shop.ShopId}: {this.shop.CursorLine()}");
                break;
            case StardewValley.Menus.DialogueBox box:
                var text = box.getCurrentString() ?? "";
                active.Note(Game1.ticks, "dialogue", text.Length <= 300 ? text : text[..300]);
                break;
            default:
                active.Note(Game1.ticks, "menu-closed", $"the game opened a {menu.GetType().Name}, which this body cannot operate");
                break;
        }
        Game1.activeClickableMenu = before;
    }

    private void MoveCursor(int delta, BodyTaskRunner active)
    {
        if (this.shop is null)
        {
            active.Note(Game1.ticks, "no-menu", "no menu is open");
            return;
        }
        this.shop.Move(delta);
        active.Note(Game1.ticks, "cursor", this.shop.CursorLine());
    }

    private void Confirm(NativeCompanion actor, BodyTaskRunner active)
    {
        if (this.shop is null || !this.shop.StillAt(actor))
        {
            this.shop = null;
            active.Note(Game1.ticks, "no-menu", "no menu is open");
            return;
        }
        var (kind, detail) = this.shop.BuyOne(actor.Avatar);
        active.Note(Game1.ticks, kind, detail);
    }

    private void Drop(NativeCompanion actor, BodyTaskRunner active)
    {
        var avatar = actor.Avatar;
        var item = avatar.CurrentItem;
        if (item is null)
        {
            active.Note(Game1.ticks, "nothing-to-drop", "selected slot is empty");
            return;
        }
        avatar.Items[avatar.CurrentToolIndex] = null;
        var center = actor.GetBoundingBox().Center;
        var debris = Game1.createItemDebris(item, new Vector2(center.X, center.Y), actor.FacingDirection, actor.currentLocation);
        if (debris is not null) this.droppedByBody[debris] = Game1.ticks;
        active.Note(Game1.ticks, "dropped", $"{item.Stack} x {item.DisplayName}");
    }

    /// <summary>Items lying within reach fly to the body, as they do to a farmer.</summary>
    private void PickUpNearby(NativeCompanion actor)
    {
        var location = actor.currentLocation;
        if (location is null || location.debris.Count == 0) return;
        var center = actor.GetBoundingBox().Center.ToVector2();
        foreach (var stale in this.droppedByBody.Where(pair => Game1.ticks - pair.Value > 600).Select(pair => pair.Key).ToList()) this.droppedByBody.Remove(stale);
        for (var i = location.debris.Count - 1; i >= 0; i--)
        {
            var debris = location.debris[i];
            if (this.droppedByBody.ContainsKey(debris) || debris.Chunks.Count == 0) continue;
            if (Vector2.Distance(debris.Chunks[0].position.Value, center) > 80) continue;
            var item = debris.item ?? (string.IsNullOrEmpty(debris.itemId.Value) ? null : ItemRegistry.Create(debris.itemId.Value, debris.Chunks.Count, debris.itemQuality));
            if (item is null) continue;
            var offered = item.Stack;
            // The inventory may hand back the same item with a zero stack: that is nothing left over.
            var leftover = actor.Avatar.addItemToInventory(item) is { Stack: > 0 } rest ? rest : null;
            var taken = offered - (leftover?.Stack ?? 0);
            if (taken <= 0) continue;
            location.debris.RemoveAt(i);
            location.playSound("coin");
            this.runner?.Note(Game1.ticks, "picked-up", $"{taken} x {item.DisplayName}");
            if (leftover is not null) Game1.createItemDebris(leftover, center, actor.FacingDirection, location);
        }
    }

    private void WriteState(NativeCompanion? actor, bool paused)
    {
        this.forceState = false;
        if (this.files is null) return;
        try
        {
            if (this.shop is not null && (actor is null || !this.shop.StillAt(actor))) this.shop = null;
            var state = this.exporter.BuildState(actor, paused, this.runner is { IsTerminal: false } r ? r.Task.Seq : null, this.shop?.ToWire());
            this.files.WriteState(state);
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body state export failed: {ex.Message}", LogLevel.Warn);
        }
    }

    private void WriteStatus()
    {
        if (this.files is null || this.runner is null) return;
        try
        {
            this.files.WriteStatus(this.runner.ToStatus(this.exporter.Revision, DecisionBridgeRules.TimestampNow()));
            this.lastStatusUpdate = this.runner.Update;
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 body status write failed: {ex.Message}", LogLevel.Warn);
        }
    }

    private void PollSpeech()
    {
        if (this.files is null) return;
        try
        {
            foreach (var line in this.files.TakeSpeech()) this.speak(line.Text);
        }
        catch (Exception ex)
        {
            this.monitor.Log($"Player2 speech lane failed: {ex.Message}", LogLevel.Warn);
        }
    }

    private static int CountItem(Farmer farmer, string id)
    {
        return farmer.Items.Where(item => item is not null && (item.ItemId == id || item.QualifiedItemId == id)).Sum(item => item!.Stack);
    }

    private static string ItemName(string id)
    {
        return ItemRegistry.GetDataOrErrorItem(id.StartsWith('(') ? id : "(O)" + id).DisplayName;
    }
}
