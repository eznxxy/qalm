import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppConfig } from '../config';
import { AttachmentStorage } from './attachments.storage';

/**
 * Byte-level tests for the attachment storage: `<STORAGE_DIR>/attachments/…`,
 * a missing file is `null` (→ 404) and no key may escape the root. Runs against
 * a throwaway directory, never the developer's `./storage`.
 */
describe('AttachmentStorage (unit, temp directory)', () => {
  let root: string;
  let storage: AttachmentStorage;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'qalm-attach-'));
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    storage = new AttachmentStorage({ storageDir: root } as AppConfig);
  });

  it('round-trips bytes under attachments/<projectId>/<attachmentId>', async () => {
    const key = storage.keyFor('p-1', 'att-1');
    expect(key).toBe('p-1/att-1');

    await storage.save(key, Buffer.from('evidence'));
    await expect(storage.read(key)).resolves.toEqual(Buffer.from('evidence'));
    await expect(fs.readFile(path.join(root, 'attachments', 'p-1', 'att-1'))).resolves.toEqual(
      Buffer.from('evidence'),
    );
  });

  it('reads a missing key as null and tolerates removing an absent file', async () => {
    await expect(storage.read('p-1/gone')).resolves.toBeNull();
    await expect(storage.remove('p-1/gone')).resolves.toBeUndefined();
  });

  it('removes a stored file', async () => {
    await storage.save('p-1/att-2', Buffer.from('x'));
    await storage.remove('p-1/att-2');
    await expect(storage.read('p-1/att-2')).resolves.toBeNull();
  });

  it('refuses a key that would escape the storage root', async () => {
    await expect(storage.save('../evil', Buffer.from('x'))).rejects.toThrow(
      'escapes the storage root',
    );
    await expect(storage.read('../evil')).rejects.toThrow('escapes the storage root');
    await expect(storage.remove('a/../../evil')).rejects.toThrow('escapes the storage root');
  });
});