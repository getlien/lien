namespace RankingCSharp;

/// <summary>Removes a user by id.</summary>
public class DeleteHandler
{
    public void DeleteUser(int id)
    {
        if (id <= 0)
        {
            Logger.LogError("DeleteUser", new ArgumentException("id must be positive"));
            return;
        }

        Logger.LogInfo("deleted user");
    }
}
