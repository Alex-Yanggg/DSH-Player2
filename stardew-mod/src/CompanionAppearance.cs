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
    Gender Gender,
    string? Name = null)
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

    /// <summary>
    /// The look a closed customization menu left on the farmer, with the name typed in it. Its OK
    /// turns the chosen shirt and pants into worn items and sets the base ids to "-1", so the worn
    /// ids and the dyed pants colour are what was chosen.
    /// </summary>
    public static CompanionAppearance CaptureChosen(Farmer farmer)
    {
        return Capture(farmer) with
        {
            Shirt = farmer.GetShirtId(),
            Pants = farmer.GetPantsId(),
            PantsColor = (farmer.pantsItem.Value?.clothesColor.Value ?? farmer.pantsColor.Value).PackedValue,
            Name = string.IsNullOrWhiteSpace(farmer.Name) ? null : farmer.Name,
        };
    }

    /// <summary>
    /// Dresses the farmer in this look. Worn clothing items override the base shirt and
    /// pants the look carries (a farmhand wears its creation outfit as items), so they come off.
    /// </summary>
    public void Apply(Farmer farmer)
    {
        farmer.shirtItem.Value = null;
        farmer.pantsItem.Value = null;
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
