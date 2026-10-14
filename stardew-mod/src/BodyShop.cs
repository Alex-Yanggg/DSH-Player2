using System;
using System.Collections.Generic;
using System.Linq;
using DSHPlayer2.Core;
using Microsoft.Xna.Framework;
using StardewValley;
using StardewValley.Internal;
using StardewValley.Menus;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The shop counter as the body sees it (P2-0021). Pressing Action at a
/// counter opens the game's own shop stock for the body instead of a menu on
/// the player's screen; the stock is exported raw (names, prices, stock) and
/// the menu buttons move a cursor and confirm one unit. The adapter does not
/// pick, compare, or decide; it only does what the counter does for a farmer.
/// Purchases are paid from the player's wallet, because the body has none.
/// </summary>
internal sealed class BodyShop
{
    private const int MaxItems = 200;
    private const int OwnerReachTiles = 6;

    private readonly List<Entry> entries;

    private BodyShop(string shopId, string title, string location, Point counter, List<Entry> entries)
    {
        this.ShopId = shopId;
        this.Title = title;
        this.Location = location;
        this.Counter = counter;
        this.entries = entries;
    }

    public string ShopId { get; }
    public string Title { get; }
    public string Location { get; }
    public Point Counter { get; }
    public int Cursor { get; private set; }

    private sealed class Entry
    {
        public Entry(ISalable salable, int price, int? stock, string? tradeItem)
        {
            this.Salable = salable;
            this.Price = price;
            this.Stock = stock;
            this.TradeItem = tradeItem;
        }

        public ISalable Salable { get; }
        public int Price { get; }
        public int? Stock { get; set; }
        public string? TradeItem { get; }
    }

    /// <summary>The shop id behind a tile's action property, or null. Unknown actions come back in <paramref name="raw"/>.</summary>
    public static string? ShopIdAt(GameLocation location, Point tile, out string? raw)
    {
        raw = location.doesTileHaveProperty(tile.X, tile.Y, "Action", "Buildings");
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var parts = raw.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts[0] switch
        {
            "OpenShop" when parts.Length > 1 => parts[1],
            "Buy" when parts.Length > 1 && parts[1] == "General" => "SeedShop",
            "Buy" when parts.Length > 1 && parts[1] == "Fish" => "FishShop",
            "Carpenter" => "Carpenter",
            "Blacksmith" => "Blacksmith",
            "AnimalShop" => "AnimalShop",
            "Saloon" => "Saloon",
            "IceCreamStand" => "IceCreamStand",
            _ => null,
        };
    }

    /// <summary>Opens the shop's stock for the body, or returns why the counter refuses.</summary>
    public static BodyShop? TryOpen(GameLocation location, Point counter, string shopId, out string refusal)
    {
        refusal = "";
        if (!DataLoader.Shops(Game1.content).TryGetValue(shopId, out var data))
        {
            refusal = $"no shop data for {shopId}";
            return null;
        }
        if (data.Owners is { Count: > 0 } owners && !owners.Any(owner => OwnerPresent(location, counter, owner.Name, owner.Condition)))
        {
            refusal = $"nobody is minding the {shopId} counter right now";
            return null;
        }
        var entries = new List<Entry>();
        foreach (var (salable, info) in ShopBuilder.GetShopStock(shopId))
        {
            if (entries.Count >= MaxItems) break;
            entries.Add(new Entry(
                salable,
                Math.Max(0, info.Price),
                info.Stock == int.MaxValue ? null : Math.Max(0, info.Stock),
                string.IsNullOrEmpty(info.TradeItem) ? null : ItemRegistry.GetDataOrErrorItem(info.TradeItem).DisplayName));
        }
        return new BodyShop(shopId, shopId, location.NameOrUniqueName, counter, entries);
    }

    /// <summary>A shop menu the game itself opened for the body (a machine or an object's own shop).</summary>
    public static BodyShop FromStock(GameLocation location, Point counter, string shopId, IDictionary<ISalable, ItemStockInformation> stock)
    {
        var entries = stock.Take(MaxItems).Select(pair => new Entry(
            pair.Key,
            Math.Max(0, pair.Value.Price),
            pair.Value.Stock == int.MaxValue ? null : Math.Max(0, pair.Value.Stock),
            string.IsNullOrEmpty(pair.Value.TradeItem) ? null : ItemRegistry.GetDataOrErrorItem(pair.Value.TradeItem).DisplayName)).ToList();
        return new BodyShop(shopId, shopId, location.NameOrUniqueName, counter, entries);
    }

    private static bool OwnerPresent(GameLocation location, Point counter, string? name, string? condition)
    {
        if (!string.IsNullOrEmpty(condition) && !GameStateQuery.CheckConditions(condition, location)) return false;
        if (name is null or "AnyOrNone" or "None") return true;
        bool Near(NPC npc) => Math.Abs(npc.TilePoint.X - counter.X) + Math.Abs(npc.TilePoint.Y - counter.Y) <= OwnerReachTiles;
        if (name == "Any") return location.characters.Any(npc => npc.IsVillager && Near(npc));
        return location.characters.Any(npc => npc.Name == name && Near(npc));
    }

    /// <summary>The shop stays open while the body stays at the counter.</summary>
    public bool StillAt(NativeCompanion actor)
    {
        return actor.currentLocation?.NameOrUniqueName == this.Location
            && Math.Abs(actor.TilePoint.X - this.Counter.X) + Math.Abs(actor.TilePoint.Y - this.Counter.Y) <= 2;
    }

    public void Move(int delta)
    {
        if (this.entries.Count == 0) return;
        this.Cursor = ((this.Cursor + delta) % this.entries.Count + this.entries.Count) % this.entries.Count;
    }

    public string CursorLine()
    {
        if (this.entries.Count == 0) return "the shop has nothing for sale";
        var entry = this.entries[this.Cursor];
        return $"#{this.Cursor} {entry.Salable.DisplayName} for {entry.Price}g";
    }

    /// <summary>Buys one unit of the item under the cursor into the body's inventory.</summary>
    public (string Kind, string Detail) BuyOne(Farmer avatar)
    {
        if (this.entries.Count == 0) return ("nothing-for-sale", this.ShopId);
        var entry = this.entries[this.Cursor];
        var name = entry.Salable.DisplayName;
        if (entry.TradeItem is not null) return ("needs-trade", $"{name} costs {entry.TradeItem} in trade, which the body cannot give");
        if (entry.Stock is 0) return ("sold-out", name);
        if (Game1.player.Money < entry.Price) return ("cant-afford", $"{name} costs {entry.Price}g; the wallet has {Game1.player.Money}g");
        if (entry.Salable.GetSalableInstance() is not Item item) return ("not-an-item", name);
        item.Stack = 1;
        var leftover = avatar.addItemToInventory(item);
        if (leftover is not null) return ("inventory-full", $"no room for {name}");
        Game1.player.Money -= entry.Price;
        if (entry.Stock is { } stock) entry.Stock = stock - 1;
        Game1.playSound("purchase");
        return ("bought", $"1 x {name} for {entry.Price}g; the wallet has {Game1.player.Money}g");
    }

    public BodyMenu ToWire()
    {
        var items = this.entries.Select((entry, index) =>
        {
            var item = entry.Salable as Item;
            return new BodyMenuItem(index, Clip(entry.Salable.QualifiedItemId ?? entry.Salable.Name), Clip(entry.Salable.DisplayName),
                Clip(item?.getCategoryName() ?? ""), entry.Price, entry.Stock, entry.TradeItem is null ? null : Clip(entry.TradeItem));
        }).ToArray();
        return new BodyMenu("shop", this.ShopId, this.Title, this.Cursor, Game1.player.Money, items);
    }

    private static string Clip(string value) => value.Length <= 80 ? value : value[..80];
}
