using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace DSHPlayer2.Core;

/// <summary>What one intake pass applied, plus every proposal it refused and why.</summary>
public sealed record CompanionGrowthIntakeResult(BridgeGrowthAsset? Asset, int Applied, IReadOnlyList<string> Errors);

/// <summary>
/// Applies the DSH-authored growth proposals a session has accumulated — decision
/// reflect proposals (<c>outbox/growth-&lt;n&gt;.json</c>) and dream outcomes
/// (<c>outbox/dream-growth-&lt;n&gt;.json</c>) — in sequence order, through the
/// existing <see cref="CompanionGrowthStore"/> validation. A refused proposal
/// stays on disk as evidence and never blocks the rest of the pass.
/// </summary>
public static class CompanionGrowthIntake
{
    private static readonly Regex ProposalName = new(@"^(growth|dream-growth)-(\d+)\.json$", RegexOptions.CultureInvariant);

    public static async Task<CompanionGrowthIntakeResult> ConsumePendingAsync(string sessionDirectory, CancellationToken cancellationToken = default)
    {
        var store = new CompanionGrowthStore(sessionDirectory);
        var dream = new CompanionDreamBridge(sessionDirectory);
        var errors = new List<string>();
        var pending = new List<(int Sequence, string Kind)>();
        var outbox = Path.Combine(sessionDirectory, "outbox");
        if (Directory.Exists(outbox))
        {
            foreach (var path in Directory.EnumerateFiles(outbox))
            {
                var match = ProposalName.Match(Path.GetFileName(path));
                if (match.Success && int.TryParse(match.Groups[2].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var sequence) && sequence > 0)
                {
                    pending.Add((sequence, match.Groups[1].Value));
                }
            }
        }
        var applied = 0;
        foreach (var (sequence, kind) in pending.OrderBy(item => item.Sequence))
        {
            try
            {
                if (kind == "growth")
                {
                    var proposal = await store.TryReadProposalAsync(sequence, cancellationToken).ConfigureAwait(false);
                    if (proposal is null) continue;
                    await store.ApplyProposalAsync(proposal, cancellationToken).ConfigureAwait(false);
                    await store.ClearProposalAsync(sequence).ConfigureAwait(false);
                }
                else
                {
                    var outcome = await dream.TryReadOutcomeAsync(sequence, cancellationToken).ConfigureAwait(false);
                    if (outcome?.Proposal is null) continue;
                    await dream.ConsumeAsync(outcome, store, cancellationToken).ConfigureAwait(false);
                }
                applied++;
            }
            catch (Exception error) when (error is InvalidDataException or InvalidOperationException or IOException or System.Text.Json.JsonException or ArgumentException)
            {
                errors.Add($"{kind}-{sequence}: {error.Message}");
            }
        }
        BridgeGrowthAsset? asset = null;
        try
        {
            asset = await store.TryLoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (InvalidDataException error)
        {
            errors.Add(error.Message);
        }
        return new CompanionGrowthIntakeResult(asset, applied, errors);
    }
}
