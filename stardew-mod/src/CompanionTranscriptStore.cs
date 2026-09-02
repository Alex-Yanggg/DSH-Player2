using System;
using DSHPlayer2.Core;
using StardewModdingAPI;

namespace DSHPlayer2.Stardew;

/// <summary>
/// The per-save chat transcript store. SMAPI save data is the persistence
/// boundary; a damaged store degrades to an empty transcript with a warning,
/// never to a fabricated conversation.
/// </summary>
internal static class CompanionTranscriptStore
{
    private const string SaveKey = "chat-transcript";

    public static ChatTranscript Load(IModHelper helper, IMonitor monitor)
    {
        try
        {
            return ChatTranscript.Import(helper.Data.ReadSaveData<ChatTranscriptData>(SaveKey));
        }
        catch (Exception ex)
        {
            monitor.Log($"Player2 could not read its chat history; starting an empty transcript: {ex.Message}", LogLevel.Warn);
            return new ChatTranscript();
        }
    }

    public static void Save(IModHelper helper, ChatTranscript transcript, IMonitor monitor)
    {
        try
        {
            helper.Data.WriteSaveData(SaveKey, transcript.Export());
        }
        catch (Exception ex)
        {
            monitor.Log($"Player2 could not persist its chat history: {ex.Message}", LogLevel.Warn);
        }
    }
}
