using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DSHPlayer2.Core;

/// <summary>
/// The receipt-backed history a live social turn carries (P2-0015 T0.3): the
/// newest readable receipt, yesterday's shared outcome as the one citable
/// memory, and an honest count of receipt files that could not be read.
/// </summary>
public sealed record SocialMemoryContext(
    NativeSharedOutcomeMemory? PriorMemory,
    BridgeActionReceipt? LatestReceipt,
    int SkippedReceipts)
{
    public static readonly SocialMemoryContext Empty = new(null, null, 0);
}

/// <summary>
/// Projects the session's persisted receipts into social-turn memory. Game-free:
/// the receipts directory is the fact source, a damaged file is skipped and
/// counted, and nothing here ever blocks a chat turn.
/// </summary>
public static class SocialMemory
{
    /// <summary>Newest receipt files inspected per turn; mirrors the recall digest window.</summary>
    public const int MaxScannedReceipts = 8;

    public const int MaxSummaryLength = 400;

    private static readonly Regex ReceiptName = new(@"^receipt-(\d+)\.json$", RegexOptions.CultureInvariant);
    private static readonly HashSet<string> ReceiptStatuses = new(StringComparer.Ordinal) { "completed", "failed", "declined", "expired" };
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    /// <summary>
    /// Builds the memory context for one social turn. <paramref name="lastOutcome"/>
    /// is the farmer-owned shared outcome; it becomes <c>priorMemory</c> only when
    /// it belongs to the day before <paramref name="currentDay"/> (0-based total
    /// days, as in <see cref="WorldSnapshot.Day"/>) and a matching receipt exists.
    /// </summary>
    public static SocialMemoryContext Load(string sessionDirectory, SharedOutcome? lastOutcome, int currentDay)
    {
        if (string.IsNullOrWhiteSpace(sessionDirectory)) return SocialMemoryContext.Empty;
        var directory = Path.Combine(sessionDirectory, "receipts");
        if (!Directory.Exists(directory)) return SocialMemoryContext.Empty;

        var sequences = new List<int>();
        foreach (var path in Directory.EnumerateFiles(directory))
        {
            var match = ReceiptName.Match(Path.GetFileName(path));
            if (match.Success && int.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var sequence))
            {
                sequences.Add(sequence);
            }
        }
        sequences.Sort((a, b) => b.CompareTo(a));

        var receipts = new List<(int Sequence, BridgeActionReceipt Receipt)>();
        var skipped = 0;
        foreach (var sequence in sequences.Take(MaxScannedReceipts))
        {
            var receipt = TryRead(Path.Combine(directory, $"receipt-{sequence}.json"));
            if (receipt is null) skipped++;
            else receipts.Add((sequence, receipt));
        }

        var latest = receipts.Count == 0 ? null : receipts[0].Receipt;
        var yesterday = Player2Rules.GetYesterdayOutcome(lastOutcome, currentDay);
        NativeSharedOutcomeMemory? prior = null;
        if (yesterday is not null && yesterday.Status is ("completed" or "failed"))
        {
            foreach (var (sequence, receipt) in receipts)
            {
                if (receipt.Status != yesterday.Status || receipt.Scope != yesterday.Scope) continue;
                prior = new NativeSharedOutcomeMemory(
                    $"memory-receipt-{sequence}",
                    receipt.ProposalId,
                    checked(yesterday.Day + 1),
                    receipt.OccurredAt,
                    receipt.Status,
                    receipt.Target,
                    receipt.Scope,
                    Summarize(receipt));
                break;
            }
        }
        return new SocialMemoryContext(prior, latest, skipped);
    }

    /// <summary>Validates the memory fields of a social turn at the Player writer boundary.</summary>
    public static void ValidateContext(NativeSharedOutcomeMemory? priorMemory, BridgeActionReceipt? latestReceipt)
    {
        if (priorMemory is not null)
        {
            if (string.IsNullOrWhiteSpace(priorMemory.Id) || string.IsNullOrWhiteSpace(priorMemory.SourceProposalId) || string.IsNullOrWhiteSpace(priorMemory.Scope))
                throw new InvalidOperationException("A social prior memory requires an id, a source proposal, and a scope.");
            if (priorMemory.GameDay < 1)
                throw new InvalidOperationException("A social prior memory requires a positive game day.");
            if (priorMemory.Status is not ("completed" or "failed"))
                throw new InvalidOperationException("Only a completed or failed shared outcome may become social memory.");
            var summary = priorMemory.Summary?.Trim() ?? string.Empty;
            if (summary.Length == 0 || summary.Length > MaxSummaryLength)
                throw new InvalidOperationException($"A social prior memory summary must contain 1 to {MaxSummaryLength} characters.");
            if (!IsTimestamp(priorMemory.OccurredAt))
                throw new InvalidOperationException("A social prior memory requires an ISO occurredAt timestamp.");
        }
        if (latestReceipt is not null && !IsValid(latestReceipt))
        {
            throw new InvalidOperationException("The social latest receipt does not satisfy the receipt contract.");
        }
    }

    private static string Summarize(BridgeActionReceipt receipt)
    {
        var detail = receipt.Detail.Trim();
        if (detail.Length == 0) detail = $"{receipt.Status}: {receipt.Scope}";
        return detail.Length > MaxSummaryLength ? detail[..MaxSummaryLength] : detail;
    }

    private static BridgeActionReceipt? TryRead(string path)
    {
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists || info.Length > DecisionBridgeFiles.MaxFileBytes) return null;
            var receipt = JsonSerializer.Deserialize<BridgeActionReceipt>(File.ReadAllBytes(path), JsonOptions);
            return receipt is not null && IsValid(receipt) ? receipt : null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or NotSupportedException)
        {
            return null;
        }
    }

    private static bool IsValid(BridgeActionReceipt receipt)
    {
        return !string.IsNullOrWhiteSpace(receipt.ProposalId)
            && !string.IsNullOrWhiteSpace(receipt.CapabilityId)
            && ReceiptStatuses.Contains(receipt.Status ?? string.Empty)
            && !string.IsNullOrWhiteSpace(receipt.Scope)
            && !string.IsNullOrWhiteSpace(receipt.Detail)
            && IsTimestamp(receipt.OccurredAt);
    }

    private static bool IsTimestamp(string? value)
    {
        return !string.IsNullOrWhiteSpace(value)
            && DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _);
    }
}
