using System;
using System.Collections.Generic;
using System.Linq;
using DSHPlayer2.Core;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using StardewValley.Menus;
using StardewValley.Objects;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The SMAPI adapter. The companion's mind is a DSH session (<see cref="DshCompanion"/>);
/// its body is a hidden co-op farmer (<see cref="CompanionSeat"/>) played through
/// the game's MCP endpoint (<see cref="GameMcpServer"/> over <see cref="BodyAdapter"/>).
/// This class only wires game events to prompts, shows what the companion says,
/// and keeps the vanilla-facing flows: companion choice, native appearance
/// customization and chat.
/// </summary>
internal sealed class ModEntry : Mod
{
    private const string CompanionChoiceKey = "AlexYanggg.DSHPlayer2/companion-name";
    private const string CompanionChoiceIdPrefix = "dsh-player2-companion-";
    /// <summary>Ticks of a frozen world before the turn in flight is stopped; the goal stays.</summary>
    private const int PauseCancelTicks = 180;
    private const int ResumeTicks = 30;

    private ModConfig config = new();
    private List<CompanionChoice> companions = new();
    private BodyAdapter body = null!;
    private CompanionSeat seat = null!;
    private GameMcpServer mcp = null!;
    private DshCompanion dsh = null!;
    private ChatTranscript? transcript;
    private bool choicePending;
    private bool dayPending;
    private bool appearanceCustomizationRequested;
    private CharacterCustomization? activeAppearanceMenu;
    private CompanionAppearance? playerAppearanceBeforeCustomization;
    private CompanionAppearance? previousCompanionAppearance;
    private Clothing? playerShirtBeforeCustomization;
    private Clothing? playerPantsBeforeCustomization;
    private string? playerNameBeforeCustomization;
    private string? playerDisplayNameBeforeCustomization;
    private string? playerFavoriteThingBeforeCustomization;
    private bool playerCustomizedBeforeCustomization;
    private bool chatHintPending;
    private bool dayOpen;
    private int lastWorldTick;
    private int pausedTicks;
    private int runningTicks;
    private bool cancelledForPause;
    private bool noCabinShown;
    private bool sleepWaitNoted;
    private PlayerMarks? marks;
    private int lastWorldNoteTime;

    public override void Entry(IModHelper helper)
    {
        this.config = helper.ReadConfig<ModConfig>();
        this.companions = CompanionChoice.LoadAll(helper.DirectoryPath);
        if (string.IsNullOrWhiteSpace(this.config.DecisionBridgeDirectory))
        {
            this.config.DecisionBridgeDirectory = ModConfig.DefaultBridgeDirectory();
            helper.WriteConfig(this.config);
        }
        var channel = new BodyChannel();
        this.mcp = new GameMcpServer(channel.Tools());
        this.mcp.Start();
        this.dsh = new DshCompanion(this.Monitor, this.config, this.mcp.McpServerEntry());
        this.body = new BodyAdapter(this.Monitor, helper.Input, channel, () => this.config.AllowCheatCapabilities);
        this.seat = new CompanionSeat(this.Monitor, helper.Reflection);
        CompanionSeat.Patch(this.ModManifest.UniqueID);
        this.Monitor.Log($"Player2 companion: DSH acp profile for the mind, game endpoint on port {this.mcp.Port} for the hands.", LogLevel.Info);
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
        helper.Events.GameLoop.DayEnding += this.OnDayEnding;
        helper.Events.GameLoop.GameLaunched += this.OnGameLaunched;
        helper.Events.GameLoop.UpdateTicking += this.OnUpdateTicking;
        helper.Events.GameLoop.UpdateTicked += this.OnUpdateTicked;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;
        helper.Events.Input.ButtonPressed += this.OnButtonPressed;
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            this.dsh.Dispose();
            this.mcp.Dispose();
        };
    }

    private static int GameDay => Game1.Date.TotalDays + 1;

    private void OnButtonPressed(object? sender, ButtonPressedEventArgs e)
    {
        if (CompanionSeat.IsSeatScreen) return;
        if (Context.IsWorldReady && e.Button == this.config.CustomizeCompanionKey)
        {
            this.Helper.Input.Suppress(e.Button);
            if (this.ResolveCompanionChoice() is null)
            {
                Game1.addHUDMessage(new HUDMessage(this.T("appearance.choose-first")));
                return;
            }
            this.appearanceCustomizationRequested = true;
            return;
        }
        if (e.Button != this.config.ChatKey || !Context.IsWorldReady) return;
        if (Game1.activeClickableMenu is CompanionChatMenu chatMenu)
        {
            this.Helper.Input.Suppress(e.Button);
            chatMenu.exitThisMenu();
            return;
        }
        if (!Context.IsPlayerFree || Game1.activeClickableMenu is not null) return;
        if (!Context.IsMainPlayer)
        {
            Game1.addHUDMessage(new HUDMessage(this.T("chat.host-only")));
            return;
        }
        this.transcript ??= CompanionTranscriptStore.Load(this.Helper, this.Monitor);
        Game1.activeClickableMenu = new CompanionChatMenu(
            this.transcript,
            Game1.player.Name,
            this.OnChatSubmitted,
            () => this.dsh.IsReplying,
            this.T("chat.title", new { name = this.ResolveCompanionName() }),
            key => this.T(key));
    }

    private string T(string key, object? tokens = null) => this.Helper.Translation.Get(key, tokens).ToString();

    private void OnGameLaunched(object? sender, GameLaunchedEventArgs e)
    {
        var menu = this.Helper.ModRegistry.GetApi<IGenericModConfigMenuApi>("spacechase0.GenericModConfigMenu");
        if (menu is null) return;
        menu.Register(
            this.ModManifest,
            reset: () =>
            {
                var defaults = new ModConfig();
                this.config.AllowCheatCapabilities = defaults.AllowCheatCapabilities;
                this.config.ChatKey = defaults.ChatKey;
                this.config.CustomizeCompanionKey = defaults.CustomizeCompanionKey;
            },
            save: () => this.Helper.WriteConfig(this.config));
        menu.AddSectionTitle(this.ModManifest, () => this.T("config.permissions.title"));
        menu.AddBoolOption(this.ModManifest, () => this.config.AllowCheatCapabilities, value => this.config.AllowCheatCapabilities = value,
            () => this.T("config.allow-cheats.name"), () => this.T("config.allow-cheats.tooltip"), "allow-cheat-capabilities");
        menu.AddParagraph(this.ModManifest, () => this.T("config.allow-cheats.note"));
        menu.AddSectionTitle(this.ModManifest, () => this.T("config.controls.title"));
        menu.AddKeybind(this.ModManifest, () => this.config.ChatKey, value => this.config.ChatKey = value,
            () => this.T("config.chat-key.name"), () => this.T("config.chat-key.tooltip"), "chat-key");
        menu.AddKeybind(this.ModManifest, () => this.config.CustomizeCompanionKey, value => this.config.CustomizeCompanionKey = value,
            () => this.T("config.customize-key.name"), () => this.T("config.customize-key.tooltip"), "customize-companion-key");
    }

    // ---- the day and the mind -------------------------------------------------

    private void OnDayStarted(object? sender, DayStartedEventArgs e)
    {
        this.lastWorldNoteTime = 0;
        if (!Context.IsMainPlayer) return;
        if (this.ResolveCompanionChoice() is null)
        {
            this.choicePending = true;
            this.dayPending = true;
            return;
        }
        if (CompanionAppearanceStore.Load(Game1.player, this.Monitor) is not { } appearance)
        {
            this.appearanceCustomizationRequested = true;
            this.dayPending = true;
            return;
        }
        this.seat.SetAppearance(appearance);
        this.StartCompanionDay();
    }

    /// <summary>Opens the save's DSH session and tells the companion a new day began.</summary>
    private void StartCompanionDay()
    {
        this.dayPending = false;
        if (this.ResolveCompanionChoice() is not { } companion) return;
        var session = SessionLayout.SessionDirectory(this.config.DecisionBridgeDirectory, companion.Id, SessionLayout.SaveId(Game1.uniqueIDForThisGame));
        try
        {
            this.body.Attach(session);
            this.dsh.OpenSave(companion, session);
        }
        catch (Exception ex)
        {
            this.ReportFailure("DSH_START_FAILED", ex.Message);
            return;
        }
        this.seat.Name = companion.Name;
        if (this.seat.TryOpen() is "no-cabin" && !this.noCabinShown)
        {
            this.noCabinShown = true;
            Game1.addHUDMessage(new HUDMessage(this.T("seat.no-cabin", new { name = companion.Name })));
        }
        this.dayOpen = true;
        this.cancelledForPause = false;
        this.chatHintPending = true;
        this.Send($"[day-start day={GameDay}]");
    }

    private void OnDayEnding(object? sender, DayEndingEventArgs e)
    {
        if (Context.IsMainPlayer && this.dayOpen) this.Send($"[day-end day={GameDay}]");
    }

    private bool OnChatSubmitted(string message)
    {
        var transcript = this.transcript ??= new ChatTranscript();
        transcript.Append(Game1.player.Name, message);
        CompanionTranscriptStore.Save(this.Helper, transcript, this.Monitor);
        if (!this.dayOpen) this.StartCompanionDay();
        this.Interrupt($"[chat day={GameDay}] {message}");
        return true;
    }

    /// <summary>
    /// Something the companion should hear about now stops what it was doing, as a person stops
    /// to listen: the goal round in flight ends (DSH pauses the goal) and the companion answers first.
    /// </summary>
    private void Interrupt(string prompt)
    {
        // Whether or not it has spoken yet: a turn that works on in silence must still hear the player.
        this.dsh.Cancel();
        this.cancelledForPause = false;
        this.Send(prompt);
    }

    /// <summary>
    /// [world] prompts are plain facts about the shared world the companion could not otherwise
    /// notice; what to do about them is its own call. The player waiting in bed and the player
    /// badly hurt cut in at once (the night or a life depends on it); the rest wait their turn, at
    /// most one an in-game hour. Nothing is noticed while the player is busy in a cutscene,
    /// festival or minigame: the changes are told once they are back.
    /// </summary>
    private void NoticeWorld()
    {
        var player = Game1.player;
        var waiting = Game1.activeClickableMenu is ReadyCheckDialog { checkName: "sleep" };
        if (waiting && !this.sleepWaitNoted) this.Interrupt($"[world day={GameDay}] {player.Name} went to bed and is waiting for every farmer to sleep before the night can end.");
        this.sleepWaitNoted = waiting;
        if (PlayerBusy) return;
        var now = new PlayerMarks(player.health, player.exhausted.Value, player.stats.FishCaught, player.deepestMineLevel, player.newLevels.Count);
        var was = this.marks;
        this.marks = now;
        if (was is null) return;
        if (now.Health < was.Health && now.Health * 3 < player.maxHealth && was.Health * 3 >= player.maxHealth)
        {
            this.Interrupt($"[world day={GameDay}] {player.Name} is badly hurt ({now.Health}/{player.maxHealth} health) in {player.currentLocation.DisplayName}.");
            return;
        }
        var fact = now.Exhausted && !was.Exhausted ? $"{player.Name} is exhausted (no energy left)."
            : now.Fish > was.Fish ? $"{player.Name} just caught a fish."
            : now.MineLevel > was.MineLevel ? $"{player.Name} reached mine level {now.MineLevel} for the first time."
            : now.LevelUps > was.LevelUps ? $"{player.Name} just levelled up a skill."
            : null;
        if (fact is null || this.dsh.IsReplying || Utility.CalculateMinutesBetweenTimes(this.lastWorldNoteTime, Game1.timeOfDay) < 60) return;
        this.lastWorldNoteTime = Game1.timeOfDay;
        this.Send($"[world day={GameDay}] {fact}");
    }

    /// <summary>The player is in a cutscene, festival or minigame: the companion neither interrupts nor speaks.</summary>
    private static bool PlayerBusy => Game1.eventUp || Game1.currentMinigame is not null || Game1.isFestival();

    /// <summary>What the companion would notice changing about the player.</summary>
    private sealed record PlayerMarks(int Health, bool Exhausted, uint Fish, int MineLevel, int LevelUps);

    /// <summary>Sends one prompt; a session lost to a DSH exit is reopened once.</summary>
    private void Send(string prompt)
    {
        this.Monitor.Log($"Player2 sent: {prompt}", LogLevel.Trace);
        if (this.dsh.Send(prompt)) return;
        if (this.ResolveCompanionChoice() is { } companion && this.body.SessionRoot is { } session)
        {
            try
            {
                this.dsh.OpenSave(companion, session);
                if (this.dsh.Send(prompt)) return;
            }
            catch (Exception ex)
            {
                this.ReportFailure("DSH_START_FAILED", ex.Message);
                return;
            }
        }
        this.ReportFailure("DSH_NOT_RUNNING", "the companion's DSH session is not open");
    }

    /// <summary>
    /// A frozen world stops the turn in flight; DSH pauses the goal instead of
    /// failing it, and the game resumes it once the world runs again. With the
    /// companion seated the game is co-op, where the world freezes only when
    /// every farmer pauses, never for one player's menu or an unfocused window.
    /// </summary>
    private void TrackPause()
    {
        var paused = Game1.ticks == this.lastWorldTick || !Game1.shouldTimePass();
        this.lastWorldTick = Game1.ticks;
        if (paused)
        {
            this.runningTicks = 0;
            // Goal rounds run inside DSH without a prompt, so the stop is sent whether or not a reply is
            // pending; a chat reply is still wanted while the chat window is open. [resume] costs no model call.
            if (++this.pausedTicks == PauseCancelTicks && Game1.activeClickableMenu is not CompanionChatMenu)
            {
                this.dsh.Cancel();
                this.cancelledForPause = true;
            }
            return;
        }
        this.pausedTicks = 0;
        if (this.cancelledForPause && ++this.runningTicks >= ResumeTicks)
        {
            this.cancelledForPause = false;
            this.Send("[resume]");
        }
    }

    private void ShowEvents()
    {
        if (PlayerBusy) return; // held, not dropped: the lines show once the player is back
        foreach (var item in this.dsh.Drain())
        {
            if (item.Kind == AcpClient.TurnEnded) this.Monitor.Log($"Player2 turn ended: {item.Text}", LogLevel.Trace);
            switch (item.Kind)
            {
                case AcpClient.Said:
                    this.Say(item.Text);
                    break;
                case AcpClient.TurnEnded when item.Text.StartsWith("error:", StringComparison.Ordinal):
                    this.ReportFailure("DSH_TURN_FAILED", item.Text["error:".Length..].Trim());
                    break;
                case "failed":
                    this.ReportFailure("DSH_TURN_FAILED", item.Text);
                    break;
                case AcpClient.Exited:
                    this.ReportFailure("DSH_EXITED", item.Text);
                    break;
            }
        }
    }

    /// <summary>What the companion says: in the game's chat, as a co-op friend's words appear.</summary>
    private void Say(string text)
    {
        var name = this.ResolveCompanionName();
        this.Monitor.Log($"Player2 companion said: {text}", LogLevel.Trace);
        var transcript = this.transcript ??= CompanionTranscriptStore.Load(this.Helper, this.Monitor);
        transcript.Append(name, text);
        CompanionTranscriptStore.Save(this.Helper, transcript, this.Monitor);
        if (Game1.activeClickableMenu is CompanionChatMenu) return;
        if (Game1.chatBox is { } chat)
            chat.addMessage($"{name}: {text}", Microsoft.Xna.Framework.Color.White);
        else
            Game1.addHUDMessage(new HUDMessage($"{name}: {text}"));
    }

    private void ReportFailure(string code, string detail)
    {
        this.Monitor.Log($"Player2 {code}: {detail}", LogLevel.Error);
        Game1.addHUDMessage(new HUDMessage(this.T("error.native-dsh", new { code, detail })));
    }

    /// <summary>The companion's seat ticks before its game reads input, so its controller is set for this tick.</summary>
    private void OnUpdateTicking(object? sender, UpdateTickingEventArgs e)
    {
        if (!CompanionSeat.IsSeatScreen) return;
        this.seat.TickSeat();
        this.body.OnTick();
    }

    private void OnUpdateTicked(object? sender, UpdateTickedEventArgs e)
    {
        if (CompanionSeat.IsSeatScreen || !Context.IsWorldReady || !Context.IsMainPlayer) return;
        if (this.activeAppearanceMenu is not null && !ReferenceEquals(Game1.activeClickableMenu, this.activeAppearanceMenu))
            this.CompleteCompanionCustomization();
        if (this.choicePending && Context.IsPlayerFree && Game1.activeClickableMenu is null) this.ShowCompanionChoice();
        this.TryOpenCompanionCustomization();
        if (this.chatHintPending && Context.IsPlayerFree && Game1.activeClickableMenu is null)
        {
            this.chatHintPending = false;
            Game1.addHUDMessage(new HUDMessage(this.T("chat.hint", new { key = this.config.ChatKey.ToString() })));
        }
        if (this.dayOpen)
        {
            this.TrackPause();
            this.NoticeWorld();
        }
        this.ShowEvents();
    }

    private void OnReturnedToTitle(object? sender, ReturnedToTitleEventArgs e)
    {
        if (CompanionSeat.IsSeatScreen) return;
        this.body.Detach("returned-to-title");
        this.seat.Close();
        this.dsh.Stop();
        this.noCabinShown = false;
        if (this.activeAppearanceMenu is not null)
        {
            this.RestorePlayerAfterCustomization();
            this.activeAppearanceMenu = null;
        }
        this.appearanceCustomizationRequested = false;
        this.choicePending = false;
        this.dayPending = false;
        this.dayOpen = false;
        this.chatHintPending = false;
        this.cancelledForPause = false;
        this.sleepWaitNoted = false;
        this.marks = null;
        this.transcript = null;
    }

    // ---- who the companion is and how it looks --------------------------------

    private CompanionChoice? ResolveCompanionChoice()
    {
        if (!Game1.player.modData.TryGetValue(CompanionChoiceKey, out var stored) || string.IsNullOrWhiteSpace(stored)) return null;
        // A name no pack carries any more (renamed or removed) asks the player to choose again.
        return this.companions.FirstOrDefault(candidate => string.Equals(candidate.Name, stored, StringComparison.OrdinalIgnoreCase));
    }

    private string ResolveCompanionName() => this.ResolveCompanionChoice()?.Name ?? "Player2";

    private void ShowCompanionChoice()
    {
        this.choicePending = false;
        var choices = this.companions = this.companions
            .OrderByDescending(choice => string.Equals(choice.Name, this.config.CompanionName, StringComparison.OrdinalIgnoreCase))
            .ToList();
        var responses = choices.Select((choice, index) => new Response(CompanionChoiceIdPrefix + index, choice.Name)).ToArray();
        Game1.currentLocation.createQuestionDialogue(this.T("companion.choice.title"), responses, this.OnCompanionChosen);
    }

    private void OnCompanionChosen(Farmer farmer, string answer)
    {
        var index = answer.StartsWith(CompanionChoiceIdPrefix, StringComparison.Ordinal) &&
            int.TryParse(answer[CompanionChoiceIdPrefix.Length..], out var parsed) ? parsed : -1;
        var choice = index >= 0 && index < this.companions.Count ? this.companions[index] : this.companions[0];
        Game1.player.modData[CompanionChoiceKey] = choice.Name;
        Game1.addHUDMessage(new HUDMessage(this.T("companion.chosen", new { name = choice.Name })));
        this.appearanceCustomizationRequested = true;
    }

    private void TryOpenCompanionCustomization()
    {
        if (!this.appearanceCustomizationRequested || this.activeAppearanceMenu is not null || !Context.IsPlayerFree || Game1.activeClickableMenu is not null)
            return;
        var player = Game1.player;
        this.playerAppearanceBeforeCustomization = CompanionAppearance.Capture(player);
        this.previousCompanionAppearance = CompanionAppearanceStore.Load(player, this.Monitor);
        this.playerShirtBeforeCustomization = player.shirtItem.Value;
        this.playerPantsBeforeCustomization = player.pantsItem.Value;
        this.playerNameBeforeCustomization = player.Name;
        this.playerDisplayNameBeforeCustomization = player.displayName;
        this.playerFavoriteThingBeforeCustomization = player.favoriteThing.Value;
        this.playerCustomizedBeforeCustomization = player.isCustomized.Value;
        this.appearanceCustomizationRequested = false;
        try
        {
            // The vanilla menu edits Game1.player. Temporarily present the
            // companion body, then restore every player-owned field on exit.
            player.shirtItem.Value = null;
            player.pantsItem.Value = null;
            (this.previousCompanionAppearance ?? this.playerAppearanceBeforeCustomization).Apply(player);
            // The menu's name box edits the farmer's name: start it at the companion's, not the player's.
            player.Name = this.previousCompanionAppearance?.Name ?? this.ResolveCompanionName();
            // The new-farmhand screen is the one that offers shirts and pants (the wizard's has none), and its OK
            // announces nothing. It also offers the farm's name and pet, which are the player's: those come off.
            var menu = new CharacterCustomization(CharacterCustomization.Source.NewFarmhand);
            menu.farmnameBoxCC.visible = false;
            this.Helper.Reflection.GetField<ClickableComponent>(menu, "farmLabel").GetValue().visible = false;
            menu.petPortraitBox = null;
            menu.leftSelectionButtons.RemoveAll(button => button.name == "Pet");
            menu.rightSelectionButtons.RemoveAll(button => button.name == "Pet");
            menu.exitFunction = this.CompleteCompanionCustomization;
            this.activeAppearanceMenu = menu;
            Game1.activeClickableMenu = menu;
        }
        catch (Exception ex)
        {
            this.RestorePlayerAfterCustomization();
            this.Monitor.Log($"Player2 could not open native companion customization: {ex.Message}", LogLevel.Error);
            Game1.addHUDMessage(new HUDMessage(this.T("appearance.failed")));
        }
    }

    private void CompleteCompanionCustomization()
    {
        if (this.activeAppearanceMenu is null) return;
        var customized = CompanionAppearance.CaptureChosen(Game1.player);
        this.RestorePlayerAfterCustomization();
        this.activeAppearanceMenu = null;
        CompanionAppearanceStore.Save(Game1.player, customized);
        this.seat.SetAppearance(customized);
        Game1.addHUDMessage(new HUDMessage(this.T("appearance.saved", new { name = customized.Name ?? this.ResolveCompanionName() })));
        if (this.dayPending) this.StartCompanionDay();
    }

    private void RestorePlayerAfterCustomization()
    {
        var player = Game1.player;
        this.playerAppearanceBeforeCustomization?.Apply(player);
        player.shirtItem.Value = this.playerShirtBeforeCustomization;
        player.pantsItem.Value = this.playerPantsBeforeCustomization;
        if (this.playerNameBeforeCustomization is not null)
        {
            player.Name = this.playerNameBeforeCustomization;
            player.displayName = this.playerDisplayNameBeforeCustomization ?? this.playerNameBeforeCustomization;
        }
        if (this.playerFavoriteThingBeforeCustomization is not null) player.favoriteThing.Value = this.playerFavoriteThingBeforeCustomization;
        player.isCustomized.Value = this.playerCustomizedBeforeCustomization;
        player.FarmerRenderer.MarkSpriteDirty();
        this.playerAppearanceBeforeCustomization = null;
        this.previousCompanionAppearance = null;
        this.playerShirtBeforeCustomization = null;
        this.playerPantsBeforeCustomization = null;
        this.playerNameBeforeCustomization = null;
        this.playerDisplayNameBeforeCustomization = null;
        this.playerFavoriteThingBeforeCustomization = null;
    }
}
