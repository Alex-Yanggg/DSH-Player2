using System;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using DSHPlayer2.Core;

namespace DSHPlayer2.DualHost;

/// <summary>
/// Headless stand-in for the SMAPI mod used by the unattended dual-end harness.
/// It runs the exact pure day cycle the mod runs — publish turn, poll request,
/// scripted consent, settlement — against a real bridge directory, then prints
/// one outcome JSON line and exits. Failures crash loudly on purpose: this tool
/// exists to surface cross-language contract drift, not to survive it.
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        var options = Options.Parse(args);
        using var host = new DecisionBridgeHost(options.Bridge, pollIntervalTicks: 1, Timeout.InfiniteTimeSpan);
        var self = Player2Rules.CreateFarmerSnapshot(
            "Alex",
            money: 1250,
            inventorySlotsUsed: 3,
            inventorySlotCapacity: 12,
            new[]
            {
                new InventoryItemSnapshot("Axe", 1),
                new InventoryItemSnapshot("Watering Can", 1),
                new InventoryItemSnapshot("Parsnip Seeds", 15),
            });
        var growthStore = new CompanionGrowthStore(options.Bridge);
        var growth = growthStore.TryLoadAsync().GetAwaiter().GetResult();
        var turn = DecisionBridgeRules.CreateTurn(AdapterProfile.StardewValley,
            new WorldSnapshot(options.Sequence, "rain", "Farm", self),
            options.Sequence,
            DecisionBridgeRules.TimestampNow(),
            targetTileX: 12,
            targetTileY: 8,
            yesterdayOutcome: null,
            growth: growth);
        host.Start(turn);

        var deadline = DateTime.UtcNow.AddSeconds(options.TimeoutSeconds);
        var settled = false;
        while (!settled)
        {
            if (DateTime.UtcNow > deadline)
            {
                Console.Error.WriteLine($"dualhost: timed out after {options.TimeoutSeconds}s waiting for the bridge cycle.");
                return 2;
            }

            var update = host.Update();
            if (update.Error is not null)
            {
                Console.Error.WriteLine($"dualhost: bridge failure: {update.Error}");
                return 1;
            }
            if (update.RecoveredReceipt is not null)
            {
                Console.Error.WriteLine("dualhost: unexpected recovered receipt; the bridge directory was not clean.");
                return 1;
            }
            if (update.Request is not null)
            {
                settled = options.Autonomy == AutonomyTier.Full
                    ? SettleAutonomously(host, turn, update.Request)
                    : SettleWithConsent(host, turn, update.Request, options);
            }
            Thread.Sleep(options.PollMilliseconds);
        }

        WaitPersisted(options, deadline);
        // Player-side growth consumption: validate and apply the turn's reflect
        // proposal when the DSH side wrote one, then clear the consumed file.
        int? appliedGrowthRevision = null;
        var growthProposal = growthStore.TryReadProposalAsync(options.Sequence).GetAwaiter().GetResult();
        if (growthProposal is not null)
        {
            var applied = growthStore.ApplyProposalAsync(growthProposal).GetAwaiter().GetResult();
            growthStore.ClearProposalAsync(options.Sequence).GetAwaiter().GetResult();
            appliedGrowthRevision = applied.Revision;
        }
        var receipt = new DecisionBridgeFiles(options.Bridge).TryReadReceiptAsync(options.Sequence).GetAwaiter().GetResult()
            ?? throw new InvalidOperationException("Settlement reported done but the receipt file is missing.");
        if (options.Autonomy == AutonomyTier.Full && receipt.Autonomy != DecisionBridgeRules.FullAutonomy)
        {
            throw new InvalidOperationException("An autonomous dual-end run must produce a receipt with the full-autonomy marker.");
        }
        Console.Out.WriteLine(JsonSerializer.Serialize(new Outcome(
            options.Sequence,
            receipt.Status,
            receipt,
            growth?.Revision,
            appliedGrowthRevision,
            "dualhost-ok")));
        return 0;
    }

    private static bool SettleWithConsent(DecisionBridgeHost host, DecisionTurnEnvelope turn, BridgeActionRequest request, Options options)
    {
        var decidedAt = DecisionBridgeRules.TimestampNow();
        var grant = DecisionBridgeRules.CreateGrant(
            request,
            options.Consent == ConsentChoice.Grant,
            decidedAt,
            DecisionBridgeRules.UtcTimestamp(DateTimeOffset.UtcNow.AddMinutes(5)));
        var authorization = DecisionBridgeRules.Authorize(turn, request, grant, decidedAt);
        var receipt = authorization.MayExecute
            ? DecisionBridgeRules.CompleteGranted(authorization, receiptShown: true, decidedAt).Receipt
            : authorization.TerminalReceipt ?? throw new InvalidOperationException("Denied authorization without a terminal receipt.");
        host.RecordSettlement(grant, receipt);
        return true;
    }

    /// <summary>Full-autonomy lane: validate, execute without consent, receipt with the autonomy marker, no grant file.</summary>
    private static bool SettleAutonomously(DecisionBridgeHost host, DecisionTurnEnvelope turn, BridgeActionRequest request)
    {
        var decidedAt = DecisionBridgeRules.TimestampNow();
        var authorization = DecisionBridgeRules.AuthorizeAutonomous(turn, request, decidedAt);
        var receipt = DecisionBridgeRules.CompleteGranted(
            authorization,
            receiptShown: true,
            decidedAt,
            DecisionBridgeRules.FullAutonomy).Receipt;
        host.RecordAutonomousSettlement(receipt);
        return true;
    }

    private static void WaitPersisted(Options options, DateTime deadline)
    {
        var receiptPath = Path.Combine(options.Bridge, "receipts", $"receipt-{options.Sequence}.json");
        while (!File.Exists(receiptPath))
        {
            if (DateTime.UtcNow > deadline)
            {
                throw new TimeoutException("Settlement persistence did not finish before the deadline.");
            }
            Thread.Sleep(options.PollMilliseconds);
        }
    }

    private sealed record Outcome(
        [property: JsonPropertyName("sequence")] int Sequence,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("receipt")] BridgeActionReceipt Receipt,
        [property: JsonPropertyName("envelopeGrowthRevision")] int? EnvelopeGrowthRevision,
        [property: JsonPropertyName("appliedGrowthRevision")] int? AppliedGrowthRevision,
        [property: JsonPropertyName("marker")] string Marker);

    private enum ConsentChoice
    {
        Grant,
        Decline,
    }

    private enum AutonomyTier
    {
        Consult,
        Full,
    }

    private sealed record Options(
        string Bridge,
        int Sequence,
        ConsentChoice Consent,
        AutonomyTier Autonomy,
        int TimeoutSeconds,
        int PollMilliseconds)
    {
        public static Options Parse(string[] args)
        {
            string? bridge = null;
            var sequence = 12;
            var consent = ConsentChoice.Grant;
            var autonomy = AutonomyTier.Consult;
            var timeoutSeconds = 40;
            var pollMilliseconds = 10;
            for (var index = 0; index < args.Length; index += 2)
            {
                var value = args[index + 1];
                switch (args[index])
                {
                    case "--bridge":
                        bridge = value;
                        break;
                    case "--sequence" when int.TryParse(value, out var parsed):
                        sequence = parsed;
                        break;
                    case "--consent" when Enum.TryParse<ConsentChoice>(value, ignoreCase: true, out var parsed):
                        consent = parsed;
                        break;
                    case "--autonomy" when Enum.TryParse<AutonomyTier>(value, ignoreCase: true, out var parsed):
                        autonomy = parsed;
                        break;
                    case "--timeout-seconds" when int.TryParse(value, out var parsed):
                        timeoutSeconds = parsed;
                        break;
                    case "--poll-millis" when int.TryParse(value, out var parsed):
                        pollMilliseconds = Math.Max(parsed, 1);
                        break;
                    default:
                        throw new ArgumentException($"Unknown or malformed argument pair at '{args[index]} {value}'.");
                }
            }
            if (string.IsNullOrWhiteSpace(bridge))
            {
                throw new ArgumentException("The dual host requires --bridge <directory>.");
            }
            return new Options(bridge, sequence, consent, autonomy, timeoutSeconds, pollMilliseconds);
        }
    }
}
