using System;
using System.Collections.Generic;

namespace DSHPlayer2.Core;

/// <summary>One speaker-attributed line in the companion chat history.</summary>
public sealed record ChatLine(string Speaker, string Text);

/// <summary>
/// A bounded, player-owned chat history for the companion text turn. The
/// newest lines stay in memory; the oldest fall off once the cap is reached
/// so a long save can never grow it without bound.
/// </summary>
public sealed class ChatTranscript
{
    public const int MaxLines = 50;

    private readonly List<ChatLine> lines = new();

    /// <summary>The retained lines, oldest first.</summary>
    public IReadOnlyList<ChatLine> Lines => this.lines;
    public int Revision { get; private set; }

    /// <summary>Appends one non-empty line, dropping the oldest beyond the cap.</summary>
    public void Append(string speaker, string text)
    {
        if (string.IsNullOrWhiteSpace(speaker))
        {
            throw new ArgumentException("A chat line requires a speaker.", nameof(speaker));
        }
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ArgumentException("A chat line requires text.", nameof(text));
        }

        this.lines.Add(new ChatLine(speaker, text));
        this.Revision++;
        if (this.lines.Count > MaxLines)
        {
            this.lines.RemoveRange(0, this.lines.Count - MaxLines);
        }
    }

    /// <summary>Returns the most recent player line for input recall, or null.</summary>
    public ChatLine? LastPlayerLine(string playerSpeaker)
    {
        for (var index = this.lines.Count - 1; index >= 0; index--)
        {
            if (this.lines[index].Speaker == playerSpeaker)
            {
                return this.lines[index];
            }
        }
        return null;
    }

    /// <summary>Projects the transcript into a persistence-friendly DTO.</summary>
    public ChatTranscriptData Export()
    {
        var data = new ChatTranscriptData();
        foreach (var line in this.lines)
        {
            data.Lines.Add(new ChatLineData { Speaker = line.Speaker, Text = line.Text });
        }
        return data;
    }

    /// <summary>Restores a transcript from persisted data; unreadable entries are skipped.</summary>
    public static ChatTranscript Import(ChatTranscriptData? data)
    {
        var transcript = new ChatTranscript();
        if (data?.Lines is null)
        {
            return transcript;
        }
        foreach (var line in data.Lines)
        {
            if (line is null || string.IsNullOrWhiteSpace(line.Speaker) || string.IsNullOrWhiteSpace(line.Text))
            {
                continue;
            }
            transcript.Append(line.Speaker, line.Text);
        }
        return transcript;
    }
}

/// <summary>Serialization shape for one persisted chat line.</summary>
public sealed class ChatLineData
{
    public string Speaker { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
}

/// <summary>Serialization shape for the persisted chat history.</summary>
public sealed class ChatTranscriptData
{
    public List<ChatLineData> Lines { get; set; } = new();
}
