import type { DeletePrompt, SavedPrompt, SavePrompt } from "../shared/prompt-library";
import type { Repository } from "./database";

export function listPrompts(repo: Repository, query = "") {
  const keyword = query.toLowerCase();
  const prompts = repo.all("promptTemplates") as SavedPrompt[];
  return prompts
    .filter(prompt => !keyword || prompt.name.toLowerCase().includes(keyword) || prompt.content.toLowerCase().includes(keyword))
    .map(({ id, name, updatedAt, revision }) => ({ id, name, updatedAt, revision }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getPrompt(repo: Repository, id: string): SavedPrompt {
  return repo.get("promptTemplates", id) as SavedPrompt;
}

export function savePrompt(repo: Repository, { id, name, content, expectedRevision }: SavePrompt, now: Date) {
  return repo.transaction(() => {
    const previous = repo.maybe("promptTemplates", id);
    if ((previous?.revision ?? null) !== expectedRevision) throw Error("REVISION_CONFLICT");
    const prompt: SavedPrompt = { id, name, content, updatedAt: now.toISOString(), revision: (previous?.revision ?? 0) + 1 };
    repo.save("promptTemplates", prompt);
    return prompt;
  });
}

export function deletePrompt(repo: Repository, { id, expectedRevision }: DeletePrompt) {
  return repo.transaction(() => {
    if (getPrompt(repo, id).revision !== expectedRevision) throw Error("REVISION_CONFLICT");
    for (const table of ["artists", "accountLocalArtists"] as const) {
      for (const artist of repo.all(table).filter(artist => artist.promptTemplateId === id)) {
        repo.save(table, { ...artist, promptTemplateId: null, revision: (artist.revision ?? 0) + 1 });
      }
    }
    repo.db.prepare("DELETE FROM promptTemplates WHERE id = ?").run(id);
    return { id };
  });
}
