using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using DSHPlayer2.Core;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using StardewValley.Menus;
using StardewValley.Objects;
using Player2Proposal = DSHPlayer2.Core.Proposal;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The SMAPI adapter: wires game events to the extracted collaborators and
/// keeps every game-touching flow here while process hosting, snapshots,
/// receipts, transcripts, settlement, and diagnostics live in their own
/// testable types.
/// </summary>
internal sealed class ModEntry : Mod
{
    private const string AcceptProposalId = "dsh-player2-accept";
    private const string DeclineProposalId = "dsh-player2-decline";
    private const string CompanionChoiceIdPrefix = "dsh-player2-companion-";

    private ModConfig config = new();
    private DshProcessSupervisor supervisor = null!;
    private DecisionBridgeHost? bridgeHost;
    private ChatTranscript? transcript;
    private DecisionTurnEnvelope? activeBridgeTurn;
    private BridgeActionRequest? activeBridgeRequest;
    private BridgeActionRequest? pendingBridgeRequest;
    private Player2Proposal? pendingBridgeProposal;
    private Player2Proposal? activeProposal;
    private WorldSnapshot? pendingChoiceSnapshot;
    private WorldSnapshot? pendingAppearanceSnapshot;
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
    private SocialBridgeHost? socialBridgeHost;
    private int socialTurnCounter;
    private WorldSnapshot? pendingDaySnapshot;
    private CompanionChoice? pendingDayCompanion;
    private string? pendingSocialMessage;
    private DateTimeOffset? pendingDayDeadline;
    private DateTimeOffset? pendingSocialDeadline;
    private bool chatHintPending;
    private string? movementTraceId;

    /// <summary>Registers the first semantic game event used by Player2.</summary>
    /// <param name="helper">The SMAPI helper for the loaded mod.</param>
    public override void Entry(IModHelper helper)
    {
        this.config = helper.ReadConfig<ModConfig>();
        this.Monitor.Log("Player2 native companion movement + fast social bridge (P2-0013B).", LogLevel.Info);
        this.config.ValidateRequiredCompanionSouls();
        var configChanged = false;
        // Old config files predate the DSH-owned default.  Migrate them once
        // instead of presenting a false "not configured" state.
        if (string.IsNullOrWhiteSpace(this.config.DecisionBridgeDirectory))
        {
            this.config.DecisionBridgeDirectory = ModConfig.DefaultBridgeDirectory();
            configChanged = true;
        }
        if (configChanged)
        {
            helper.WriteConfig(this.config);
        }
        this.TryMigrateLegacyBridgeLayout();
        this.supervisor = new DshProcessSupervisor(this.config, this.Monitor);
        this.supervisor.EnsureStarted();
        helper.Events.GameLoop.DayStarted += this.OnDayStarted;
        helper.Events.GameLoop.DayEnding += this.OnDayEnding;
        helper.Events.GameLoop.GameLaunched += this.OnGameLaunched;
        helper.Events.GameLoop.UpdateTicked += this.OnUpdateTicked;
        helper.Events.GameLoop.ReturnedToTitle += this.OnReturnedToTitle;
        helper.Events.Input.ButtonPressed += this.OnButtonPressed;
        ReceiptRenderer.ResolveName = this.ResolveCompanionName;
        ReceiptRenderer.MovementReport = this.OnMovementReported;
        helper.Events.GameLoop.Saving += (_, _) => ReceiptRenderer.DetachForSave();
        helper.Events.GameLoop.Saved += (_, _) => ReceiptRenderer.RestoreAfterSave();
        helper.Events.Player.Warped += (_, e) =>
        {
            if (e.IsLocalPlayer && ReceiptRenderer.ActiveCompanion?.Following == true)
            {
                if (!ReceiptRenderer.ActiveCompanion.Command("follow")) this.OnMovementReported("failed", "path-blocked");
            }
        };
        AppDomain.CurrentDomain.ProcessExit += this.OnProcessExit;
    }

    /// <summary>Opens the text-only companion input without blocking the game loop on a model response.</summary>
    private void OnButtonPressed(object? sender, ButtonPressedEventArgs e)
    {
        if (Context.IsWorldReady && e.Button == this.config.CustomizeCompanionKey)
        {
            this.Helper.Input.Suppress(e.Button);
            if (this.ResolveCompanionChoice() is null)
            {
                Game1.addHUDMessage(new HUDMessage(this.T("appearance.choose-first")));
                return;
            }
            this.RequestCompanionCustomization(null);
            return;
        }
        if (Context.IsWorldReady && e.Button == this.config.RetryDayKey)
        {
            this.TryRetryCompanionDay();
            return;
        }
        if (e.Button != this.config.ChatKey || !Context.IsWorldReady)
        {
            return;
        }
        if (Game1.activeClickableMenu is CompanionChatMenu chatMenu)
        {
            this.Helper.Input.Suppress(e.Button);
            chatMenu.exitThisMenu();
            return;
        }
        if (!Context.IsPlayerFree || Game1.activeClickableMenu is not null)
        {
            return;
        }
        // The social lane has exactly one tenant: the host farmer. A farmhand
        // client never pumps the social bridge, so its turns would hang until
        // the timeout; refuse up front instead of half-working.
        if (!Context.IsMainPlayer)
        {
            Game1.addHUDMessage(new HUDMessage(this.T("chat.host-only")));
            this.Monitor.Log("Player2 refused a farmhand social turn; only the main player owns the social lane.", LogLevel.Info);
            return;
        }

        this.transcript ??= CompanionTranscriptStore.Load(this.Helper, this.Monitor);
        Game1.activeClickableMenu = new CompanionChatMenu(
            this.transcript,
            Game1.player.Name,
            this.OnSocialMessageSubmitted,
            this.IsSocialTurnPending,
            this.T("chat.title", new { name = this.ResolveCompanionName() }),
            key => this.T(key));
    }

    /// <summary>Resolves one SMAPI translation key for the current game language.</summary>
    private string T(string key, object? tokens = null)
    {
        return this.Helper.Translation.Get(key, tokens).ToString();
    }

    private void OnGameLaunched(object? sender, GameLaunchedEventArgs e)
    {
        var menu = this.Helper.ModRegistry.GetApi<IGenericModConfigMenuApi>("spacechase0.GenericModConfigMenu");
        if (menu is null)
        {
            this.Monitor.Log("Generic Mod Config Menu is not installed; Player2 settings remain available through config.json and hotkeys.", LogLevel.Info);
            return;
        }
        menu.Register(
            this.ModManifest,
            reset: () =>
            {
                var defaults = new ModConfig();
                this.config.AllowCheatCapabilities = defaults.AllowCheatCapabilities;
                this.config.ChatKey = defaults.ChatKey;
                this.config.RetryDayKey = defaults.RetryDayKey;
                this.config.CustomizeCompanionKey = defaults.CustomizeCompanionKey;
            },
            save: () => this.Helper.WriteConfig(this.config));
        menu.AddSectionTitle(this.ModManifest, () => this.T("config.permissions.title"));
        menu.AddBoolOption(
            this.ModManifest,
            () => this.config.AllowCheatCapabilities,
            value => this.config.AllowCheatCapabilities = value,
            () => this.T("config.allow-cheats.name"),
            () => this.T("config.allow-cheats.tooltip"),
            "allow-cheat-capabilities");
        menu.AddParagraph(this.ModManifest, () => this.T("config.allow-cheats.note"));
        menu.AddSectionTitle(this.ModManifest, () => this.T("config.controls.title"));
        menu.AddKeybind(
            this.ModManifest,
            () => this.config.ChatKey,
            value => this.config.ChatKey = value,
            () => this.T("config.chat-key.name"),
            () => this.T("config.chat-key.tooltip"),
            "chat-key");
        menu.AddKeybind(
            this.ModManifest,
            () => this.config.RetryDayKey,
            value => this.config.RetryDayKey = value,
            () => this.T("config.retry-key.name"),
            () => this.T("config.retry-key.tooltip"),
            "retry-day-key");
        menu.AddKeybind(
            this.ModManifest,
            () => this.config.CustomizeCompanionKey,
            value => this.config.CustomizeCompanionKey = value,
            () => this.T("config.customize-key.name"),
            () => this.T("config.customize-key.tooltip"),
            "customize-companion-key");
    }

    private void RequestCompanionCustomization(WorldSnapshot? resumeDay)
    {
        if (this.activeAppearanceMenu is not null || this.appearanceCustomizationRequested)
        {
            return;
        }
        this.pendingAppearanceSnapshot = resumeDay;
        this.appearanceCustomizationRequested = true;
        this.Monitor.Log("Player2 queued Stardew Valley's native character customization for the companion.", LogLevel.Info);
    }

    private void TryOpenCompanionCustomization()
    {
        if (!this.appearanceCustomizationRequested ||
            this.activeAppearanceMenu is not null ||
            !Context.IsPlayerFree ||
            Game1.activeClickableMenu is not null)
        {
            return;
        }

        var player = Game1.player;
        this.playerAppearanceBeforeCustomization = CompanionAppearance.Capture(player);
        this.previousCompanionAppearance = CompanionAppearanceStore.Load(player, this.Monitor);
        this.playerShirtBeforeCustomization = player.shirtItem.Value;
        this.playerPantsBeforeCustomization = player.pantsItem.Value;
        this.playerNameBeforeCustomization = player.Name;
        this.playerDisplayNameBeforeCustomization = player.displayName;
        this.playerFavoriteThingBeforeCustomization = player.favoriteThing.Value;
        this.playerCustomizedBeforeCustomization = player.isCustomized.Value;
        try
        {
            // The vanilla menu edits Game1.player. Temporarily present the
            // companion body, then restore every player-owned field on exit.
            player.shirtItem.Value = null;
            player.pantsItem.Value = null;
            (this.previousCompanionAppearance ?? this.playerAppearanceBeforeCustomization).Apply(player);
            var menu = new CharacterCustomization(CharacterCustomization.Source.Wizard);
            menu.exitFunction = () => this.CompleteCompanionCustomization(save: true);
            this.activeAppearanceMenu = menu;
            this.appearanceCustomizationRequested = false;
            Game1.activeClickableMenu = menu;
        }
        catch (Exception ex)
        {
            this.RestorePlayerAfterCustomization();
            this.appearanceCustomizationRequested = false;
            this.Monitor.Log($"Player2 could not open native companion customization: {ex.Message}", LogLevel.Error);
            Game1.addHUDMessage(new HUDMessage(this.T("appearance.failed")));
        }
    }

    private void CompleteAppearanceIfMenuWasClosed()
    {
        if (this.activeAppearanceMenu is not null && !ReferenceEquals(Game1.activeClickableMenu, this.activeAppearanceMenu))
        {
            this.CompleteCompanionCustomization(save: true);
        }
    }

    private void CompleteCompanionCustomization(bool save)
    {
        if (this.activeAppearanceMenu is null)
        {
            return;
        }
        var customized = save ? CompanionAppearance.Capture(Game1.player) : null;
        this.RestorePlayerAfterCustomization();
        this.activeAppearanceMenu = null;
        if (customized is not null)
        {
            CompanionAppearanceStore.Save(Game1.player, customized);
            ReceiptRenderer.ActiveCompanion?.ApplyAppearance(customized);
            Game1.addHUDMessage(new HUDMessage(this.T("appearance.saved", new { name = this.ResolveCompanionName() })));
            this.Monitor.Log($"Player2 saved the vanilla farmer appearance for companion {this.ResolveCompanionName()}.", LogLevel.Info);
        }
        var snapshot = this.pendingAppearanceSnapshot;
        this.pendingAppearanceSnapshot = null;
        if (customized is not null && snapshot is not null && this.ResolveCompanionChoice() is { } companion)
        {
            this.QueueCompanionDay(snapshot, companion);
        }
    }

    private void CancelAppearanceCustomization()
    {
        if (this.activeAppearanceMenu is not null)
        {
            this.RestorePlayerAfterCustomization();
            this.activeAppearanceMenu = null;
        }
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
        if (this.playerFavoriteThingBeforeCustomization is not null)
        {
            player.favoriteThing.Value = this.playerFavoriteThingBeforeCustomization;
        }
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

    private void OnMovementReported(string status, string detail)
    {
        var trace = this.movementTraceId ?? "presence";
        this.AppendDevelopmentLog("COMPANION_MOVEMENT_" + status.ToUpperInvariant(), detail, trace);
        this.Monitor.Log($"Player2 native companion movement {status}: {detail}; trace={trace}.", status == "failed" ? LogLevel.Warn : LogLevel.Info);
        if (status != "started")
            Game1.addHUDMessage(new HUDMessage(this.T("movement." + detail, new { name = this.ResolveCompanionName() })));
    }

    /// <summary>
    /// Grants a same-day retry entry after a failed day turn. A day whose
    /// receipt recorded a completed shared outcome never retries; the
    /// consent flow itself always stays in place.
    /// </summary>
    private void TryRetryCompanionDay()
    {
        if (!Context.IsMainPlayer || !Context.IsPlayerFree || Game1.activeClickableMenu is not null)
        {
            return;
        }
        var gameDay = Game1.Date.TotalDays + 1;
        if (this.pendingDaySnapshot is not null || this.activeBridgeTurn is not null || this.pendingBridgeRequest is not null)
        {
            this.Monitor.Log("Player2 day turn retry ignored; a turn is already in flight.", LogLevel.Info);
            return;
        }
        if (!CompanionSettlementStore.IsGameDaySettled(new ModDataState(Game1.player.modData), gameDay))
        {
            this.Monitor.Log("Player2 day turn retry ignored; today's turn is not settled, so it is still running or was never started.", LogLevel.Info);
            return;
        }
        var outcome = this.ReadState<SharedOutcome>(Game1.player, Player2Rules.LastSharedOutcomeStateKey);
        if (outcome?.Version == Player2Rules.StateVersion && outcome.Day == Game1.Date.TotalDays && outcome.Status == "completed")
        {
            Game1.addHUDMessage(new HUDMessage(this.T("retry.completed", new { day = gameDay })));
            return;
        }
        CompanionSettlementStore.ClearSettlement(new ModDataState(Game1.player.modData));
        var snapshot = WorldSnapshotBuilder.Capture();
        var companion = this.ResolveCompanionChoice();
        if (companion is null)
        {
            this.ShowCompanionChoice(snapshot);
            return;
        }
        if (CompanionAppearanceStore.Load(Game1.player, this.Monitor) is null)
        {
            this.RequestCompanionCustomization(snapshot);
            return;
        }
        this.Monitor.Log($"Player2 retry entry re-opens the settled game day {gameDay} after a non-completed outcome.", LogLevel.Info);
        this.QueueCompanionDay(snapshot, companion);
    }

    /// <summary>Publishes one message to native DSH; this host never invents a reply.</summary>
    private bool OnSocialMessageSubmitted(string message)
    {
        var transcript = this.transcript ??= new ChatTranscript();
        if (this.IsSocialTurnPending())
        {
            Game1.addHUDMessage(new HUDMessage(this.T("chat.waiting")));
            this.Monitor.Log("Player2 kept the unsent chat draft because a native DSH reply is still pending.", LogLevel.Info);
            return false;
        }
        transcript.Append(Game1.player.Name, message);
        CompanionTranscriptStore.Save(this.Helper, transcript, this.Monitor);
        if (!this.supervisor.IsReady)
        {
            this.pendingSocialMessage = message;
            this.pendingSocialDeadline = DateTimeOffset.UtcNow + this.config.EffectiveDshStartupTimeout();
            Game1.addHUDMessage(new HUDMessage(this.T("chat.starting")));
            this.Monitor.Log("Player2 queued the chat message while the native DSH bundle finishes loading.", LogLevel.Info);
            return true;
        }
        this.PublishSocialMessage(message);
        return true;
    }

    private bool IsSocialTurnPending()
    {
        return this.socialBridgeHost is not null || this.pendingSocialMessage is not null;
    }

    /// <summary>Publishes a message only after the DSH bundle heartbeat is fresh.</summary>
    private void PublishSocialMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(this.config.DecisionBridgeDirectory))
        {
            this.ReportNativeDshFailure("DSH_NOT_CONFIGURED", "DecisionBridgeDirectory is empty; native DSH cannot receive this F2 turn.", null);
            return;
        }
        var companion = this.ResolveCompanionChoice();
        if (companion is null)
        {
            this.ReportNativeDshFailure("COMPANION_NOT_CREATED", "Create a companion before opening a DSH social turn.", null);
            return;
        }
        var snapshot = WorldSnapshotBuilder.Capture();
        var id = Guid.NewGuid().ToString();
        var now = DecisionBridgeRules.TimestampNow();
        var self = snapshot.Self ?? throw new InvalidOperationException("World snapshot was missing the farmer facts required for a social turn.");
        var actor = ReceiptRenderer.ActiveCompanion;
        var presentHere = actor?.currentLocation == Game1.currentLocation;
        var companionFacts = new NativeCompanionFacts(presentHere, actor?.currentLocation?.NameOrUniqueName,
            actor?.MovementState ?? "absent", presentHere ? Microsoft.Xna.Framework.Vector2.Distance(actor!.Tile, Game1.player.Tile) : null);
        var turn = new NativeSocialBridgeTurn(
            "0.0.9", id, now, checked(snapshot.Day + 1), new NativeCompanionIdentity(companion.Name, companion.Role, ToBridgeSoul(companion)),
            new NativeAdapterDescriptor("stardew-smapi", "stardew-valley", "semantic", Array.Empty<object>()),
            new[]
            {
                new NativeObservation($"world-{snapshot.Day}-{id}", "world", now, null, "stardew-smapi", "semantic", 1d, new NativeWorldFacts(snapshot.Weather, snapshot.Location, companionFacts)),
                new NativeObservation($"self-{snapshot.Day}-{id}", "self", now, null, "stardew-smapi", "semantic", 1d, new NativeSelfFacts(
                    self.Name,
                    self.Money,
                    self.InventorySlotsUsed,
                    self.InventorySlotCapacity,
                    self.Items.Select(item => new NativeInventoryItemFact(item.Name, item.Count)).ToArray(),
                    self.InventoryTruncated)),
            },
            null, null, new NativePlayerMessage($"message-{++this.socialTurnCounter}-{id}", message, now), CompanionMovement.ParseCommand(message));
        try
        {
            this.socialBridgeHost = new SocialBridgeHost(this.SessionBridgeRoot(companion), Math.Min(6, this.config.PollIntervalTicks), this.config.EffectiveRequestTimeout());
            this.socialBridgeHost.Start(turn);
            this.Monitor.Log($"Player2 published native DSH social turn social:{id}.", LogLevel.Info);
        }
        catch (Exception ex)
        {
            this.socialBridgeHost?.Dispose();
            this.socialBridgeHost = null;
            this.ReportNativeDshFailure("DSH_SOCIAL_BRIDGE_START_FAILED", ex.Message, $"social:{id}");
        }
    }

    /// <summary>
    /// P2-0014: explicitly ending the game day is the only dream boundary.
    /// The mod publishes one write-once day-end request for the companion's
    /// dream lane; the Player growth store path consumes whatever the dream
    /// closed with, exactly like any other DSH-authored proposal.
    /// </summary>
    private void OnDayEnding(object? sender, DayEndingEventArgs e)
    {
        if (!Context.IsMainPlayer || this.ResolveCompanionChoice() is not { } companion)
        {
            return;
        }
        try
        {
            var sessionRoot = this.SessionBridgeRoot(companion);
            var sequence = new DecisionBridgeFiles(sessionRoot).NextAvailableSequence(DateTimeOffset.UtcNow);
            var request = DecisionBridgeRules.CreateDreamRequest(
                new BridgeCompanionIdentity(companion.Name, companion.Role, ToBridgeSoul(companion)),
                sequence,
                DecisionBridgeRules.TimestampNow(),
                checked(Game1.dayOfMonth + 1));
            new CompanionDreamBridge(sessionRoot).WriteRequestAsync(request).GetAwaiter().GetResult();
            this.Monitor.Log($"Player2 published dream request {sequence} for the ended game day.", LogLevel.Info);        }
        catch (Exception ex)
        {
            this.ReportNativeDshFailure("DSH_DREAM_REQUEST_FAILED", ex.Message, null);
        }
    }

    private void OnDayStarted(object? sender, DayStartedEventArgs e)
    {        if (!Context.IsMainPlayer)
        {
            this.Monitor.Log("Player2 is inactive because this player is not the main player.", LogLevel.Info);
            return;
        }

        var snapshot = WorldSnapshotBuilder.Capture();
        SocialBridgeHost.SweepStaleFiles(this.config.DecisionBridgeDirectory);
        this.ShowYesterdayRecall(Game1.player, snapshot.Day);
        this.Monitor.Log(
            $"Player2 snapshot: day {snapshot.Day}, weather {snapshot.Weather}, location {snapshot.Location}. No local task was inferred.",
            LogLevel.Info);
        this.Monitor.Log(
            "Player2 mod version "
            + this.ModManifest.Version
            + "; decision bridge "
            + $"attached to DSH at {this.config.DecisionBridgeDirectory}"
            + ".",
            LogLevel.Info);

        var companion = this.ResolveCompanionChoice();
        if (companion is null)
        {
            this.ShowCompanionChoice(snapshot);
            return;
        }
        if (CompanionAppearanceStore.Load(Game1.player, this.Monitor) is null)
        {
            this.RequestCompanionCustomization(snapshot);
            return;
        }
        if (string.IsNullOrWhiteSpace(this.config.DecisionBridgeDirectory))
        {
            this.ReportNativeDshFailure("DSH_NOT_CONFIGURED", "DecisionBridgeDirectory is empty; the day turn was not sent to native DSH.", null);
            return;
        }
        this.QueueCompanionDay(snapshot, companion);
    }

    /// <summary>Defers the day turn until the mounted Player2 DSH bundle proves it is alive.</summary>
    private void QueueCompanionDay(WorldSnapshot snapshot, CompanionChoice companion)
    {
        this.pendingDaySnapshot = snapshot;
        this.pendingDayCompanion = companion;
        this.pendingDayDeadline = DateTimeOffset.UtcNow + this.config.EffectiveDshStartupTimeout();
        this.chatHintPending = true;
        this.Monitor.Log("Player2 queued the day turn until the native DSH bundle publishes a fresh readiness heartbeat.", LogLevel.Info);
    }

    private void TryBeginPendingCompanionDay()
    {
        if (this.pendingDaySnapshot is null || this.pendingDayCompanion is null)
        {
            return;
        }
        if (!this.supervisor.IsReady)
        {
            if (this.pendingDayDeadline is { } deadline && DateTimeOffset.UtcNow > deadline)
            {
                this.pendingDaySnapshot = null;
                this.pendingDayCompanion = null;
                this.pendingDayDeadline = null;
                this.ReportNativeDshFailure(
                    "DSH_STARTUP_TIMEOUT",
                    "The Player2 DSH bundle did not publish a fresh readiness heartbeat before the startup deadline."
                    + (this.supervisor.AutoStartError is null ? string.Empty : $" Automatic startup also failed: {this.supervisor.AutoStartError}"),
                    null);
            }
            return;
        }
        this.pendingDayDeadline = null;

        var snapshot = this.pendingDaySnapshot;
        var companion = this.pendingDayCompanion;
        this.pendingDaySnapshot = null;
        this.pendingDayCompanion = null;
        this.BeginCompanionDay(snapshot, companion);
    }

    private void TryPublishPendingSocialMessage()
    {
        if (this.pendingSocialMessage is null)
        {
            return;
        }
        if (!this.supervisor.IsReady)
        {
            if (this.pendingSocialDeadline is { } deadline && DateTimeOffset.UtcNow > deadline)
            {
                this.pendingSocialMessage = null;
                this.pendingSocialDeadline = null;
                this.ReportNativeDshFailure(
                    "DSH_STARTUP_TIMEOUT",
                    "The queued chat message was not sent because the Player2 DSH bundle never became ready.",
                    null);
            }
            return;
        }
        this.pendingSocialDeadline = null;
        var message = this.pendingSocialMessage;
        this.pendingSocialMessage = null;
        this.PublishSocialMessage(message);
    }

    private void TryShowChatHint()
    {
        if (!this.chatHintPending || !Context.IsPlayerFree || Game1.activeClickableMenu is not null)
        {
            return;
        }
        this.chatHintPending = false;
        var hint = this.T("chat.hint", new { key = this.config.ChatKey.ToString() });
        Game1.addHUDMessage(new HUDMessage(hint));
        this.Monitor.Log(hint, LogLevel.Info);
    }

    /// <summary>
    /// Starts the day's proposal flow once a companion identity exists: the
    /// identity must be settled first because the bridge turn carries it.
    /// </summary>
    private void BeginCompanionDay(WorldSnapshot snapshot, CompanionChoice companion)
    {
        if (string.IsNullOrWhiteSpace(this.config.DecisionBridgeDirectory))
        {
            this.ReportNativeDshFailure("DSH_NOT_CONFIGURED", "DecisionBridgeDirectory is empty; the day turn was not sent to native DSH.", null);
            return;
        }
        var playerPosition = Game1.player.Position;
        var targetTileX = (int)(playerPosition.X / Game1.tileSize);
        var targetTileY = (int)(playerPosition.Y / Game1.tileSize);
        // Advertise an unoccupied engine-validated tile, not the player's feet.
        var neighbor = NativeCompanion.FindOpenTileNearPlayer();
        if (neighbor is null)
        {
            this.ReportNativeDshFailure("NO_COMPANION_SPACE", "No walkable companion tile near the player.", null);
            return;
        }
        targetTileX = neighbor.Value.X;
        targetTileY = neighbor.Value.Y;

        var gameDay = checked(snapshot.Day + 1);
        if (CompanionSettlementStore.IsGameDaySettled(new ModDataState(Game1.player.modData), gameDay))
        {
            this.Monitor.Log($"Player2 game day {gameDay} is already settled; no request will be replayed.", LogLevel.Info);
            return;
        }
        var sessionRoot = this.SessionBridgeRoot(companion);
        var sequence = CompanionSettlementStore.ResolveSequence(
            new ModDataState(Game1.player.modData),
            gameDay,
            () => new DecisionBridgeFiles(sessionRoot).NextAvailableSequence(DateTimeOffset.UtcNow));
        var yesterdayOutcome = Player2Rules.GetYesterdayOutcome(
            this.ReadState<SharedOutcome>(Game1.player, Player2Rules.LastSharedOutcomeStateKey),
            snapshot.Day);
        this.activeBridgeTurn = DecisionBridgeRules.CreateTurn(AdapterProfile.StardewValley,
            snapshot,
            sequence,
            DecisionBridgeRules.TimestampNow(),
            targetTileX,
            targetTileY,
            yesterdayOutcome,
            new BridgeCompanionIdentity(companion.Name, companion.Role, ToBridgeSoul(companion)));
        this.pendingBridgeRequest = null;
        this.pendingBridgeProposal = null;
        this.activeBridgeRequest = null;
        this.bridgeHost?.Dispose();
        try
        {
            this.bridgeHost = new DecisionBridgeHost(
                sessionRoot,
                this.config.PollIntervalTicks,
                this.config.EffectiveRequestTimeout());
            this.bridgeHost.Start(this.activeBridgeTurn);
        }
        catch (Exception ex)
        {
            this.bridgeHost = null;
            this.ReportNativeDshFailure("DSH_DECISION_BRIDGE_START_FAILED", ex.Message, $"decision:{sequence}");
            return;
        }
        this.Monitor.Log(
            $"Player2 published decision sequence {sequence} asynchronously and is waiting for DSH without blocking the game.",
            LogLevel.Info);
    }

    /// <summary>
    /// Resolves the player's companion choice: config pin first, then the
    /// farmer-owned stored choice. Null means no choice exists yet and the
    /// in-game dialog must ask.
    /// </summary>
    private CompanionChoice? ResolveCompanionChoice()
    {
        if (Game1.player.modData.TryGetValue(CompanionSettlementStore.CompanionChoiceKey, out var stored) &&
            !string.IsNullOrWhiteSpace(stored))
        {
            return this.FindOrAdoptCompanion(stored);
        }
        return null;
    }

    /// <summary>Returns the player-visible companion name, or the app voice when nothing is chosen yet.</summary>
    private string ResolveCompanionName()
    {
        return this.ResolveCompanionChoice()?.Name ?? "Player2";
    }

    private CompanionChoice FindOrAdoptCompanion(string name)
    {
        var match = this.config.CompanionChoices.FirstOrDefault(candidate =>
            string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase));
        return match ?? CompanionChoice.CreateWithDefaultSoul(name, this.T("companion.role.fallback"));
    }

    /// <summary>
    /// The bridge directory scoped to this person and this save: one project
    /// per companion person, one session per save inside it.
    /// </summary>
    private string SessionBridgeRoot(CompanionChoice companion)
    {
        return DecisionBridgeLayout.SessionDirectory(
            this.config.DecisionBridgeDirectory,
            companion.Name,
            DecisionBridgeLayout.SaveId(Game1.uniqueIDForThisGame));
    }

    /// <summary>
    /// Projects the required configured soul into the wire identity.
    /// </summary>
    private static BridgeCompanionSoul ToBridgeSoul(CompanionChoice companion)
    {
        if (!companion.HasCompleteSoul())
        {
            throw new InvalidOperationException($"Companion '{companion.Name}' requires values, bonds, voice, and boundaries before a turn can be published.");
        }
        var soul = new BridgeCompanionSoul(
            companion.SoulValues.ToArray(),
            companion.SoulBonds.ToArray(),
            companion.SoulVoice.Trim(),
            companion.SoulBoundaries.ToArray());
        DecisionBridgeRules.ValidateCompanionSoul(soul);
        return soul;
    }

    /// <summary>Asks once who the companion is; the answer starts the deferred day flow.</summary>
    private void ShowCompanionChoice(WorldSnapshot snapshot)
    {
        if (this.config.CompanionChoices.Count == 0)
        {
            this.Monitor.Log("Player2 companion roster is empty; using the first default.", LogLevel.Warn);
            this.config.CompanionChoices.Add(CompanionChoice.CreateWithDefaultSoul("Mira", "the player's candid farm partner"));
        }
        this.pendingChoiceSnapshot = snapshot;
    }

    private void TryShowPendingCompanionChoice()
    {
        if (this.pendingChoiceSnapshot is null || !Context.IsPlayerFree || Game1.activeClickableMenu is not null)
        {
            return;
        }
        var choices = this.config.CompanionChoices
            .OrderByDescending(choice => string.Equals(choice.Name, this.config.CompanionName, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        var responses = choices
            .Select((choice, index) => new Response(CompanionChoiceIdPrefix + index, choice.Name))
            .ToArray();
        this.config.CompanionChoices = choices.ToList();
        Game1.currentLocation.createQuestionDialogue(this.T("companion.choice.title"), responses, this.OnCompanionChosen);
    }

    private void OnCompanionChosen(Farmer farmer, string answer)
    {
        var snapshot = this.pendingChoiceSnapshot;
        this.pendingChoiceSnapshot = null;
        var index = answer.StartsWith(CompanionChoiceIdPrefix, StringComparison.Ordinal) &&
            int.TryParse(answer[CompanionChoiceIdPrefix.Length..], out var parsed)
                ? parsed
                : -1;
        var choice = index >= 0 && index < this.config.CompanionChoices.Count
            ? this.config.CompanionChoices[index]
            : this.config.CompanionChoices[0];
        Game1.player.modData[CompanionSettlementStore.CompanionChoiceKey] = choice.Name;
        this.Monitor.Log($"Player2 companion {choice.Name} was chosen and persists on this farmer.", LogLevel.Info);
        Game1.addHUDMessage(new HUDMessage(this.T("companion.chosen", new { name = choice.Name })));
        this.RequestCompanionCustomization(snapshot);
    }

    private void OnUpdateTicked(object? sender, UpdateTickedEventArgs e)
    {
        if (!Context.IsWorldReady || !Context.IsMainPlayer)
        {
            return;
        }
        this.supervisor.PollReadiness();
        this.CompleteAppearanceIfMenuWasClosed();
        this.TryShowPendingCompanionChoice();
        this.TryOpenCompanionCustomization();
        this.TryShowChatHint();
        this.TryBeginPendingCompanionDay();
        this.TryPublishPendingSocialMessage();
        this.UpdateSocialBridge();
        this.TryPresentPendingBridgeChoice();
        if (this.pendingBridgeRequest is not null || this.activeBridgeRequest is not null)
        {
            return;
        }
        if (this.bridgeHost is null)
        {
            return;
        }
        var update = this.bridgeHost.Update();
        if (update.Error is not null)
        {
            this.ReportNativeDshFailure("DSH_DECISION_TURN_FAILED", update.Error.Message, this.activeBridgeTurn is null ? null : $"decision:{this.activeBridgeTurn.Sequence}");
            this.ClearBridgeDay();
            return;
        }
        if (update.RecoveredReceipt is not null && this.activeBridgeTurn is not null)
        {
            CompanionSettlementStore.MarkSettled(new ModDataState(Game1.player.modData), this.activeBridgeTurn.Sequence, this.activeBridgeTurn.GameDay);
            this.Monitor.Log(
                $"Player2 recovered settled sequence {this.activeBridgeTurn.Sequence} from its {update.RecoveredReceipt.Status} receipt; it will not execute again.",
                LogLevel.Info);
            this.ClearBridgeDay();
            return;
        }
        if (update.Request is not null && this.activeBridgeTurn is not null)
        {
            var validated = DecisionBridgeRules.ValidateRequest(this.activeBridgeTurn, update.Request);
            if (update.Request.Status == DecisionBridgeRules.AutonomousStatus)
            {
                // Full-autonomy order: the composition was mounted with
                // companion.autonomy "full", so Player executes the grounded
                // order directly and receipts it — no consent dialogue exists
                // on this lane, and every outcome still lands in a receipt.
                this.ExecuteAutonomousRequest(update.Request, validated.GameProposal);
                return;
            }
            this.pendingBridgeRequest = update.Request;
            this.pendingBridgeProposal = validated.GameProposal;
            this.Monitor.Log(
                $"Player2 received grounded DSH proposal {update.Request.Proposal.Id}; it is awaiting native player consent.",
                LogLevel.Info);
        }
        this.TryPresentPendingBridgeChoice();
    }

    /// <summary>Executes one validated autonomous order through the same game-mechanics receipts as the consent lane.</summary>
    private void ExecuteAutonomousRequest(BridgeActionRequest request, Player2Proposal proposal)
    {
        var activeTurn = this.activeBridgeTurn ?? throw new InvalidOperationException("Bridge turn disappeared before autonomous settlement.");
        var now = DateTimeOffset.UtcNow;
        var authorization = DecisionBridgeRules.AuthorizeAutonomous(
            activeTurn,
            request,
            DecisionBridgeRules.UtcTimestamp(now));
        var receiptShown = ReceiptRenderer.Show(
            request,
            proposal,
            CompanionAppearanceStore.Load(Game1.player, this.Monitor),
            this.Monitor);
        var completion = DecisionBridgeRules.CompleteGranted(
            authorization,
            receiptShown,
            DecisionBridgeRules.TimestampNow(),
            DecisionBridgeRules.FullAutonomy);
        var receipt = completion.Receipt;
        this.SaveLocalState(Game1.player, completion.State);
        var sequence = activeTurn.Sequence;
        CompanionSettlementStore.MarkSettled(new ModDataState(Game1.player.modData), sequence, activeTurn.GameDay);
        this.bridgeHost?.RecordAutonomousSettlement(receipt);
        this.AppendDevelopmentLog(
            "AUTONOMOUS_ACTION_SETTLED",
            $"Autonomous order {receipt.ProposalId} settled as {receipt.Status}.",
            $"decision:{sequence}");
        Game1.addHUDMessage(new HUDMessage(this.T("receipt.autonomous", new
        {
            name = this.ResolveCompanionName(),
            status = this.T("status." + receipt.Status),
            target = proposal.LocationDisplayName,
        })));
        this.Monitor.Log(
            $"Player2 settled autonomous order {receipt.ProposalId} as {receipt.Status} (autonomy: full).",
            LogLevel.Info);
        this.ClearBridgeDay(keepHost: true);
    }

    private void TryPresentPendingBridgeChoice()
    {
        if (!Context.IsPlayerFree || Game1.activeClickableMenu is not null)
        {
            return;
        }
        if (this.pendingBridgeRequest is not null && this.pendingBridgeProposal is not null)
        {
            this.activeBridgeRequest = this.pendingBridgeRequest;
            this.activeProposal = this.pendingBridgeProposal;
            this.pendingBridgeRequest = null;
            this.pendingBridgeProposal = null;
            this.OpenProposalDialogue(this.activeProposal);
            return;
        }
    }

    /// <summary>Consumes only a completed native DSH social result; all other states are visible errors.</summary>
    private void UpdateSocialBridge()
    {
        if (this.socialBridgeHost is null)
        {
            return;
        }
        var update = this.socialBridgeHost.Update();
        if (update.Error is not null)
        {
            this.ReportNativeDshFailure("DSH_SOCIAL_TURN_FAILED", update.Error.Message, update.TraceId);
            this.socialBridgeHost.Dispose();
            this.socialBridgeHost = null;
            return;
        }
        if (update.Result is null)
        {
            return;
        }
        var transcript = this.transcript ??= new ChatTranscript();
        transcript.Append(this.ResolveCompanionName(), update.Result.Text ?? throw new InvalidOperationException("Native DSH social result was missing text."));
        var completedTurn = this.socialBridgeHost.Turn;
        if (completedTurn?.MovementCommand is { } command && command == CompanionMovement.ParseCommand(completedTurn.Message.Content))
        {
            this.movementTraceId = update.TraceId;
            if (!ReceiptRenderer.Command(command, CompanionAppearanceStore.Load(Game1.player, this.Monitor), this.Monitor))
                this.OnMovementReported("failed", "path-blocked");
        }
        CompanionTranscriptStore.Save(this.Helper, transcript, this.Monitor);
        this.Monitor.Log($"Player2 presented native DSH social result {update.TraceId}; session {update.Result.SessionId}.", LogLevel.Info);
        this.AppendDevelopmentLog("DSH_SOCIAL_TURN_COMPLETED", "Native DSH social response presented.", update.TraceId ?? throw new InvalidOperationException("Native DSH social result was missing trace id."));
        this.socialBridgeHost.Dispose();
        this.socialBridgeHost = null;
    }

    /// <summary>Every failure is a traced development error; nothing player-visible falls back to local templates.</summary>
    private void ReportNativeDshFailure(string code, string message, string? traceId)
    {
        var resolvedTraceId = traceId ?? $"host:{Guid.NewGuid():N}";
        this.Monitor.Log($"Player2 {code} trace={resolvedTraceId}: {message}", LogLevel.Error);
        this.AppendDevelopmentLog(code, message, resolvedTraceId);
        Game1.addHUDMessage(new HUDMessage(this.T("error.native-dsh", new { code, traceId = resolvedTraceId })));
    }

    private void AppendDevelopmentLog(string code, string message, string traceId)
    {
        if (string.IsNullOrWhiteSpace(this.config.DecisionBridgeDirectory))
        {
            return;
        }
        try
        {
            DevelopmentLogWriter.Append(
                this.config.DecisionBridgeDirectory,
                code,
                traceId,
                message,
                Context.IsWorldReady ? Game1.Date.TotalDays : null);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"Player2 could not persist development log {traceId}: {ex.Message}", LogLevel.Error);
        }
    }

    private void OnReturnedToTitle(object? sender, ReturnedToTitleEventArgs e)
    {
        this.ClearBridgeDay();
        this.activeProposal = null;
        this.pendingChoiceSnapshot = null;
        this.CancelAppearanceCustomization();
        this.pendingAppearanceSnapshot = null;
        this.appearanceCustomizationRequested = false;
        this.pendingDaySnapshot = null;
        this.pendingDayCompanion = null;
        this.pendingSocialMessage = null;
        this.pendingDayDeadline = null;
        this.pendingSocialDeadline = null;
        this.chatHintPending = false;
        this.supervisor.ResetForTitle();
        this.transcript = null;
        this.socialBridgeHost?.Dispose();
        this.socialBridgeHost = null;
        ReceiptRenderer.ClearPresence();
        this.movementTraceId = null;
    }

    private void OnProcessExit(object? sender, EventArgs e)
    {
        this.supervisor.StopOwnedProcess();
    }

    private void OpenProposalDialogue(Player2Proposal proposal)
    {
        var responses = new[]
        {
            new Response(AcceptProposalId, this.T("proposal.accept")),
            new Response(DeclineProposalId, this.T("proposal.decline")),
        };

        Game1.currentLocation.createQuestionDialogue(this.FormatProposal(proposal), responses, this.OnProposalAnswered);
    }

    /// <summary>Records the player's explicit response without changing gameplay state.</summary>
    /// <param name="farmer">The player who answered.</param>
    /// <param name="answer">The selected response identifier.</param>
    private void OnProposalAnswered(Farmer farmer, string answer)
    {
        var proposal = this.activeProposal;
        var bridgeRequest = this.activeBridgeRequest;
        this.activeProposal = null;
        this.activeBridgeRequest = null;

        if (proposal is null)
        {
            this.Monitor.Log("Player2 received a proposal response without an active proposal.", LogLevel.Warn);
            return;
        }

        if (bridgeRequest is not null && this.activeBridgeTurn is not null && this.bridgeHost is not null)
        {
            this.OnBridgeProposalAnswered(farmer, proposal, bridgeRequest, answer == AcceptProposalId);
            return;
        }

        this.ReportNativeDshFailure("NON_NATIVE_PROPOSAL_REJECTED", "A proposal reached the UI without a validated native DSH request.", null);
    }

    private string FormatProposal(Player2Proposal proposal)
    {
        return Player2Rules.FormatProposal(proposal);
    }

    private void OnBridgeProposalAnswered(
        Farmer farmer,
        Player2Proposal proposal,
        BridgeActionRequest request,
        bool accepted)
    {
        var now = DateTimeOffset.UtcNow;
        var grant = DecisionBridgeRules.CreateGrant(
            request,
            accepted,
            DecisionBridgeRules.UtcTimestamp(now),
            DecisionBridgeRules.UtcTimestamp(now.AddMinutes(5)));
        var authorization = DecisionBridgeRules.Authorize(
            this.activeBridgeTurn ?? throw new InvalidOperationException("Bridge turn disappeared before settlement."),
            request,
            grant,
            DecisionBridgeRules.UtcTimestamp(now));
        BridgeActionReceipt receipt;
        if (!authorization.MayExecute)
        {
            receipt = authorization.TerminalReceipt
                ?? throw new InvalidOperationException("Terminal authorization has no receipt.");
            Game1.addHUDMessage(new HUDMessage(this.T("receipt.declined", new { name = this.ResolveCompanionName() })));
        }
        else
        {
            var receiptShown = ReceiptRenderer.Show(
                request,
                proposal,
                CompanionAppearanceStore.Load(Game1.player, this.Monitor),
                this.Monitor);
            var completion = DecisionBridgeRules.CompleteGranted(
                authorization,
                receiptShown,
                DecisionBridgeRules.TimestampNow());
            receipt = completion.Receipt;
            this.SaveLocalState(farmer, completion.State);
            Game1.addHUDMessage(new HUDMessage(this.T("receipt.bridge", new
            {
                name = this.ResolveCompanionName(),
                status = this.T("status." + receipt.Status),
                target = proposal.LocationDisplayName,
                scope = receipt.Scope,
            })));
        }

        var sequence = this.activeBridgeTurn.Sequence;
        CompanionSettlementStore.MarkSettled(
            new ModDataState(farmer.modData),
            sequence,
            this.activeBridgeTurn?.GameDay ?? throw new InvalidOperationException("Bridge turn disappeared before settlement."));
        this.bridgeHost?.RecordSettlement(grant, receipt);
        this.Monitor.Log(
            $"Player2 settled DSH decision sequence {sequence} as {receipt.Status}; granted: {grant.Granted}.",
            LogLevel.Info);
        this.ClearBridgeDay(keepHost: true);
    }

    private void ClearBridgeDay(bool keepHost = false)
    {
        if (!keepHost)
        {
            this.bridgeHost?.Dispose();
            this.bridgeHost = null;
        }
        this.activeBridgeTurn = null;
        this.activeBridgeRequest = null;
        this.pendingBridgeRequest = null;
        this.pendingBridgeProposal = null;
    }

    private void SaveLocalState(Farmer farmer, AcceptedState acceptedState)
    {
        farmer.modData[Player2Rules.CommitmentStateKey] = JsonSerializer.Serialize(acceptedState.Commitment);
        farmer.modData[Player2Rules.LastSharedOutcomeStateKey] = JsonSerializer.Serialize(acceptedState.Outcome);
    }

    private void ShowYesterdayRecall(Farmer farmer, int currentDay)
    {
        var commitment = this.ReadState<Commitment>(farmer, Player2Rules.CommitmentStateKey);
        var outcome = this.ReadState<SharedOutcome>(farmer, Player2Rules.LastSharedOutcomeStateKey);

        if (commitment?.Version == Player2Rules.StateVersion && outcome?.Version == Player2Rules.StateVersion)
        {
            this.Monitor.Log(
                $"Player2 local state: commitment day {commitment.Day}, latest outcome day {outcome.Day}.",
                LogLevel.Trace);
        }

        outcome = Player2Rules.GetYesterdayOutcome(outcome, currentDay);
        if (outcome is null)
        {
            return;
        }

        Game1.addHUDMessage(new HUDMessage(this.T("recall.yesterday", new
        {
            name = this.ResolveCompanionName(),
            status = this.T("status." + outcome.Status),
        })));
        this.Monitor.Log(
            $"Player2 recalled one prior outcome: day {outcome.Day}; target tile {outcome.TargetTileX}, {outcome.TargetTileY}; status {outcome.Status}.",
            LogLevel.Info);
    }

    /// <summary>
    /// Moves the pre-layout flat bridge lanes into the legacy session so old
    /// receipts and conversations survive the project/session layout. This
    /// runs before DSH starts so the host never scans a half-migrated root.
    /// </summary>
    private void TryMigrateLegacyBridgeLayout()
    {
        if (string.IsNullOrWhiteSpace(this.config.DecisionBridgeDirectory))
        {
            return;
        }
        try
        {
            DecisionBridgeLayout.MigrateLegacyRoot(this.config.DecisionBridgeDirectory);
        }
        catch (Exception ex)
        {
            this.Monitor.Log($"Player2 could not migrate the flat bridge layout: {ex.Message}", LogLevel.Error);
        }
    }

    private TState? ReadState<TState>(Farmer farmer, string key)
        where TState : class
    {
        if (!farmer.modData.TryGetValue(key, out var serialized))
        {
            return null;
        }
        try
        {
            return JsonSerializer.Deserialize<TState>(serialized);
        }
        catch (JsonException ex)
        {
            this.Monitor.Log($"Player2 ignored unreadable local state '{key}': {ex.Message}", LogLevel.Warn);
            return null;
        }
    }
}
