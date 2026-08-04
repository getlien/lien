namespace RankingCSharp;

/// <summary>
/// Shared logging helper -- the hub type every handler in this fixture
/// corpus references. Deliberately same-namespace with no `using` needed
/// anywhere in this corpus, which is why the reverse-dependency signal here
/// comes entirely from the C# type-reference recovery tier (#930/#943)
/// rather than the regular import graph.
/// </summary>
public static class Logger
{
    public static void LogInfo(string message)
    {
        Console.WriteLine($"[info] {message}");
    }

    public static void LogError(string context, Exception err)
    {
        Console.WriteLine($"[error] {context}: {err.Message}");
    }
}
