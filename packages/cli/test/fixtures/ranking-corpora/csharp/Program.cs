namespace RankingCSharp;

/// <summary>Fixture corpus entry point, wiring the handlers to the shared logger.</summary>
public class Program
{
    public static void Main(string[] args)
    {
        Logger.LogInfo("starting ranking-csharp fixture service");
        new CreateHandler().CreateUser("ada");
    }
}
