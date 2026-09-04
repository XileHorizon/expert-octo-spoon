export function patchItemById<T extends { clientId: string }>(items: T[], id: string, patch: Partial<T>) {
  return items.map((item) => item.clientId === id ? { ...item, ...patch } : item);
}

export function toggleExpandedId(current: ReadonlySet<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
