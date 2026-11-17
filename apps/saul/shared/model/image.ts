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
