using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using HarmonyLib;
using Microsoft.Xna.Framework;
using StardewModdingAPI;
using StardewValley;
using StardewValley.Locations;
using StardewValley.Menus;

namespace DSHPlayer2.Stardew;

/// <summary>
/// P2-0022: the companion's own seat at the game. Stardew's local co-op runs
/// another game instance in this process that joins the host as a farmhand
/// over the game's own network code. The seat opens one for the companion,
/// keeps it off the player's screen (no split, no drawing once it plays) and
/// closes it. From then on the companion is a farmer like any co-op friend:
/// the game itself does what its buttons do.
/// </summary>
internal sealed class CompanionSeat
{
    /// <summary>Marks the companion's farmhand in the save, so the same farmer comes back every day.</summary>
    private const string FarmhandKey = "AlexYanggg.DSHPlayer2/companion";

    /// <summary>The seat's game instance; static because the draw and layout patches read it.</summary>
    private static Game1? seat;

    private readonly IMonitor monitor;
    private readonly IReflectionHelper reflection;
    private bool appearanceDirty;

    public CompanionSeat(IMonitor monitor, IReflectionHelper reflection)
    {
        this.monitor = monitor;
        this.reflection = reflection;
    }

    /// <summary>Whether the instance being updated or drawn right now is the companion's.</summary>
    public static bool IsSeatScreen => seat is not null && ReferenceEquals(Game1.game1, seat);

    public bool IsOpen => seat is not null;

    /// <summary>Whether the companion's farmer is in the world and playing (read on the seat screen).</summary>
    public static bool Playing => IsSeatScreen && Game1.gameMode == Game1.playingGameMode && Game1.player is { } p && p.isCustomized.Value
        && Game1.activeClickableMenu is not CharacterCustomization;

    public string Name { get; set; } = "Player2";

    public CompanionAppearance? Appearance { get; private set; }

    public void SetAppearance(CompanionAppearance appearance)
    {
        this.Appearance = appearance;
        this.appearanceDirty = true;
    }

    /// <summary>The host lays out its window as if it played alone, and the seat is never drawn on it.</summary>
    public static void Patch(string id)
    {
        var harmony = new Harmony(id);
        harmony.Patch(AccessTools.Method(typeof(Game1), nameof(Game1.SetWindowSize)),
            prefix: new HarmonyMethod(typeof(CompanionSeat), nameof(LayoutAlone)), finalizer: new HarmonyMethod(typeof(CompanionSeat), nameof(LayoutRestore)));
        harmony.Patch(AccessTools.Method(typeof(Game1), nameof(Game1.DrawSplitScreenWindow)),
            prefix: new HarmonyMethod(typeof(CompanionSeat), nameof(NotTheSeat)), finalizer: new HarmonyMethod(typeof(CompanionSeat), nameof(BlitRestore)));
        harmony.Patch(AccessTools.Method(typeof(Game1), "Draw", new[] { typeof(GameTime) }), prefix: new HarmonyMethod(typeof(CompanionSeat), nameof(SeatDraws)));
        // The instance's own Update override (SMAPI's), which also gates mod input on IsActive.
        harmony.Patch(AccessTools.Method(Game1.game1.GetType(), "Update", new[] { typeof(GameTime) }),
            prefix: new HarmonyMethod(typeof(CompanionSeat), nameof(SeatFocused)), finalizer: new HarmonyMethod(typeof(CompanionSeat), nameof(SeatUpdated)));
    }

    /// <summary>Host screen: seats the companion when the farm has a home for it. Returns why not, or null.</summary>
    public string? TryOpen()
    {
        if (seat is not null) return null;
        if (!HasHome()) return "no-cabin";
        var runner = GameRunner.instance;
        var before = runner.gameInstances.Count;
        // A controller slot no real pad uses; the seat reads only the input the adapter gives it.
        runner.AddGameInstance(PlayerIndex.Four);
        seat = runner.gameInstances.Count > before ? runner.gameInstances[^1] : null;
        if (seat is null) return "not-added";
        this.monitor.Log($"Player2 seated {this.Name} as a hidden co-op farmer (screen {seat.instanceId}).", LogLevel.Info);
        return null;
    }

    public void Close()
    {
        if (seat is not null && GameRunner.instance.gameInstances.Contains(seat)) GameRunner.instance.RemoveGameInstance(seat);
        seat = null;
    }

    /// <summary>Seat screen, every tick: takes the companion's farmer through the game's own join and creation menus.</summary>
    public void TickSeat()
    {
        if (!GameRunner.instance.gameInstances.Contains(Game1.game1))
        {
            seat = null;
            return;
        }
        switch (Game1.activeClickableMenu)
        {
            case FarmhandMenu menu:
                this.TakeFarmer(menu);
                break;
            case CharacterCustomization creator when !Game1.player.isCustomized.Value:
                this.Create(creator);
                break;
        }
        if (this.appearanceDirty && Playing && this.Appearance is { } look)
        {
            look.Apply(Game1.player);
            Game1.player.FarmerRenderer.MarkSpriteDirty();
            this.appearanceDirty = false;
        }
        // A farmhand keeps the name it was created with; the companion's name is the persona's, every day.
        if (Playing && Game1.player.Name != this.Name) Game1.player.Name = this.Name;
    }

    private void TakeFarmer(FarmhandMenu menu)
    {
        var slots = this.reflection.GetField<List<LoadGameMenu.MenuSlot>>(menu, "menuSlots").GetValue()?.OfType<FarmhandMenu.FarmhandSlot>().ToList();
        if (slots is null || slots.Count == 0) return;
        var slot = slots.FirstOrDefault(s => s.Farmer.modData.ContainsKey(FarmhandKey)) ?? slots.FirstOrDefault(s => !s.Farmer.isCustomized.Value);
        if (slot is null)
        {
            this.monitor.Log("Player2 found no free farmhand for the companion; closing its seat.", LogLevel.Warn);
            this.Close();
            return;
        }
        slot.Activate();
    }

    private void Create(CharacterCustomization creator)
    {
        var player = Game1.player;
        this.Appearance?.Apply(player);
        player.modData[FarmhandKey] = "1";
        this.reflection.GetField<TextBox>(creator, "nameBox").GetValue().Text = this.Name;
        this.reflection.GetField<TextBox>(creator, "favThingBox").GetValue().Text = "farming";
        // The menu copies its boxes into the farmer only while drawn, and the seat is not drawn.
        player.Name = this.Name;
        player.favoriteThing.Value = "farming";
        player.farmName.Value = Game1.MasterPlayer.farmName.Value;
        this.reflection.GetMethod(creator, "optionButtonClick").Invoke("OK");
    }

    /// <summary>A cabin whose farmhand is the companion's or not created yet, the way a co-op friend needs one.</summary>
    private static bool HasHome()
    {
        var found = false;
        Utility.ForEachLocation(location =>
        {
            if (location is Cabin cabin && (cabin.owner is not { } owner || owner.modData.ContainsKey(FarmhandKey) || !owner.isCustomized.Value)) found = true;
            return !found;
        });
        return found;
    }

    private static void LayoutAlone(ref List<Game1>? __state)
    {
        __state = null;
        if (seat is null || IsSeatScreen) return;
        __state = GameRunner.instance.gameInstances;
        GameRunner.instance.gameInstances = __state.Where(instance => !ReferenceEquals(instance, seat)).ToList();
    }

    private static void LayoutRestore(List<Game1>? __state)
    {
        if (__state is not null) GameRunner.instance.gameInstances = __state;
    }

    /// <summary>The runner blits every screen without switching instances (the seat stays current), so each blit runs as its own instance.</summary>
    private static bool NotTheSeat(Game1 __instance, ref Game1? __state)
    {
        __state = Game1.game1;
        if (ReferenceEquals(__instance, seat)) return false;
        Game1.game1 = __instance;
        return true;
    }

    private static void BlitRestore(Game1? __state) => Game1.game1 = __state!;

    private static readonly FieldInfo Platform = AccessTools.Field(typeof(Game), "Platform");
    private static readonly FieldInfo PlatformActive = AccessTools.Field(Platform.FieldType, "_isActive");

    /// <summary>
    /// The game reads a screen's controls, and SMAPI applies mod input, only while
    /// the shared window has focus. A co-op friend has a window of their own, so the
    /// seat updates as focused; it reads no keyboard or mouse, only its controller.
    /// </summary>
    private static void SeatFocused(Game1 __instance, ref bool __state)
    {
        __state = ReferenceEquals(__instance, seat) && !GameRunner.instance.IsActive;
        if (__state) PlatformActive.SetValue(Platform.GetValue(GameRunner.instance), true);
    }

    /// <summary>
    /// Local co-op freezes the world while every farmer has a menu open. A friend over the
    /// network never pauses the host, so neither does the seat: its own shop or inventory
    /// must not freeze the world while the player has the chat open.
    /// </summary>
    private static void SeatUpdated(Game1 __instance, bool __state)
    {
        if (__state) PlatformActive.SetValue(Platform.GetValue(GameRunner.instance), false);
        if (ReferenceEquals(__instance, seat)) Game1.player.requestingTimePause.Value = false;
    }

    /// <summary>The seat draws only while joining or saving (both menus advance only after their first draw), never while it plays.</summary>
    private static bool SeatDraws() => !IsSeatScreen || Game1.gameMode != Game1.playingGameMode || Game1.activeClickableMenu is SaveGameMenu;
}
