using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using DSHPlayer2.Core;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewValley;
using StardewValley.Menus;
using StardewValley.Monsters;
using StardewValley.TerrainFeatures;
using StardewValley.Tools;

namespace DSHPlayer2.Stardew;

/// <summary>
/// Exports Stardew state as the game holds it (P2-0021 T21.1, S12), as seen
/// from the companion's own seat (P2-0022). It projects; it never infers a
/// task, a plan, or what anything is "for".
/// </summary>
internal sealed class BodyStateExporter
{
    public const int MaxObjects = 1500;

    public static readonly BodyStateField[] Fields =
    {
        new("revision", "Grows with every write; a task status names the state revision it was written after."),
        new("paused", "True while game time does not pass (menu, chat, cutscene): held input does not advance."),
        new("time", "day (total days since the save began, 1-based), season, dayOfMonth, year, timeOfDay (600 = 6:00, 2600 = 2:00 next morning), weather."),
        new("player", "The human farmer (the host): location, tile x/y, pixel px/py, facing, money, health, stamina, inventory."),
        new("body", "Your own farmer: location, tile, facing, whether it is moving, selected toolbar slot (0-based), health, stamina, gold (one purse shared with the player unless the farm splits wallets), inventory, running task seq, and menu: the menu open on your screen (kind, focus = what the controller cursor is on, options = its buttons, money, and a shop's stock with index, name, price, stock), when any."),
        new("map", "The body's current location: width, height, and rows of legend characters, row 0 at the top (north); x grows east, y grows south."),
        new("objects", "Things on tiles, nearest first: object (stones, weeds, twigs, artifact spots, machines), forage, dirt (tilled soil; extra.crop, extra.ready, extra.watered), tree, grass, clump (stumps, logs, boulders), bush, item (lying on the ground), blocker (a story blocker the map only shows as '#', such as the landslide before the mines; extra.note says what the game says about it). extra.width/height give a footprint of more than one tile. extra.passable says whether a body can walk through."),
        new("characters", "NPCs, monsters (with health), farmers, in the body's location."),
        new("warps", "Exits of the body's location: kind walk (step onto the tile, often just past the map edge) or action (face it and press Action)."),
        new("actionTiles", "Tiles of this location the game itself answers, as raw data: position, map layer, and the tile's raw Action/TouchAction string from the map (or sheet#index on mine floors, where code answers by tile). What an entry does is the game's to say; face it and press the action button, or walk onto a TouchAction."),
    };

    public static readonly IReadOnlyDictionary<string, string> Legend = new Dictionary<string, string>
    {
        ["."] = "walkable",
        [","] = "walkable ground a hoe can till",
        ["#"] = "blocked (wall, building, object, cliff, character)",
        ["~"] = "water (blocked; a watering can refills facing it)",
        ["W"] = "walk warp tile inside the map",
        ["D"] = "door or other action warp (blocked; face it and press the action button)",
    };

    private static readonly Dictionary<string, List<BodyWarp>> ActionWarpCache = new();
    private readonly IMonitor monitor;
    private readonly Stopwatch buildClock = new();
    private string? gridLocation;
    private char[][] grid = Array.Empty<char[]>();
    private Dictionary<(int, int), char> gridMarks = new();
    private int gridCursor;
    private double rowMsTotal;
    private long rowRefreshes;
    private long revision;
    private double buildMsTotal;
    private double gridMsTotal;
    private int gridBuilds;
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

    /// <summary>Seat screen: the companion's farmer is Game1.player there, the human is the host.</summary>
    public BodyState BuildState(Farmer actor, bool paused, int? activeTask, bool moving)
    {
        this.buildClock.Restart();
        var player = Game1.MasterPlayer;
        var location = actor.currentLocation;
        var origin = actor.Tile;
        var rows = this.Grid(location, actor);
        var objects = new List<(float Distance, BodyObject Value)>();
        foreach (var pair in location.objects.Pairs)
        {
            var o = pair.Value;
            var extra = new Dictionary<string, object?> { ["passable"] = o.isPassable(), ["category"] = o.Category, ["internalName"] = o.Name };
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
        foreach (var blocker in Blockers(location))
        {
            objects.Add((Vector2.Distance(new Vector2(blocker.X, blocker.Y), origin), blocker));
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
            characters.Add(new BodyCharacter(npc.TilePoint.X, npc.TilePoint.Y, npc.Position.X, npc.Position.Y, Clip(npc.displayName ?? npc.Name),
                npc is Monster ? "monster" : "npc", npc is Monster monster ? monster.Health : null));
        }
        foreach (var farmer in location.farmers)
        {
            if (ReferenceEquals(farmer, actor)) continue;
            characters.Add(new BodyCharacter(farmer.TilePoint.X, farmer.TilePoint.Y, farmer.Position.X, farmer.Position.Y, Clip(farmer.Name), "farmer", farmer.health));
        }
        var state = new BodyState(
            BodyChannel.ProtocolVersion,
            ++this.revision,
            BodyWire.Now(),
            Game1.ticks,
            paused,
            new BodyTime(Game1.Date.TotalDays + 1, Game1.currentSeason, Game1.dayOfMonth, Game1.year, Game1.timeOfDay,
                Game1.isRaining ? "rain" : Game1.isSnowing ? "snow" : Game1.isLightning ? "storm" : Game1.isDebrisWeather ? "wind" : "clear"),
            new BodyPlayerState(player.currentLocation?.NameOrUniqueName ?? "", player.TilePoint.X, player.TilePoint.Y, player.Position.X, player.Position.Y,
                Facing(player.FacingDirection), player.Name, player.Money, player.health, player.Stamina, Items(player.Items, 36)),
            new BodyActorState(location.NameOrUniqueName, actor.TilePoint.X, actor.TilePoint.Y, actor.Position.X, actor.Position.Y,
                Facing(actor.FacingDirection), true, moving, actor.CurrentToolIndex, actor.health, actor.Stamina, actor.Money, Items(actor.Items, 36), activeTask, Menu(Game1.activeClickableMenu, actor)),
            new BodyMap(location.NameOrUniqueName, location.Map.Layers[0].LayerWidth, location.Map.Layers[0].LayerHeight, rows),
            ordered.Take(MaxObjects).Select(entry => entry.Value).ToArray(),
            characters,
            Warps(location),
            new BodyTruncation(Math.Max(0, ordered.Count - MaxObjects)),
            ActionTiles(location));
        this.buildClock.Stop();
        this.Note(this.buildClock.Elapsed.TotalMilliseconds);
        return state;
    }

    public BodyWorld BuildWorld()
    {
        ResetCaches();
        var locations = new List<BodyWorldLocation>();
        // Building interiors (cabins, sheds) included: a farmer's own cabin is a place like any other.
        Utility.ForEachLocation(location =>
        {
            locations.Add(new BodyWorldLocation(location.NameOrUniqueName, Clip(location.DisplayName ?? location.NameOrUniqueName), location.IsOutdoors, Warps(location)));
            return true;
        });
        return new BodyWorld(BodyChannel.ProtocolVersion, BodyWire.Now(), locations);
    }

    /// <summary>The door or other action warp on one tile, if any.</summary>
    public static BodyWarp? ActionWarpAt(GameLocation location, int x, int y)
    {
        return ActionWarps(location).FirstOrDefault(warp => warp.X == x && warp.Y == y)
            ?? location.buildings.Select(BuildingDoor).FirstOrDefault(door => door is not null && door.X == x && door.Y == y);
    }

    /// <summary>
    /// A finished building's human door (the farmhouse, sheds, cabins), where
    /// the action button takes a farmer to the interior's first warp, one tile in.
    /// </summary>
    private static BodyWarp? BuildingDoor(StardewValley.Buildings.Building building)
    {
        if (building.daysOfConstructionLeft.Value > 0 || building.humanDoor.X < 0) return null;
        // The engine's door gate (OnUseHumanDoor), without its dialogue on the player's screen.
        if (building is StardewValley.Buildings.GreenhouseBuilding && !Game1.MasterPlayer.mailReceived.Contains("ccPantry")) return null;
        if (building.GetIndoors() is not { } indoors || indoors.warps.Count == 0) return null;
        return new BodyWarp(building.tileX.Value + building.humanDoor.X, building.tileY.Value + building.humanDoor.Y,
            indoors.NameOrUniqueName, indoors.warps[0].X, indoors.warps[0].Y - 1, "action");
    }

    private static List<BodyWarp> Warps(GameLocation location)
    {
        var warps = location.warps.Where(w => !w.npcOnly.Value).Select(w => new BodyWarp(w.X, w.Y, w.TargetName, w.TargetX, w.TargetY, "walk")).ToList();
        warps.AddRange(ActionWarps(location));
        warps.AddRange(TouchWarps(location));
        foreach (var building in location.buildings)
        {
            if (BuildingDoor(building) is { } door) warps.Add(door);
        }
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

    /// <summary>
    /// Tiles that warp a farmer who walks onto them (`TouchAction Warp x y Location`
    /// on the Back layer), such as the mine's shaft hole: raw map data the export
    /// would otherwise hide, because they are not in <see cref="GameLocation.warps"/>.
    /// </summary>
    private static List<BodyWarp> TouchWarps(GameLocation location)
    {
        var key = location.NameOrUniqueName + "#touch";
        if (ActionWarpCache.TryGetValue(key, out var cached)) return cached;
        var found = new List<BodyWarp>();
        var layer = location.Map.GetLayer("Back");
        if (layer is not null)
        {
            for (var y = 0; y < layer.LayerHeight; y++)
            {
                for (var x = 0; x < layer.LayerWidth; x++)
                {
                    var touch = location.doesTileHaveProperty(x, y, "TouchAction", "Back");
                    if (string.IsNullOrWhiteSpace(touch)) continue;
                    var parts = touch.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 4 && parts[0] == "Warp" && int.TryParse(parts[1], out var tx) && int.TryParse(parts[2], out var ty))
                        found.Add(new BodyWarp(x, y, parts[3], tx, ty, "walk"));
                }
            }
        }
        ActionWarpCache[key] = found;
        return found;
    }

    /// <summary>
    /// Tiles the game itself answers, as raw data the warp export never showed:
    /// every tile with a raw <c>Action</c> or <c>TouchAction</c> property (the
    /// mine's entry map answers "Mine", "MineElevator", "MinecartTransport"),
    /// plus — on mine floors, where the answers live in code and the ladder is
    /// written into the layer at runtime — the elevator, exit, ladder and shaft
    /// tiles as their raw tilesheet#index. No meaning attached.
    /// </summary>
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<xTile.Map, List<BodyActionTile>> ActionTileCache = new();

    private static List<BodyActionTile> ActionTiles(GameLocation location)
    {
        var map = location.Map;
        if (ActionTileCache.TryGetValue(map, out var cached)) return cached;
        var found = new List<BodyActionTile>();
        void Scan(xTile.Layers.Layer? layer, string layerName)
        {
            if (layer is null) return;
            for (var y = 0; y < layer.LayerHeight; y++)
            {
                for (var x = 0; x < layer.LayerWidth; x++)
                {
                    if (found.Count >= 96) return;
                    var tile = layer.Tiles[x, y];
                    if (tile is null) continue;
                    var raw = ReadProperty(location, x, y, layerName, "Action") ?? ReadProperty(location, x, y, layerName, "TouchAction");
                    if (!string.IsNullOrWhiteSpace(raw))
                    {
                        found.Add(new BodyActionTile(x, y, layerName, raw.Trim()));
                        continue;
                    }
                    if (location is StardewValley.Locations.MineShaft && tile.TileSheet.Id == "mine"
                        && (tile.TileIndex == 112 || tile.TileIndex == 115 || tile.TileIndex == 173 || tile.TileIndex == 174))
                    {
                        found.Add(new BodyActionTile(x, y, layerName, $"mine#{tile.TileIndex}"));
                    }
                }
            }
        }
        Scan(map.GetLayer("Back"), "Back");
        Scan(map.GetLayer("Buildings"), "Buildings");
        ActionTileCache.AddOrUpdate(map, found);
        return found;
    }

    /// <summary>The raw value of one tile property, through the location's own answer.</summary>
    private static string? ReadProperty(GameLocation location, int x, int y, string layer, string property)
    {
        try
        {
            return location.doesTileHaveProperty(x, y, property, layer);
        }
        catch (Exception)
        {
            return null;
        }
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

    /// <summary>
    /// The body's location as legend rows. A full build (every tile through
    /// the engine's collision) costs ~10 µs a tile, over 100 ms for Town, so
    /// it runs only when the location changes; afterwards <see cref="RefreshRow"/>
    /// re-checks one row per tick and <see cref="InvalidateAround"/> re-checks
    /// the tiles a button press touched at once.
    /// </summary>
    private string[] Grid(GameLocation location, Farmer actor)
    {
        if (location.NameOrUniqueName != this.gridLocation)
        {
            var started = this.buildClock.Elapsed.TotalMilliseconds;
            var width = location.Map.Layers[0].LayerWidth;
            var height = location.Map.Layers[0].LayerHeight;
            this.gridMarks = new Dictionary<(int, int), char>();
            foreach (var warp in Warps(location))
            {
                if (warp.X >= 0 && warp.Y >= 0 && warp.X < width && warp.Y < height) this.gridMarks[(warp.X, warp.Y)] = warp.Kind == "walk" ? 'W' : 'D';
            }
            this.grid = new char[height][];
            for (var y = 0; y < height; y++)
            {
                this.grid[y] = new char[width];
                for (var x = 0; x < width; x++) this.grid[y][x] = this.Cell(location, x, y, actor);
            }
            this.gridLocation = location.NameOrUniqueName;
            this.gridCursor = 0;
            this.gridMsTotal += this.buildClock.Elapsed.TotalMilliseconds - started;
            this.gridBuilds++;
        }
        return this.grid.Select(row => new string(row)).ToArray();
    }

    /// <summary>Re-checks one row of the cached grid (called every unpaused tick).</summary>
    public void RefreshRow(Farmer actor)
    {
        var location = actor.currentLocation;
        if (location is null || location.NameOrUniqueName != this.gridLocation || this.grid.Length == 0) return;
        var started = Stopwatch.GetTimestamp();
        var y = this.gridCursor++ % this.grid.Length;
        for (var x = 0; x < this.grid[y].Length; x++) this.grid[y][x] = this.Cell(location, x, y, actor);
        this.rowMsTotal += (Stopwatch.GetTimestamp() - started) * 1000d / Stopwatch.Frequency;
        this.rowRefreshes++;
    }

    /// <summary>The grid uses the same collision the farmer walks with.</summary>
    private char Cell(GameLocation location, int x, int y, Farmer actor)
    {
        if (this.gridMarks.TryGetValue((x, y), out var mark)) return mark;
        if (location.isWaterTile(x, y)) return '~';
        if (location.isCollidingPosition(new Rectangle(x * 64 + 8, y * 64 + 16, 48, 32), Game1.viewport, true, 0, false, actor)) return '#';
        return location.doesTileHaveProperty(x, y, "Diggable", "Back") is not null ? ',' : '.';
    }

    /// <summary>Forces a full grid build on the next state (new day, new save).</summary>
    public void InvalidateGrid() => this.gridLocation = null;

    private static BodyObject Feature(int x, int y, TerrainFeature feature, Farmer actor)
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

    /// <summary>The menu on the seat's screen as the game holds it; a shop also lists its stock.</summary>
    private static BodyMenu? Menu(IClickableMenu? menu, Farmer actor)
    {
        if (menu is null) return null;
        var page = menu is GameMenu game ? game.GetCurrentPage() : menu; // the game menu's cursor lives on its open tab
        var focus = page.currentlySnappedComponent;
        var options = (page.allClickableComponents ?? new List<ClickableComponent>())
            .Where(c => c.visible).Select(Label).Where(label => label != "?").Distinct().Take(60).ToList();
        List<BodyMenuItem>? stock = null;
        string? focused = focus is null ? null : Label(focus);
        if (menu is DialogueBox { isQuestion: true } box)
        {
            // Its answers are unnamed components: the question's own responses, and the one the cursor is on.
            options = box.responses.Select(response => Clip(response.responseText)).ToList();
            focused = box.selectedResponse >= 0 && box.selectedResponse < options.Count ? options[box.selectedResponse] : null;
        }
        if (menu is ShopMenu shop)
        {
            stock = shop.forSale.Take(200).Select((item, index) => new BodyMenuItem(index, item.QualifiedItemId ?? "", Clip(item.DisplayName),
                shop.itemPriceAndStock.TryGetValue(item, out var info) ? info.Price : 0,
                shop.itemPriceAndStock.TryGetValue(item, out var left) && left.Stock != int.MaxValue ? left.Stock : null)).ToList();
            var row = focus is null ? -1 : shop.forSaleButtons.IndexOf(focus);
            if (row >= 0 && shop.currentItemIndex + row < shop.forSale.Count) focused = $"#{shop.currentItemIndex + row} {Clip(shop.forSale[shop.currentItemIndex + row].DisplayName)}";
        }
        if (page is InventoryPage inventory && focus is not null && inventory.inventory.inventory.IndexOf(focus) is >= 0 and var slot)
            focused = $"slot {slot + 1}: {(actor.Items[slot] is { } item ? Clip(item.DisplayName) : "empty")}";
        if (actor.CursorSlotItem is { } held) focused = $"{focused ?? "nothing"}, holding {Clip(held.DisplayName)}";
        return new BodyMenu(menu.GetType().Name, focused, options, actor.Money, stock);
    }

    private static string Label(ClickableComponent component) => Clip(string.IsNullOrWhiteSpace(component.label) ? component.name : component.label);

    private static string Facing(int direction) => direction switch { 0 => "up", 1 => "right", 2 => "down", _ => "left" };

    /// <summary>
    /// Story blockers a location keeps outside its object lists, so the grid
    /// shows only '#' there: the landslide before the mines, the boulder on the
    /// railroad path, the big log at the Secret Woods. Read by field name, as
    /// the game holds them; a field this game version lacks is skipped.
    /// </summary>
    internal static IEnumerable<BodyObject> Blockers(GameLocation location)
    {
        var found = new List<BodyObject>();
        if (location is StardewValley.Locations.Mountain mountain)
        {
            if (Member(mountain, "landslide") is Netcode.NetBool { Value: true } && Member(mountain, "landSlideRect") is Rectangle slide)
                found.Add(Blocker(slide, "Landslide", "fallen rocks over the way to the mines; the game clears them itself on Spring 5 of year 1"));
            if (Member(mountain, "railroadAreaBlocked") is true && Member(mountain, "railroadBlockRect") is Rectangle rail)
                found.Add(Blocker(rail, "Boulder on the railroad path", "the game clears it itself with an earthquake on Summer 3 of year 1"));
        }
        if (location is StardewValley.Locations.Forest forest)
        {
            var log = Member(forest, "log") switch
            {
                ResourceClump clump => clump,
                Netcode.NetRef<ResourceClump> net => net.Value,
                _ => null,
            };
            if (log is not null && !location.resourceClumps.Contains(log))
                found.Add(new BodyObject((int)log.Tile.X, (int)log.Tile.Y, "blocker", "Large Log", log.parentSheetIndex.Value.ToString(),
                    new Dictionary<string, object?> { ["passable"] = false, ["width"] = log.width.Value, ["height"] = log.height.Value, ["health"] = log.health.Value,
                        ["note"] = "blocks the way to the Secret Woods; a steel axe or better breaks it" }));
        }
        return found;
    }

    private static BodyObject Blocker(Rectangle pixels, string name, string note) =>
        new(pixels.X / 64, pixels.Y / 64, "blocker", name, null, new Dictionary<string, object?>
        {
            ["passable"] = false,
            ["width"] = Math.Max(1, pixels.Width / 64),
            ["height"] = Math.Max(1, pixels.Height / 64),
            ["note"] = note,
        });

    private static object? Member(object owner, string name)
    {
        const System.Reflection.BindingFlags flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic;
        var type = owner.GetType();
        return type.GetField(name, flags)?.GetValue(owner) ?? type.GetProperty(name, flags)?.GetValue(owner);
    }

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
            this.monitor.Log($"Player2 body state export: {this.builds} builds, mean {this.buildMsTotal / this.builds:0.00} ms; full grid built {this.gridBuilds} times, mean {(this.gridBuilds == 0 ? 0 : this.gridMsTotal / this.gridBuilds):0.00} ms; per-tick row refresh mean {(this.rowRefreshes == 0 ? 0 : this.rowMsTotal / this.rowRefreshes):0.000} ms.", LogLevel.Info);
        }
    }
}
