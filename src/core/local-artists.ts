import { tables, type Repository } from "./database";
import { listPlatformConfigurations, savePlatformConfiguration } from "./platform-config";

const dependentTables = tables.filter(table =>
  table !== "artists" && table !== "bindings" && table !== "audit" && table !== "promptTemplates",
);

export function deleteLocalArtist(repo: Repository, id: string, expected: number) {
  return repo.transaction(() => {
    const artist = repo.get("artists", id);
    if (artist.accountLocalArtist) throw Error("USE_ACCOUNT_LOCAL_ARTIST");
    if (artist.revision !== expected) throw Error("REVISION_CONFLICT");

    for (const { version, revision, ...config } of listPlatformConfigurations(repo)) {
      if (config.artistId === id) savePlatformConfiguration(repo, { ...config, artistId: null }, revision);
    }

    const bindings = repo.all("bindings").filter(binding => binding.artistId === id);
    const ids = JSON.stringify([id, ...bindings.map(binding => binding.id)]);
    // Some jobs keep their artist or binding IDs in nested configuration snapshots.
    for (const table of dependentTables) {
      const reference = repo.db.prepare(`
        SELECT 1 FROM ${table}, json_tree(${table}.data) AS field
        WHERE field.type = 'text' AND field.atom IN (SELECT value FROM json_each(?))
        LIMIT 1
      `).get(ids);
      if (reference) throw Error("ARTIST_IN_USE");
    }

    repo.db.prepare("DELETE FROM bindings WHERE artistId = ?").run(id);
    repo.db.prepare("DELETE FROM artists WHERE id = ?").run(id);
    repo.audit("artist.delete", id);
    return { id };
  });
}
