using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace DSHPlayer2.Core;

/// <summary>
/// The engineering file system that scopes every bridge file to one person
/// and one save: <c>&lt;bridge&gt;/projects/&lt;personId&gt;/sessions/&lt;saveId&gt;</c>.
/// One project directory is one companion person; each save is one session
/// inside it. This keeps conversations, receipts, and recall from leaking
/// across saves, and leaves room for a future real-time social transport to
/// swap the file read/write ends without touching the layout contract.
/// </summary>
public static class DecisionBridgeLayout
{
    /// <summary>The lane directories that live inside one session directory.</summary>
    public static readonly IReadOnlyList<string> SessionLanes = new[]
    {
        "inbox", "outbox", "drafts", "grants", "receipts", "social-inbox", "social-outbox",
    };

    /// <summary>Returns the session directory for one person and one save.</summary>
    public static string SessionDirectory(string bridgeRoot, string personName, string saveId)
    {
        var person = Slug(personName);
        var save = Slug(saveId);
        if (person.Length == 0 || save.Length == 0)
        {
            throw new ArgumentException("A session directory requires a non-empty person name and save id.");
        }
        return Path.Combine(bridgeRoot, "projects", person, "sessions", save);
    }

    /// <summary>
    /// Reduces a person name or save id to a safe single-path-segment id:
    /// lowercase alphanumerics and dashes, at most 64 characters.
    /// </summary>
    public static string Slug(string value)
    {
        var builder = new System.Text.StringBuilder();
        foreach (var character in value.Trim().ToLowerInvariant())
        {
            var isAsciiAlphanumeric = (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9');
            if (isAsciiAlphanumeric)
            {
                builder.Append(character);
            }
            else if (builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }
            if (builder.Length >= 64)
            {
                break;
            }
        }
        return builder.ToString().TrimEnd('-');
    }

    /// <summary>
    /// Moves the pre-layout flat lane directories into a synthetic
    /// <c>projects/legacy/sessions/legacy</c> session so old receipts and
    /// conversations survive the layout change. Idempotent: a root that is
    /// already migrated (or empty) is left untouched.
    /// </summary>
    public static void MigrateLegacyRoot(string bridgeRoot)
    {
        var legacyLanes = SessionLanes
            .Where(lane => Directory.Exists(Path.Combine(bridgeRoot, lane)))
            .ToList();
        if (legacyLanes.Count == 0)
        {
            return;
        }
        var legacySession = SessionDirectory(bridgeRoot, "legacy", "legacy");
        if (Directory.Exists(Path.Combine(legacySession, "inbox")))
        {
            throw new InvalidOperationException(
                "The bridge root contains both flat lane directories and a migrated legacy session; move them by hand.");
        }
        Directory.CreateDirectory(legacySession);
        foreach (var lane in legacyLanes)
        {
            Directory.Move(Path.Combine(bridgeRoot, lane), Path.Combine(legacySession, lane));
        }
    }

    /// <summary>
    /// Enumerates every session directory under the bridge root, newest first
    /// is not guaranteed; callers that care order the files themselves.
    /// </summary>
    public static IReadOnlyList<string> ListSessionDirectories(string bridgeRoot)
    {
        var projectsRoot = Path.Combine(bridgeRoot, "projects");
        if (!Directory.Exists(projectsRoot))
        {
            return Array.Empty<string>();
        }
        var sessions = new List<string>();
        foreach (var project in Directory.EnumerateDirectories(projectsRoot).OrderBy(path => path, StringComparer.Ordinal))
        {
            var sessionsRoot = Path.Combine(project, "sessions");
            if (!Directory.Exists(sessionsRoot))
            {
                continue;
            }
            sessions.AddRange(Directory.EnumerateDirectories(sessionsRoot).OrderBy(path => path, StringComparer.Ordinal));
        }
        return sessions;
    }

    /// <summary>Returns the session directory a bridge envelope belongs to, or null when the path is not a session file.</summary>
    public static string? SessionFromFilePath(string bridgeRoot, string filePath)
    {
        var root = Path.GetFullPath(bridgeRoot);
        var file = Path.GetFullPath(filePath);
        if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        var relative = file[root.Length..].TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var parts = relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return parts.Length >= 4 && parts[0] == "projects" && parts[2] == "sessions"
            ? Path.Combine(root, parts[0], parts[1], parts[2], parts[3])
            : null;
    }

    /// <summary>Formats a save id the way the layout expects it.</summary>
    public static string SaveId(ulong uniqueIdForThisGame)
    {
        return uniqueIdForThisGame.ToString(CultureInfo.InvariantCulture);
    }
}
