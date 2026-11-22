import { detachAccountLocalArtists } from "./account-local-artists";
import type { Repository } from "./database";
import { readDownloadArchive, setDownloadAccount } from "./download-archive";
import { listPlatformConfigurations, setPlatformDefaultAccount } from "./platform-config";

export function deletePlatformAccount(repo: Repository, accountId: string) {
  return repo.transaction(() => {
    const account = repo.maybe("accounts", accountId);
    if (!account) return { accountId };

    for (const config of listPlatformConfigurations(repo)) {
      if (config.accountId === accountId) setPlatformDefaultAccount(repo, config.target, null, config.revision);
    }
    const archive = readDownloadArchive(repo);
    if (archive.accountId === accountId) setDownloadAccount(repo, { accountId: null, expectedRevision: archive.revision });
    detachAccountLocalArtists(repo, accountId);

    // Keep the referenced row for existing bindings and submission history.
    repo.save("accounts", { ...account, deleted: true, authStatus: "not_connected", scopes: [] });
    repo.audit("account.delete", accountId);
    return { accountId };
  });
}
