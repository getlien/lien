namespace RankingCSharp;

/// <summary>Validates and records a new user by name.</summary>
public class CreateHandler
{
    public void CreateUser(string name)
    {
        if (string.IsNullOrEmpty(name))
        {
            Logger.LogError("CreateUser", new ArgumentException("name must not be empty"));
            return;
        }

        Logger.LogInfo($"created user {name}");
    }
}
