using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace DSHPlayer2.Core;

/// <summary>
/// Where one companion's save lives on disk:
/// <c>&lt;root&gt;/projects/&lt;person&gt;/sessions/&lt;save&gt;</c>. The folder is the
/// working directory of the save's DSH session; the companion's memory
/// ledger sits beside it in <c>projects/&lt;person&gt;/ledger</c>.
/// </summary>
public static class SessionLayout
{
    public static string SessionDirectory(string root, string personName, string saveId)
    {
        var person = Slug(personName);
        var save = Slug(saveId);
        if (person.Length == 0 || save.Length == 0)
        {
            throw new ArgumentException("A session directory requires a non-empty person name and save id.");
        }
        return Path.Combine(root, "projects", person, "sessions", save);
    }

    public static string SaveId(ulong uniqueIdForThisGame) => uniqueIdForThisGame.ToString(CultureInfo.InvariantCulture);

    /// <summary>Lowercase alphanumerics and dashes, at most 64 characters: one safe path segment.</summary>
    public static string Slug(string value)
    {
        var builder = new StringBuilder();
        foreach (var character in value.Trim().ToLowerInvariant())
        {
            if ((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9')) builder.Append(character);
            else if (builder.Length > 0 && builder[^1] != '-') builder.Append('-');
            if (builder.Length >= 64) break;
        }
        return builder.ToString().TrimEnd('-');
    }
}
