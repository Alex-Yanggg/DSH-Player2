using System;
using System.Collections.Generic;
using System.Globalization;

namespace DSHPlayer2.Core;

/// <summary>The minimal key/value surface the settlement ledger needs.</summary>
public interface IKeyValueState
{
    bool TryGetValue(string key, out string value);
    void Set(string key, string value);
    void Remove(string key);
}

/// <summary>A plain-dictionary state for tests and non-game hosts.</summary>
public sealed class DictionaryKeyValueState : IKeyValueState
{
    private readonly IDictionary<string, string> values;

    public DictionaryKeyValueState(IDictionary<string, string> values)
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

/// <summary>
/// The farmer-owned settlement ledger over one key/value state: which bridge
/// sequence is reserved for which game day, and which game days are settled.
/// Game-free and fully unit-testable; the mod adapts SMAPI's modData and the
/// bridge-side sequence allocator.
/// </summary>
public static class CompanionSettlementStore
{
    public const string SettledSequenceKey = "AlexYanggg.DSHPlayer2/settled-sequence";
    public const string SettledGameDayKey = "AlexYanggg.DSHPlayer2/settled-game-day";
    public const string PendingSequenceKey = "AlexYanggg.DSHPlayer2/pending-sequence";
    public const string PendingGameDayKey = "AlexYanggg.DSHPlayer2/pending-game-day";
    public const string CompanionChoiceKey = "AlexYanggg.DSHPlayer2/companion-name";

    /// <summary>
    /// Returns the sequence reserved for this game day, allocating one through
    /// <paramref name="nextSequence"/> when no reservation exists yet. The
    /// reservation survives a same-day restart so both sides see one sequence.
    /// </summary>
    public static int ResolveSequence(IKeyValueState state, int gameDay, Func<int> nextSequence)
    {
        if (state.TryGetValue(PendingGameDayKey, out var pendingDayValue) &&
            int.TryParse(pendingDayValue, NumberStyles.None, CultureInfo.InvariantCulture, out var pendingDay) &&
            pendingDay == gameDay &&
            state.TryGetValue(PendingSequenceKey, out var pendingSequenceValue) &&
            int.TryParse(pendingSequenceValue, NumberStyles.None, CultureInfo.InvariantCulture, out var pendingSequence) &&
            pendingSequence > 0)
        {
            return pendingSequence;
        }

        var sequence = nextSequence();
        state.Set(PendingGameDayKey, gameDay.ToString(CultureInfo.InvariantCulture));
        state.Set(PendingSequenceKey, sequence.ToString(CultureInfo.InvariantCulture));
        return sequence;
    }

    /// <summary>
    /// Returns whether the game day is settled. Before bridge-wide sequences
    /// the sequence was exactly the 1-based game day; that legacy scheme keeps
    /// a same-day settled save settled during the migration.
    /// </summary>
    public static bool IsGameDaySettled(IKeyValueState state, int gameDay)
    {
        if (state.TryGetValue(SettledGameDayKey, out var value) &&
            int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var settled) &&
            settled >= gameDay)
        {
            return true;
        }
        return state.TryGetValue(SettledSequenceKey, out var legacyValue) &&
            int.TryParse(legacyValue, NumberStyles.None, CultureInfo.InvariantCulture, out var legacySequence) &&
            legacySequence == gameDay;
    }

    /// <summary>Records a settled sequence and clears its pending reservation.</summary>
    public static void MarkSettled(IKeyValueState state, int sequence, int gameDay)
    {
        state.Set(SettledSequenceKey, sequence.ToString(CultureInfo.InvariantCulture));
        state.Set(SettledGameDayKey, gameDay.ToString(CultureInfo.InvariantCulture));
        state.Remove(PendingSequenceKey);
        state.Remove(PendingGameDayKey);
    }

    /// <summary>Clears the settled marker for one game day, enabling an explicit same-day retry.</summary>
    public static void ClearSettlement(IKeyValueState state)
    {
        state.Remove(SettledSequenceKey);
        state.Remove(SettledGameDayKey);
    }
}
