import { saulDb } from './db';
import type { DbRequest } from '../types/storage';

let queue = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<{ id: number; message: DbRequest }>) => {
  queue = queue.then(async () => {
    try {
      const result = await saulDb.execute(data.message);
      self.postMessage({ id: data.id, response: { success: true, result } });
    } catch (error) {
      self.postMessage({
        id: data.id,
        response: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });
};
