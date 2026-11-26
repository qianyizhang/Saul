import { validateGeneratedImage, type GeneratedImage } from '../../shared/model/image.ts';
import { credentialCall } from '../native/credentials';
import { validateCredentialRequest } from '../../shared/protocol/credentials-contract.mts';
import type { APIExecution, ModelRequest } from '../../shared/model/execution-route.ts';

export async function generateImage(
  route: APIExecution,
  input: Pick<ModelRequest, 'systemPrompt' | 'userPrompt'>,
  key: string,
  signal?: AbortSignal,
  runGeneration?: string,
): Promise<GeneratedImage> {
  if (route.capability !== 'draw') throw new Error('Choose a Draw preset.');
  const options = route.imageOptions;
  const request = {
    action: 'api-image',
    ...(runGeneration ? { runGeneration } : {}),
    ...(route.binding.kind === 'connection' ? { connectionKey: route.binding.key } : {}),
    model: route.model,
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
  if (route.owner === 'saul') {
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
