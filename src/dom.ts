/** Look up required markup and validate its type before using it. */
export function getElement<T extends Element>(
  id: string,
  type: { new (...args: never[]): T },
): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Expected ${type.name} with id "${id}".`);
  }
  return element;
}
