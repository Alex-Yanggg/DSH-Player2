using System;
using System.Collections.Generic;

namespace DSHPlayer2.Core;

/// <summary>Wraps mixed Chinese/Latin chat without falling back to a distant speaker space.</summary>
public static class ChatTextLayout
{
    public static IEnumerable<string> Wrap(string text, float maxWidth, Func<string, float> measure)
    {
        foreach (var paragraph in text.Replace("\r", "").Split('\n'))
        {
            var remaining = paragraph;
            while (remaining.Length > 0 && measure(remaining) > maxWidth)
            {
                var take = remaining.Length;
                while (take > 1 && measure(remaining[..take]) > maxWidth) take--;
                if (take < remaining.Length && char.IsHighSurrogate(remaining[take - 1]))
                    take = take == 1 ? 2 : take - 1;
                var space = remaining.LastIndexOf(' ', Math.Min(take - 1, remaining.Length - 1));
                if (space >= take / 2 && space > 0) take = space;
                yield return remaining[..take];
                remaining = remaining[take..].TrimStart();
            }
            yield return remaining;
        }
    }
}
