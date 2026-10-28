using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace DSHPlayer2.Core;

// P2-0021 body protocol, C# side. The TypeScript zod schemas in
// packages/contracts/src/body.ts are the source of truth; the golden fixture
// fixtures/body/stardew-body-frames.json pins both ends to the same bytes.

public sealed record BodyInputDescriptor(
    string Id,
    string Kind,
    string Description,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Cheat = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Role = null);

public sealed record BodyStateField(string Name, string Description);

public sealed record BodyStateDescriptor(
    string File,
    string World,
    string Description,
    IReadOnlyList<BodyStateField> Fields,
    IReadOnlyDictionary<string, string> Legend);

public sealed record BodyLimits(int MaxSteps, int MaxStepMs, double TickMs, double WalkPxPerTick, int TilePx);

public sealed record BodyCheats(bool SettingAllowed);

public sealed record BodyDeclaration(
    string Version,
    string Adapter,
    string Game,
    string WrittenAt,
    BodyStateDescriptor State,
    IReadOnlyList<BodyInputDescriptor> Inputs,
    BodyLimits Limits,
    BodyCheats Cheats);

public sealed record BodyItem(
    int Slot,
    string Id,
    string Name,
    int Stack,
    string Category,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, object?>? Extra = null);

public sealed record BodyTime(int Day, string Season, int DayOfMonth, int Year, int TimeOfDay, string Weather);

public sealed record BodyPlayerState(
    string Location, int X, int Y, double Px, double Py, string Facing,
    string Name, int Money, double Health, double Stamina, IReadOnlyList<BodyItem> Items);

public sealed record BodyActorState(
    string Location, int X, int Y, double Px, double Py, string Facing,
    bool Present, bool Moving, int SelectedSlot, double Health, double Stamina, int Money, IReadOnlyList<BodyItem> Items, int? ActiveTask,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] BodyMenu? Menu = null);

/// <summary>One line of an open shop menu: what it is, what it costs, how many are left.</summary>
public sealed record BodyMenuItem(int Index, string Id, string Name, int Price, int? Stock);

/// <summary>The menu open on the body's own screen, as the game holds it: its type, what the controller cursor is on, its buttons, and a shop's stock.</summary>
public sealed record BodyMenu(
    string Kind,
    string? Focus,
    IReadOnlyList<string> Options,
    int Money,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<BodyMenuItem>? Stock = null);

public sealed record BodyMap(string Location, int Width, int Height, IReadOnlyList<string> Rows);

public sealed record BodyObject(
    int X,
    int Y,
    string Kind,
    string Name,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Id = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, object?>? Extra = null);

public sealed record BodyCharacter(
    int X,
    int Y,
    double Px,
    double Py,
    string Name,
    string Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? Health = null);

public sealed record BodyWarp(int X, int Y, string To, int ToX, int ToY, string Kind);

/// <summary>One tile the game itself answers, as raw data: position, map layer, and the raw action string (or sheet#index where code answers by tile).</summary>
public sealed record BodyActionTile(int X, int Y, string Layer, string Action);

public sealed record BodyTruncation(int Objects);

public sealed record BodyState(
    string Version,
    long Revision,
    string WrittenAt,
    long Tick,
    bool Paused,
    BodyTime Time,
    BodyPlayerState Player,
    BodyActorState? Body,
    BodyMap Map,
    IReadOnlyList<BodyObject> Objects,
    IReadOnlyList<BodyCharacter> Characters,
    IReadOnlyList<BodyWarp> Warps,
    BodyTruncation Truncated,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<BodyActionTile>? ActionTiles = null);

public sealed record BodyWorldLocation(string Name, string DisplayName, bool Outdoors, IReadOnlyList<BodyWarp> Warps);

public sealed record BodyWorld(string Version, string WrittenAt, IReadOnlyList<BodyWorldLocation> Locations);

public sealed record BodyInputStep(IReadOnlyList<string>? Hold, IReadOnlyList<string>? Press, int Ms);

public sealed record BodyArrive(string Location, int X, int Y, int Radius);

public sealed record BodyUntil(BodyArrive? Arrive, int? BlockedMs, double? MonsterWithin, bool? Warped);

public sealed record BodyTask(
    string Version,
    string TaskId,
    int Seq,
    string CreatedAt,
    IReadOnlyList<BodyInputStep> Steps,
    BodyUntil? Until,
    bool? FastState);

public sealed record BodyEvent(long Tick, string Kind, string Detail);

public sealed record BodyTaskStatus(
    string Version,
    string TaskId,
    int Seq,
    string Status,
    int Update,
    int Step,
    IReadOnlyList<BodyEvent> Events,
    string? Reason,
    long StateRevision,
    string UpdatedAt);

/// <summary>The player's spoken cheat grant for one save (`goal/cheat.json` in the save's session folder).</summary>
public sealed record BodyCheatGrant(string Version, bool Granted, string At, string Quote);

public static class BodyWire
{
    /// <summary>Now in the wire format the TypeScript contracts accept: UTC with a "Z" suffix.</summary>
    public static string Now() => System.DateTimeOffset.UtcNow.UtcDateTime.ToString("O", System.Globalization.CultureInfo.InvariantCulture);
}
