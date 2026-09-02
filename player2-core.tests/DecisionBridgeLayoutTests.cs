using System;
using System.IO;
using DSHPlayer2.Core;
using Xunit;

namespace DSHPlayer2.Core.Tests;

public sealed class DecisionBridgeLayoutTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), $"player2-layout-{Guid.NewGuid():N}");

    [Fact]
    public void BuildsOneSessionDirectoryPerPersonAndSave()
    {
        var session = DecisionBridgeLayout.SessionDirectory(@"C:\bridge", "Mira", DecisionBridgeLayout.SaveId(2718281828));

        Assert.EndsWith(Path.Combine("projects", "mira", "sessions", "2718281828"), session, StringComparison.Ordinal);
    }

    [Fact]
    public void SlugReducesNamesToSafePathSegments()
    {
        Assert.Equal("mira-v2", DecisionBridgeLayout.Slug("Mira v2!"));
        Assert.Equal("", DecisionBridgeLayout.Slug("???"));
        Assert.Equal(64, DecisionBridgeLayout.Slug(new string('a', 100)).Length);
    }

    [Fact]
    public void MigrationMovesFlatLanesIntoALegacySessionAndIsIdempotent()
    {
        Directory.CreateDirectory(Path.Combine(this.root, "inbox"));
        Directory.CreateDirectory(Path.Combine(this.root, "receipts"));
        File.WriteAllText(Path.Combine(this.root, "inbox", "turn-1.json"), "{}");
        File.WriteAllText(Path.Combine(this.root, "receipts", "receipt-1.json"), "{}");

        DecisionBridgeLayout.MigrateLegacyRoot(this.root);
        DecisionBridgeLayout.MigrateLegacyRoot(this.root);

        Assert.False(Directory.Exists(Path.Combine(this.root, "inbox")));
        var legacy = Path.Combine(this.root, "projects", "legacy", "sessions", "legacy");
        Assert.True(File.Exists(Path.Combine(legacy, "inbox", "turn-1.json")));
        Assert.True(File.Exists(Path.Combine(legacy, "receipts", "receipt-1.json")));
        Assert.Equal(new[] { legacy }, DecisionBridgeLayout.ListSessionDirectories(this.root));
    }

    [Fact]
    public void MigrationRefusesAConflictingLegacySession()
    {
        Directory.CreateDirectory(Path.Combine(this.root, "inbox"));
        var legacyInbox = Path.Combine(this.root, "projects", "legacy", "sessions", "legacy", "inbox");
        Directory.CreateDirectory(legacyInbox);

        Assert.Throws<InvalidOperationException>(() => DecisionBridgeLayout.MigrateLegacyRoot(this.root));
    }

    [Fact]
    public void ListsEverySessionAcrossProjectsInStableOrder()
    {
        foreach (var session in new[] { "projects/b/sessions/2", "projects/a/sessions/9", "projects/a/sessions/1" })
        {
            Directory.CreateDirectory(Path.Combine(this.root, session.Replace('/', Path.DirectorySeparatorChar)));
        }

        var sessions = DecisionBridgeLayout.ListSessionDirectories(this.root);

        Assert.Equal(
            new[]
            {
                Path.Combine(this.root, "projects", "a", "sessions", "1"),
                Path.Combine(this.root, "projects", "a", "sessions", "9"),
                Path.Combine(this.root, "projects", "b", "sessions", "2"),
            },
            sessions);
    }

    [Fact]
    public void SessionFromFilePathResolvesOnlyRealSessionFiles()
    {
        var session = Path.Combine(this.root, "projects", "mira", "sessions", "42");
        Directory.CreateDirectory(session);

        Assert.Equal(session, DecisionBridgeLayout.SessionFromFilePath(this.root, Path.Combine(session, "inbox", "turn-1.json")));
        Assert.Null(DecisionBridgeLayout.SessionFromFilePath(this.root, Path.Combine(this.root, "inbox", "turn-1.json")));
    }

    public void Dispose()
    {
        if (Directory.Exists(this.root)) Directory.Delete(this.root, true);
    }
}
