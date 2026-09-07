import type { BacklogItemDraft } from "../backlog/add.js";
import type { BacklogItem } from "../backlog/item.js";

export function recoverMaterializedItem(
  items: BacklogItem[],
  draft: BacklogItemDraft,
  project: string,
  mappedId?: string,
): BacklogItem | undefined {
  const matches = items.filter((item) => item.source === draft.source);
  if (matches.length > 1)
    throw new Error(`Ambiguous materialization source ${draft.source}; reconcile existing items.`);
  const item = matches[0];
  if (mappedId !== undefined && item?.id !== mappedId)
    throw new Error(`Mapped item ${project}:${mappedId} is missing or has a conflicting source.`);
  if (!item) return undefined;
  if (
    item.project !== project ||
    item.title !== draft.title ||
    item.category !== draft.category ||
    item.priority !== draft.priority ||
    item.item_type !== draft.item_type ||
    item.parent_id !== draft.parent_id ||
    item.body.trimEnd() !== draft.body.trimEnd() ||
    JSON.stringify(item.depends_on) !== JSON.stringify(draft.depends_on)
  )
    throw new Error(
      `Materialization source ${draft.source} conflicts with ${project}:${item.id}; reconcile content before retrying.`,
    );
  return item;
}
