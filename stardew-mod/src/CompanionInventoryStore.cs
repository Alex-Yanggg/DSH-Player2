using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using StardewModdingAPI;
using StardewValley;
using StardewValley.Tools;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The companion body's own toolbar (P2-0021), persisted on the save's farmer
/// so it survives days and reloads. A new body starts with the basic farmer
/// kit a new farmhand gets: hoe, watering can, pickaxe, axe, scythe, sword.
/// </summary>
internal static class CompanionInventoryStore
{
    public const string Key = "DSHPlayer2/body-inventory";
    public const int Slots = 12;

    private static readonly string[] StarterKit = { "(T)Hoe", "(T)WateringCan", "(T)Pickaxe", "(T)Axe", "(W)47", "(W)0" };

    private sealed record Entry(int Slot, string Id, int Stack, int Quality, int? Water);

    public static void LoadInto(Farmer avatar, IMonitor? monitor = null)
    {
        var items = new Item?[Slots];
        var loaded = false;
        if (Game1.player.modData.TryGetValue(Key, out var json) && !string.IsNullOrWhiteSpace(json))
        {
            try
            {
                foreach (var entry in JsonSerializer.Deserialize<List<Entry>>(json) ?? new())
                {
                    if (entry.Slot is < 0 or >= Slots) continue;
                    var item = ItemRegistry.Create(entry.Id, Math.Max(1, entry.Stack), entry.Quality, allowNull: true);
                    if (item is WateringCan can && entry.Water is { } water) can.WaterLeft = Math.Clamp(water, 0, can.waterCanMax);
                    items[entry.Slot] = item;
                }
                loaded = true;
            }
            catch (Exception ex)
            {
                // A damaged toolbar is a traced error; the body keeps an empty one rather than a guessed one.
                monitor?.Log($"Player2 could not read the companion's toolbar: {ex.Message}", LogLevel.Error);
                loaded = true;
            }
        }
        if (!loaded)
        {
            for (var i = 0; i < StarterKit.Length; i++) items[i] = ItemRegistry.Create(StarterKit[i]);
            if (items[1] is WateringCan can) can.WaterLeft = can.waterCanMax;
        }
        avatar.MaxItems = Slots;
        avatar.Items.Clear();
        foreach (var item in items) avatar.Items.Add(item);
        avatar.CurrentToolIndex = 0;
        avatar.Stamina = avatar.MaxStamina;
    }

    public static void Save(Farmer avatar)
    {
        var entries = new List<Entry>();
        for (var slot = 0; slot < avatar.Items.Count && slot < Slots; slot++)
        {
            if (avatar.Items[slot] is not { } item) continue;
            entries.Add(new Entry(slot, item.QualifiedItemId, item.Stack, item.Quality, item is WateringCan can ? can.WaterLeft : null));
        }
        Game1.player.modData[Key] = JsonSerializer.Serialize(entries);
    }
}
