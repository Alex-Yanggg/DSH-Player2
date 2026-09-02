using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;

namespace DSHPlayer2.Stardew;

/// <summary>
/// Starts the ordinary installed DSH profile, never a Player-owned sidecar.
/// By default the child only inherits SMAPI's existing process environment;
/// the legacy registry fallback requires opting in via ApiKeyMode. Player2
/// never logs, saves, displays, or transmits that secret.
/// </summary>
internal static class DshWebLauncher
{
    public static Process Start(string profile, int port, ApiKeyMode apiKeyMode = ApiKeyMode.InheritOnly)
    {
        if (string.IsNullOrWhiteSpace(profile))
        {
            throw new ArgumentException("DSH profile must not be empty.", nameof(profile));
        }
        if (port is < 1 or > 65535)
        {
            throw new ArgumentOutOfRangeException(nameof(port), "DSH Web port must be between 1 and 65535.");
        }
        var dshCommand = ResolveDshCommand();
        var commandShell = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
        var arguments = $"/d /c \"\"{dshCommand}\" --profile {Quote(profile)} --port {port} --no-open\"";
        var startInfo = new ProcessStartInfo
        {
            FileName = commandShell,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = Environment.CurrentDirectory,
        };
        // Steam/SMAPI may have been started before a user-level environment
        // edit and therefore miss it. Only the explicit IncludeUserRegistry
        // opt-in reads the persistent user value, and only to place it in the
        // normal DSH child's environment.
        var apiKey = Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY");
        if (string.IsNullOrWhiteSpace(apiKey) && apiKeyMode == ApiKeyMode.IncludeUserRegistry)
        {
            apiKey = Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY", EnvironmentVariableTarget.User);
        }
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            startInfo.Environment["DEEPSEEK_API_KEY"] = apiKey;
        }
        return Process.Start(startInfo) ?? throw new InvalidOperationException("Windows did not create the DSH web process.");
    }

    /// <summary>Returns whether the default local DSH Web endpoint is already listening.</summary>
    public static bool IsListening(int port)
    {
        return IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners()
            .Any(endpoint => endpoint.Port == port);
    }

    /// <summary>Stops only the cmd.exe process tree created by this Mod instance.</summary>
    public static void StopTree(Process launcher)
    {
        if (launcher.HasExited) return;
        var commandShell = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
        using var killer = Process.Start(new ProcessStartInfo
        {
            FileName = commandShell,
            Arguments = $"/d /c taskkill /pid {launcher.Id} /t /f >nul 2>nul",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        });
        killer?.WaitForExit(5000);
    }

    /// <summary>Uses the standard per-user pnpm shim first, then PATH for another DSH installation.</summary>
    internal static string ResolveDshCommand()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var pnpmShim = Path.Combine(localAppData, "pnpm", "bin", "dsh.cmd");
        return File.Exists(pnpmShim) ? pnpmShim : "dsh.cmd";
    }

    private static string Quote(string value) => $"\"{value.Replace("\"", "\\\"", StringComparison.Ordinal)}\"";
}
