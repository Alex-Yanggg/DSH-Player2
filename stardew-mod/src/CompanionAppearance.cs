using System;
using System.Text.Json;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewValley;

namespace DSHPlayer2.Stardew;

/// <summary>The vanilla farmer appearance owned by one save's companion.</summary>
internal sealed record CompanionAppearance(
    int Hair,
    int Skin,
    int Accessory,
    int FacialHair,
    string Shirt,
    string Pants,
    string Shoes,
    uint HairColor,
    uint PantsColor,
    uint EyeColor,
    Gender Gender)
{
    public static CompanionAppearance Capture(Farmer farmer)
    {
        return new CompanionAppearance(
            farmer.hair.Value,
            farmer.skin.Value,
            farmer.accessory.Value,
            farmer.facialHair.Value,
            farmer.shirt.Value ?? farmer.GetShirtId(),
            farmer.pants.Value ?? farmer.GetPantsId(),
            farmer.shoes.Value ?? "0",
            farmer.hairstyleColor.Value.PackedValue,
            farmer.pantsColor.Value.PackedValue,
            farmer.newEyeColor.Value.PackedValue,
            farmer.Gender);
    }

    public void Apply(Farmer farmer)
    {
        farmer.Gender = this.Gender;
        farmer.hair.Value = this.Hair;
        farmer.skin.Value = this.Skin;
        farmer.accessory.Value = this.Accessory;
        farmer.facialHair.Value = this.FacialHair;
        farmer.shirt.Value = this.Shirt;
        farmer.pants.Value = this.Pants;
        farmer.shoes.Value = this.Shoes;
        farmer.hairstyleColor.Value = new Color(this.HairColor);
        farmer.pantsColor.Value = new Color(this.PantsColor);
        farmer.newEyeColor.Value = new Color(this.EyeColor);
        farmer.FarmerRenderer.MarkSpriteDirty();
    }
}

/// <summary>Persists the companion body beside the player-owned save data.</summary>
internal static class CompanionAppearanceStore
{
    public const string AppearanceKey = "AlexYanggg.DSHPlayer2/companion-appearance";

    public static CompanionAppearance? Load(Farmer farmer, IMonitor monitor)
    {
        if (!farmer.modData.TryGetValue(AppearanceKey, out var json) || string.IsNullOrWhiteSpace(json))
        {
            return null;
        }
        try
        {
            return JsonSerializer.Deserialize<CompanionAppearance>(json);
        }
        catch (JsonException ex)
        {
            monitor.Log($"Player2 ignored unreadable companion appearance: {ex.Message}", LogLevel.Warn);
            return null;
        }
    }

    public static void Save(Farmer farmer, CompanionAppearance appearance)
    {
        farmer.modData[AppearanceKey] = JsonSerializer.Serialize(appearance);
    }
}
