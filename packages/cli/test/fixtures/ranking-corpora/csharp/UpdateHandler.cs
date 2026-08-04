namespace RankingCSharp;

/// <summary>Changes an existing user's display name.</summary>
public class UpdateHandler
{
    public void UpdateUser(int id, string name)
    {
        if (id <= 0)
        {
            Logger.LogError("UpdateUser", new ArgumentException("id must be positive"));
            return;
        }

        Logger.LogInfo($"updated user {name}");
    }
}
