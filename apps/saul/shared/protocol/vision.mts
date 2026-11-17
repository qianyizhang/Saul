export function validVisionImages(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === 1 &&
    value.every(
      (image) =>
        typeof image === 'string' &&
        image.length <= 450000 &&
        /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image),
    )
  );
}
