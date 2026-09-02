using System;
using DSHPlayer2.Core;
using StardewValley.Mods;

namespace DSHPlayer2.Stardew;

/// <summary>Bridges SMAPI's ModDataDictionary to the core key/value surface.</summary>
internal sealed class ModDataState : IKeyValueState
{
    private readonly ModDataDictionary values;

    public ModDataState(ModDataDictionary values)
    {
        this.values = values;
    }

    public bool TryGetValue(string key, out string value)
    {
        return this.values.TryGetValue(key, out value!);
    }

    public void Set(string key, string value)
    {
        this.values[key] = value;
    }

    public void Remove(string key)
    {
        this.values.Remove(key);
    }
}
