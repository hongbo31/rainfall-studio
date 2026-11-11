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
    const serialized=JSON.stringify({binding,secret});let bytes:Buffer;
    try { bytes = this.storage.encryptString(serialized); }
    catch { throw Error('CREDENTIAL_ENCRYPT_FAILED'); }
    let verified:string;
    try { verified=this.storage.decryptString(bytes); } catch { throw Error('CREDENTIAL_DECRYPT_FAILED'); }
    if(verified!==serialized)throw Error('CREDENTIAL_READBACK_FAILED');
    try { fs.mkdirSync(this.root, { recursive: true }); fs.writeFileSync(file + ".tmp", bytes); fs.renameSync(file + ".tmp", file); }
    catch { throw Error('CREDENTIAL_SAVE_FAILED'); }
  }
  get(binding: Binding) {
    if (!this.storage.isEncryptionAvailable())
      throw Error("SECURE_STORAGE_UNAVAILABLE");
    let encrypted:Buffer,plain:string,row:any;
    try { encrypted=fs.readFileSync(this.file(binding)); } catch { throw Error('CREDENTIAL_READ_FAILED'); }
    try { plain=this.storage.decryptString(encrypted); } catch { throw Error('CREDENTIAL_DECRYPT_FAILED'); }
    try { row=JSON.parse(plain); } catch { throw Error('CREDENTIAL_DATA_INVALID'); }
    if(!row?.binding||typeof row.secret!=='string'||!row.secret||row.secret.length>100000)throw Error('CREDENTIAL_DATA_INVALID');
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
