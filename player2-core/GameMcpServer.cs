using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace DSHPlayer2.Core;

/// <summary>One raw game capability offered to DSH as an MCP tool.</summary>
public sealed record GameTool(string Name, string Description, JsonObject InputSchema, Func<JsonObject, CancellationToken, Task<string>> Call);

/// <summary>
/// The game's hands as a local MCP server (Streamable HTTP, JSON responses
/// only). DSH's own MCP client connects to it when the save's ACP session
/// opens. Handlers run on pool threads and must hand game work to the game
/// thread themselves.
/// </summary>
public sealed class GameMcpServer : IDisposable
{
    public const string ServerName = "game";

    private readonly HttpListener listener = new();
    private readonly Dictionary<string, GameTool> tools = new(StringComparer.Ordinal);
    private readonly CancellationTokenSource stopping = new();
    private readonly string token = Guid.NewGuid().ToString("N");

    public GameMcpServer(IEnumerable<GameTool> tools)
    {
        foreach (var tool in tools) this.tools.Add(tool.Name, tool);
        this.Port = FreePort();
        // "localhost" needs no URL reservation for a non-admin Windows user.
        this.listener.Prefixes.Add($"http://localhost:{this.Port}/");
    }

    public int Port { get; }

    /// <summary>Where DSH connects; the bearer token keeps other local programs out.</summary>
    public JsonObject McpServerEntry() => new()
    {
        ["type"] = "http",
        ["name"] = ServerName,
        ["url"] = $"http://localhost:{this.Port}/mcp",
        ["headers"] = new JsonArray(new JsonObject { ["name"] = "Authorization", ["value"] = $"Bearer {this.token}" }),
    };

    public void Start()
    {
        this.listener.Start();
        _ = Task.Run(this.AcceptLoop);
    }

    public void Dispose()
    {
        this.stopping.Cancel();
        try { this.listener.Close(); } catch (ObjectDisposedException) { }
    }

    /// <summary>Answers one JSON-RPC message; null for notifications. Public for tests.</summary>
    public async Task<JsonObject?> HandleAsync(JsonObject request, CancellationToken cancel)
    {
        var id = request["id"]?.Clone();
        var method = request["method"]?.GetValue<string>() ?? "";
        if (id is null) return null;
        try
        {
            JsonNode result = method switch
            {
                "initialize" => new JsonObject
                {
                    ["protocolVersion"] = request["params"]?["protocolVersion"]?.Clone() ?? "2025-06-18",
                    ["capabilities"] = new JsonObject { ["tools"] = new JsonObject() },
                    ["serverInfo"] = new JsonObject { ["name"] = "player2-game", ["version"] = "1" },
                },
                "ping" => new JsonObject(),
                "tools/list" => new JsonObject { ["tools"] = this.ListTools() },
                "tools/call" => await this.CallAsync(request["params"] as JsonObject, cancel).ConfigureAwait(false),
                _ => throw new MissingMethodException(method),
            };
            return new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result };
        }
        catch (MissingMethodException)
        {
            return Error(id, -32601, $"unknown method {method}");
        }
    }

    private JsonArray ListTools()
    {
        var list = new JsonArray();
        foreach (var tool in this.tools.Values)
        {
            list.Add(new JsonObject { ["name"] = tool.Name, ["description"] = tool.Description, ["inputSchema"] = tool.InputSchema.Clone() });
        }
        return list;
    }

    private async Task<JsonNode> CallAsync(JsonObject? parameters, CancellationToken cancel)
    {
        var name = parameters?["name"]?.GetValue<string>() ?? "";
        if (!this.tools.TryGetValue(name, out var tool)) return ToolResult($"unknown tool {name}", true);
        try
        {
            var text = await tool.Call(parameters?["arguments"] as JsonObject ?? new JsonObject(), cancel).ConfigureAwait(false);
            return ToolResult(text, false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A refused or failed action is information for the companion, never a crash.
            return ToolResult(ex.Message, true);
        }
    }

    private async Task AcceptLoop()
    {
        while (!this.stopping.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await this.listener.GetContextAsync().ConfigureAwait(false); }
            catch (Exception) when (this.stopping.IsCancellationRequested) { return; }
            catch (HttpListenerException) { return; }
            _ = Task.Run(() => this.ServeAsync(context));
        }
    }

    private async Task ServeAsync(HttpListenerContext context)
    {
        var response = context.Response;
        try
        {
            if (context.Request.Headers["Authorization"] != $"Bearer {this.token}")
            {
                response.StatusCode = 401;
                return;
            }
            if (context.Request.HttpMethod != "POST")
            {
                // No server-initiated stream: the game only answers calls.
                response.StatusCode = 405;
                return;
            }
            using var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8);
            var request = JsonNode.Parse(await reader.ReadToEndAsync().ConfigureAwait(false)) as JsonObject;
            var answer = request is null ? Error(null, -32700, "parse error") : await this.HandleAsync(request, this.stopping.Token).ConfigureAwait(false);
            if (answer is null)
            {
                response.StatusCode = 202;
                return;
            }
            var bytes = Encoding.UTF8.GetBytes(answer.ToJsonString());
            response.ContentType = "application/json";
            response.ContentLength64 = bytes.Length;
            await response.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
        }
        catch (Exception)
        {
            response.StatusCode = 500;
        }
        finally
        {
            try { response.Close(); } catch (Exception) { }
        }
    }

    private static JsonObject ToolResult(string text, bool isError) => new()
    {
        ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text }),
        ["isError"] = isError,
    };

    private static JsonObject Error(JsonNode? id, int code, string message) => new()
    {
        ["jsonrpc"] = "2.0",
        ["id"] = id,
        ["error"] = new JsonObject { ["code"] = code, ["message"] = message },
    };

    private static int FreePort()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }
}
