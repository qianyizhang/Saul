import { useEffect, useState } from 'react';
import type { GeneratedImage } from '../models/images';
import { validateGeneratedImage } from '../models/images';
import { sendReadingMessage, sendDbMessage } from '../storage/client';

const imageActionClass =
  'inline-flex min-h-8 items-center px-2 py-1 text-sm rounded-control border border-line hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent';

export function GeneratedImageView({
  selectionId,
  runId,
  workspace = false,
}: {
  selectionId: string;
  runId: string;
  workspace?: boolean;
}) {
  const [image, setImage] = useState<GeneratedImage>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [still, setStill] = useState<string>();
  const [playing, setPlaying] = useState(
    () => !matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      if (media.matches) setPlaying(false);
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    let active = true;
    setImage(undefined);
    setStill(undefined);
    setError('');
    const load = workspace
      ? sendDbMessage({ type: 'DB_IMAGE', payload: { selectionId, runId } })
      : sendReadingMessage({ action: 'image', selectionId, runId });
    void load
      .then(async (image) => {
        if (!image) throw new Error('The saved image is unavailable.');
        validateGeneratedImage(image);
        if (image.mediaType === 'image/gif') {
          const bitmap = await createImageBitmap(
            new Blob([Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0))], {
              type: image.mediaType,
            }),
          );
          try {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('The animation preview is unavailable.');
            context.drawImage(bitmap, 0, 0);
            if (active) setStill(canvas.toDataURL('image/png'));
          } finally {
            bitmap.close();
          }
        }
        if (active) setImage(image);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [selectionId, runId, workspace, retry]);
  if (error)
    return (
      <p role="alert">
        {error}{' '}
        <button className={imageActionClass} onClick={() => setRetry((n) => n + 1)}>
          Load again
        </button>
      </p>
    );
  if (!image) return <p role="status">Loading image…</p>;
  const url = `data:${image.mediaType};base64,${image.data}`;
  return (
    <div className="flex flex-col gap-2">
      <img
        src={image.mediaType === 'image/gif' && !playing ? still : url}
        alt="Generated illustration"
        style={{ maxWidth: '100%', maxHeight: 640, objectFit: 'contain' }}
      />
      <div className="flex flex-wrap gap-2">
        {image.mediaType === 'image/gif' && (
          <button className={imageActionClass} onClick={() => setPlaying((value) => !value)}>
            {playing ? 'Pause animation' : 'Play animation'}
          </button>
        )}
        <a
          className={imageActionClass}
          href={url}
          download={`Saul-${runId}.${image.mediaType === 'image/gif' ? 'gif' : 'png'}`}
        >
          Download {image.mediaType === 'image/gif' ? 'GIF' : 'PNG'}
        </a>
      </div>
    </div>
  );
}
