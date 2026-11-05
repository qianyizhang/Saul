import { credentialCall } from '../native/credentials';
import { validateCredentialRequest } from '../../native/credentials-contract.mts';
import type { RunInput } from '../types/storage';

export interface GeneratedImage {
  data: string;
  mediaType: 'image/png' | 'image/gif';
}
export function validateGeneratedImage(image: GeneratedImage): void {
  if (
    !['image/png', 'image/gif'].includes(image.mediaType) ||
    typeof image.data !== 'string' ||
    !image.data ||
    image.data.length > 28_000_000 ||
    image.data.length % 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)
  )
    throw new Error('The provider returned an invalid image.');
  const bytes = atob(image.data);
  const validHeader =
    image.mediaType === 'image/gif'
      ? /^GIF8[79]a/.test(bytes)
      : [137, 80, 78, 71, 13, 10, 26, 10].every(
          (value, index) => bytes.charCodeAt(index) === value,
        );
  if (!validHeader || bytes.length > 20 * 1024 * 1024)
    throw new Error('The provider returned an invalid or oversized image.');
}
export async function generateImage(
  input: RunInput,
  key: string,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  if (
    input.provider !== 'openai-compatible' ||
    input.remote.baseUrl.replace(/\/+$/, '') !== 'https://api.openai.com/v1'
  )
    throw new Error('Draw requires the official OpenAI API connection.');
  const options = input.preset?.imageOptions;
  const request = {
    action: 'api-image',
    ...(input.preset?.connectionKey ? { connectionKey: input.preset.connectionKey } : {}),
    model: input.remote.model,
    prompt: [input.systemPrompt, input.userPrompt].filter(Boolean).join('\n\n'),
    size: options?.size ?? '1024x1024',
    quality: options?.quality ?? 'low',
    outputFormat: options?.outputFormat ?? 'png',
  } as const;
  validateCredentialRequest(request);
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(180_000)])
    : AbortSignal.timeout(180_000);
  signal.throwIfAborted();
  let encoded: unknown;
  if (input.remote.credentialOwner === 'saul') {
    encoded = (await credentialCall(request, signal)).imageBase64;
  } else {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        size: request.size,
        quality: request.quality,
        output_format: request.outputFormat,
      }),
    });
    if (!response.ok)
      throw new Error(
        `OpenAI rejected the image request (HTTP ${response.status}). Check model access, billing and image settings.`,
      );
    if (!response.body) throw new Error('OpenAI returned an empty image response.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = '',
      count = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        count += value.length;
        if (count > 28 * 1024 * 1024)
          throw new Error('The image response is too large. Choose a smaller image.');
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const result: unknown = JSON.parse(body);
    if (
      result &&
      typeof result === 'object' &&
      'data' in result &&
      Array.isArray(result.data) &&
      result.data.length === 1
    )
      encoded = result.data[0]?.b64_json;
  }
  if (typeof encoded !== 'string') throw new Error('OpenAI returned no generated image.');
  const image: GeneratedImage = {
    data: encoded,
    mediaType: request.outputFormat === 'gif' ? 'image/gif' : 'image/png',
  };
  validateGeneratedImage(image);
  const bitmap = await createImageBitmap(
    new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: image.mediaType }),
  );
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 4096 || bitmap.height > 4096)
      throw new Error('The generated image dimensions are unsupported.');
  } finally {
    bitmap.close();
  }
  return image;
}
