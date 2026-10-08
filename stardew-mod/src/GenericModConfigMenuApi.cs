using System;
using StardewModdingAPI;

namespace DSHPlayer2.Stardew;

/// <summary>The optional Generic Mod Config Menu surface used by Player2.</summary>
public interface IGenericModConfigMenuApi
{
    void Register(IManifest mod, Action reset, Action save, bool titleScreenOnly = false);

    void AddSectionTitle(IManifest mod, Func<string> text, Func<string>? tooltip = null);

    void AddParagraph(IManifest mod, Func<string> text);

    void AddBoolOption(
        IManifest mod,
        Func<bool> getValue,
        Action<bool> setValue,
        Func<string> name,
        Func<string>? tooltip = null,
        string? fieldId = null);

    void AddKeybind(
        IManifest mod,
        Func<SButton> getValue,
        Action<SButton> setValue,
        Func<string>? name = null,
        Func<string>? tooltip = null,
        string? fieldId = null);
}
