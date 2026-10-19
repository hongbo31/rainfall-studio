import fs from "node:fs";
import path from "node:path";
type Binding = { accountId: string; providerId: string; remoteSubject: string };
type Encryptor = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (cipher: Buffer) => string;
};
export class CredentialVault {
  constructor(
    private root: string,
    private storage: Encryptor,
  ) {}
  isAvailable() {
    return this.storage.isEncryptionAvailable();
  }
  has(binding: Binding) {
    if (!fs.existsSync(this.file(binding))) return false;
    this.get(binding); // Verify the encrypted binding; never expose it to renderer.
    return true;
  }
  private file(binding: Binding) {
    if (
      !/^[a-f0-9-]{36}$/.test(binding.accountId) ||
      !binding.providerId ||
      !binding.remoteSubject
    )
      throw Error("CREDENTIAL_BINDING");
    return path.join(this.root, binding.accountId + ".bin");
  }
  put(binding: Binding, secret: string) {
    if (!this.storage.isEncryptionAvailable())
      throw Error("SECURE_STORAGE_UNAVAILABLE");
    if (!secret || secret.length > 100000) throw Error("SECRET_LIMIT");
    const file = this.file(binding);
    fs.mkdirSync(this.root, { recursive: true });
    const bytes = this.storage.encryptString(
      JSON.stringify({ binding, secret }),
    );
    fs.writeFileSync(file + ".tmp", bytes);
    fs.renameSync(file + ".tmp", file);
  }
  get(binding: Binding) {
    if (!this.storage.isEncryptionAvailable())
      throw Error("SECURE_STORAGE_UNAVAILABLE");
    const row = JSON.parse(
      this.storage.decryptString(fs.readFileSync(this.file(binding))),
    );
    if (
      row.binding.accountId !== binding.accountId ||
      row.binding.providerId !== binding.providerId ||
      row.binding.remoteSubject !== binding.remoteSubject
    )
      throw Error("CREDENTIAL_IDENTITY_MISMATCH");
    return row.secret as string;
  }
  delete(binding: Binding) {
    const file = this.file(binding);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
