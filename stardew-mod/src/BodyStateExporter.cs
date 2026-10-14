using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using DSHPlayer2.Core;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewValley;
using StardewValley.Monsters;
using StardewValley.TerrainFeatures;
using StardewValley.Tools;

namespace DSHPlayer2.Stardew;

/// <summary>
/// Exports Stardew state as the game holds it (P2-0021 T21.1, S12). It
/// projects; it never infers a task, a plan, or what anything is "for".
/// </summary>
internal sealed class BodyStateExporter
{
    public const int MaxObjects = 1500;
    private const int GridCacheTicks = 120;

    public static readonly BodyStateField[] Fields =
    {
        new("revision", "Grows with every write; a task status names the state revision it was written after."),
        new("paused", "True while game time does not pass (menu, chat, cutscene): held input does not advance."),
        new("time", "day (total days since the save began, 1-based), season, dayOfMonth, year, timeOfDay (600 = 6:00, 2600 = 2:00 next morning), weather."),
        new("player", "The human farmer: location, tile x/y, pixel px/py, facing, money (shared farm gold), health, stamina, inventory."),
        new("body", "The companion's body: location, tile, facing, whether it is moving, selected toolbar slot (0-based), stamina, inventory, running task seq."),
        new("map", "The body's current location: width, height, and rows of legend characters, row 0 at the top (north); x grows east, y grows south."),
        new("objects", "Things on tiles, nearest first: object (stones, weeds, twigs, artifact spots, machines), forage, dirt (tilled soil; extra.crop, extra.ready, extra.watered), tree, grass, clump (stumps, logs, boulders), bush, item (lying on the ground). extra.passable says whether a body can walk through."),
        new("characters", "NPCs, monsters (with health), farmers, in the body's location."),
        new("warps", "Exits of the body's location: kind walk (step onto the tile, often just past the map edge) or action (face it and press Action)."),
    };

    public static readonly IReadOnlyDictionary<string, string> Legend = new Dictionary<string, string>
    {
        ["."] = "walkable",
        ["#"] = "blocked (wall, building, object, cliff, character)",
        ["~"] = "water (blocked; a watering can refills facing it)",
        ["W"] = "walk warp tile inside the map",
        ["D"] = "door or other action warp (blocked; face it and press Action)",
    };

    private static readonly Dictionary<string, List<BodyWarp>> ActionWarpCache = new();
    private readonly IMonitor monitor;
    private readonly Stopwatch buildClock = new();
    private string? gridLocation;
    private int gridTick = -GridCacheTicks;
    private string[] gridRows = Array.Empty<string>();
    private long revision;
    private double buildMsTotal;
    private int builds;

    public BodyStateExporter(IMonitor monitor)
    {
        this.monitor = monitor;
    }

    public long Revision => this.revision;

    /// <summary>Clears cached grids and door lists (new day, new save).</summary>
    public static void ResetCaches()
    {
        ActionWarpCache.Clear();
    }

    public BodyState BuildState(NativeCompanion? actor, bool paused, int? activeTask)
    {
        this.buildClock.Restart();
        var player = Game1.player;
        var location = actor?.currentLocation ?? Game1.currentLocation;
        var origin = actor?.Tile ?? player.Tile;
        var rows = this.Grid(location, actor);
        var objects = new List<(float Distance, BodyObject Value)>();
        foreach (var pair in location.objects.Pairs)
        {
            var o = pair.Value;
            var extra = new Dictionary<string, object?> { ["passable"] = o.isPassable(), ["category"] = o.Category };
            if (o.readyForHarvest.Value) extra["ready"] = true;
            if (o.heldObject.Value is { } held) extra["holding"] = held.DisplayName;
            if (o.MinutesUntilReady > 0) extra["minutesUntilReady"] = o.MinutesUntilReady;
            objects.Add((Vector2.Distance(pair.Key, origin), new BodyObject((int)pair.Key.X, (int)pair.Key.Y,
                o.IsSpawnedObject ? "forage" : o.bigCraftable.Value ? "machine" : "object", Clip(o.DisplayName), o.QualifiedItemId, extra)));
        }
        foreach (var pair in location.terrainFeatures.Pairs)
        {
            objects.Add((Vector2.Distance(pair.Key, origin), Feature((int)pair.Key.X, (int)pair.Key.Y, pair.Value, actor)));
        }
        foreach (var clump in location.resourceClumps)
        {
            objects.Add((Vector2.Distance(clump.Tile, origin), new BodyObject((int)clump.Tile.X, (int)clump.Tile.Y, "clump", ClumpName(clump.parentSheetIndex.Value), clump.parentSheetIndex.Value.ToString(),
                new Dictionary<string, object?> { ["passable"] = false, ["width"] = clump.width.Value, ["height"] = clump.height.Value, ["health"] = clump.health.Value })));
        }
        foreach (var feature in location.largeTerrainFeatures)
        {
            var tile = feature.Tile;
            objects.Add((Vector2.Distance(tile, origin), new BodyObject((int)tile.X, (int)tile.Y, feature is Bush ? "bush" : "large-feature", feature.GetType().Name, null,
                new Dictionary<string, object?> { ["passable"] = feature.isPassable(actor) })));
        }
        foreach (var debris in location.debris)
        {
            if (debris.Chunks.Count == 0) continue;
            var item = debris.item;
            var id = item?.QualifiedItemId ?? debris.itemId.Value;
            if (string.IsNullOrEmpty(id)) continue;
            var position = debris.Chunks[0].position.Value / 64f;
            objects.Add((Vector2.Distance(position, origin), new BodyObject((int)position.X, (int)position.Y, "item",
                Clip(item?.DisplayName ?? ItemRegistry.GetDataOrErrorItem(id).DisplayName), id,
                new Dictionary<string, object?> { ["count"] = item?.Stack ?? debris.Chunks.Count, ["passable"] = true })));
        }
        var ordered = objects.OrderBy(entry => entry.Distance).ToList();
        var characters = new List<BodyCharacter>();
        foreach (var npc in location.characters)
        {
            if (ReferenceEquals(npc, actor)) continue;
            characters.Add(new BodyCharacter(npc.TilePoint.X, npc.TilePoint.Y, npc.Position.X, npc.Position.Y, Clip(npc.displayName ?? npc.Name),
                npc is Monster ? "monster" : "npc", npc is Monster monster ? monster.Health : null));
        }
        foreach (var farmer in location.farmers)
        {
            characters.Add(new BodyCharacter(farmer.TilePoint.X, farmer.TilePoint.Y, farmer.Position.X, farmer.Position.Y, Clip(farmer.Name), "farmer", farmer.health));
        }
        var state = new BodyState(
            BodyBridgeFiles.ProtocolVersion,
            ++this.revision,
            DecisionBridgeRules.TimestampNow(),
            Game1.ticks,
            paused,
            new BodyTime(Game1.Date.TotalDays + 1, Game1.currentSeason, Game1.dayOfMonth, Game1.year, Game1.timeOfDay,
                Game1.isRaining ? "rain" : Game1.isSnowing ? "snow" : Game1.isLightning ? "storm" : Game1.isDebrisWeather ? "wind" : "clear"),
            new BodyPlayerState(player.currentLocation?.NameOrUniqueName ?? "", player.TilePoint.X, player.TilePoint.Y, player.Position.X, player.Position.Y,
                Facing(player.FacingDirection), player.Name, player.Money, player.health, player.Stamina, Items(player.Items, 36)),
            actor is null ? null : new BodyActorState(actor.currentLocation?.NameOrUniqueName ?? "", actor.TilePoint.X, actor.TilePoint.Y, actor.Position.X, actor.Position.Y,
                Facing(actor.FacingDirection), actor.currentLocation is not null, actor.MovementState is "input" or "walking" or "following",
                actor.Avatar.CurrentToolIndex, actor.Avatar.Stamina, Items(actor.Avatar.Items, 36), activeTask),
            new BodyMap(location.NameOrUniqueName, location.Map.Layers[0].LayerWidth, location.Map.Layers[0].LayerHeight, rows),
            ordered.Take(MaxObjects).Select(entry => entry.Value).ToArray(),
            characters,
            Warps(location),
            new BodyTruncation(Math.Max(0, ordered.Count - MaxObjects)));
        this.buildClock.Stop();
        this.Note(this.buildClock.Elapsed.TotalMilliseconds);
        return state;
    }

    public BodyWorld BuildWorld()
    {
        ResetCaches();
        var locations = new List<BodyWorldLocation>();
        foreach (var location in Game1.locations)
        {
            locations.Add(new BodyWorldLocation(location.NameOrUniqueName, Clip(location.DisplayName ?? location.NameOrUniqueName), location.IsOutdoors, Warps(location)));
        }
        return new BodyWorld(BodyBridgeFiles.ProtocolVersion, DecisionBridgeRules.TimestampNow(), locations);
    }

    /// <summary>The door or other action warp on one tile, if any.</summary>
    public static BodyWarp? ActionWarpAt(GameLocation location, int x, int y)
    {
        return ActionWarps(location).FirstOrDefault(warp => warp.X == x && warp.Y == y);
    }

    private static List<BodyWarp> Warps(GameLocation location)
    {
        var warps = location.warps.Select(w => new BodyWarp(w.X, w.Y, w.TargetName, w.TargetX, w.TargetY, "walk")).ToList();
        warps.AddRange(ActionWarps(location));
        return warps;
    }

    private static List<BodyWarp> ActionWarps(GameLocation location)
    {
        var key = location.NameOrUniqueName;
        if (ActionWarpCache.TryGetValue(key, out var cached)) return cached;
        var found = new List<BodyWarp>();
        var layer = location.Map.GetLayer("Buildings");
        if (layer is not null)
        {
            for (var y = 0; y < layer.LayerHeight; y++)
            {
                for (var x = 0; x < layer.LayerWidth; x++)
                {
                    var action = location.doesTileHaveProperty(x, y, "Action", "Buildings");
                    if (string.IsNullOrWhiteSpace(action)) continue;
                    if (ParseActionWarp(action) is { } warp) found.Add(new BodyWarp(x, y, warp.To, warp.X, warp.Y, "action"));
                }
            }
        }
        ActionWarpCache[key] = found;
        return found;
    }

    /// <summary>`Warp x y Location`, `LockedDoorWarp x y Location open close ...`, `MagicWarp Location x y`.</summary>
    internal static (string To, int X, int Y)? ParseActionWarp(string action)
    {
        var parts = action.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 4 && parts[0] is "Warp" or "LockedDoorWarp" && int.TryParse(parts[1], out var x) && int.TryParse(parts[2], out var y))
            return (parts[3], x, y);
        if (parts.Length >= 4 && parts[0] == "MagicWarp" && int.TryParse(parts[2], out var mx) && int.TryParse(parts[3], out var my))
            return (parts[1], mx, my);
        return null;
    }

    private string[] Grid(GameLocation location, NativeCompanion? actor)
    {
        var key = location.NameOrUniqueName;
        if (key == this.gridLocation && Game1.ticks - this.gridTick < GridCacheTicks) return this.gridRows;
        var width = location.Map.Layers[0].LayerWidth;
        var height = location.Map.Layers[0].LayerHeight;
        var marks = new Dictionary<(int, int), char>();
        foreach (var warp in Warps(location))
        {
            if (warp.X >= 0 && warp.Y >= 0 && warp.X < width && warp.Y < height) marks[(warp.X, warp.Y)] = warp.Kind == "walk" ? 'W' : 'D';
        }
        var rows = new string[height];
        var builder = new StringBuilder(width);
        for (var y = 0; y < height; y++)
        {
            builder.Clear();
            for (var x = 0; x < width; x++)
            {
                if (marks.TryGetValue((x, y), out var mark)) builder.Append(mark);
                else if (location.isWaterTile(x, y)) builder.Append('~');
                else if (location.isCollidingPosition(new Rectangle(x * 64 + 8, y * 64 + 16, 48, 32), Game1.viewport, false, 0, false, actor)) builder.Append('#');
                else builder.Append('.');
            }
            rows[y] = builder.ToString();
        }
        this.gridLocation = key;
        this.gridTick = Game1.ticks;
        this.gridRows = rows;
        return rows;
    }

    /// <summary>Forces the next state to rebuild the tile grid (after an action changed the world).</summary>
    public void InvalidateGrid() => this.gridTick = -GridCacheTicks;

    private static BodyObject Feature(int x, int y, TerrainFeature feature, NativeCompanion? actor)
    {
        var extra = new Dictionary<string, object?> { ["passable"] = feature.isPassable(actor) };
        switch (feature)
        {
            case HoeDirt dirt:
                extra["watered"] = dirt.state.Value == HoeDirt.watered;
                if (dirt.fertilizer.Value is { Length: > 0 } fertilizer) extra["fertilizer"] = fertilizer;
                if (dirt.crop is { } crop)
                {
                    extra["crop"] = Clip(ItemRegistry.GetDataOrErrorItem("(O)" + crop.indexOfHarvest.Value).DisplayName);
                    extra["seed"] = crop.netSeedIndex.Value;
                    extra["phase"] = crop.currentPhase.Value;
                    extra["phases"] = crop.phaseDays.Count;
                    extra["ready"] = dirt.readyForHarvest();
                    extra["dead"] = crop.dead.Value;
                    extra["regrows"] = crop.RegrowsAfterHarvest();
                }
                return new BodyObject(x, y, "dirt", dirt.crop is null ? "Tilled Soil" : "Crop", null, extra);
            case Tree tree:
                extra["stage"] = tree.growthStage.Value;
                extra["stump"] = tree.stump.Value;
                extra["type"] = tree.treeType.Value;
                return new BodyObject(x, y, "tree", "Tree", tree.treeType.Value, extra);
            case FruitTree fruit:
                extra["stage"] = fruit.growthStage.Value;
                extra["fruit"] = fruit.fruit.Count;
                return new BodyObject(x, y, "fruit-tree", "Fruit Tree", fruit.treeId.Value, extra);
            case Grass:
                return new BodyObject(x, y, "grass", "Grass", null, extra);
            case Flooring:
                return new BodyObject(x, y, "floor", "Flooring", null, extra);
            default:
                return new BodyObject(x, y, "feature", feature.GetType().Name, null, extra);
        }
    }

    private static List<BodyItem> Items(IList<Item?> items, int max)
    {
        var result = new List<BodyItem>();
        for (var slot = 0; slot < items.Count && slot < max; slot++)
        {
            if (items[slot] is not { } item) continue;
            Dictionary<string, object?>? extra = null;
            if (item is WateringCan can) extra = new() { ["waterLeft"] = can.WaterLeft, ["capacity"] = can.waterCanMax };
            else if (item is Tool tool) extra = new() { ["upgrade"] = tool.UpgradeLevel };
            result.Add(new BodyItem(slot, item.QualifiedItemId, Clip(item.DisplayName), item.Stack, item.getCategoryName() is { Length: > 0 } category ? category : item.TypeDefinitionId, extra));
        }
        return result;
    }

    private static string Facing(int direction) => direction switch { 0 => "up", 1 => "right", 2 => "down", _ => "left" };

    private static string ClumpName(int index) => index switch
    {
        600 => "Large Stump",
        602 => "Large Log",
        672 => "Boulder",
        622 => "Meteorite",
        _ => $"Clump {index}",
    };

    private static string Clip(string? value)
    {
        var text = string.IsNullOrWhiteSpace(value) ? "?" : value.Trim();
        return text.Length > 80 ? text[..80] : text;
    }

    private void Note(double ms)
    {
        this.buildMsTotal += ms;
        if (++this.builds % 600 == 0)
        {
            // S12 evidence: the cost of exporting raw state, logged in batches.
            this.monitor.Log($"Player2 body state export: {this.builds} builds, mean {this.buildMsTotal / this.builds:0.00} ms.", LogLevel.Info);
        }
    }
}
