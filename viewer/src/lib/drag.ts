/**
 * Dragging items inside the viewer: cards can be dropped elsewhere in their collection to
 * reorder it, or on a collection in the sidebar to add them there. Browsers only reveal dragged
 * data on drop, so the item being dragged is also kept here for drag-over feedback.
 */

export const ITEM_TYPE = "application/x-taste-item";

let current: string | null = null;

export function startItemDrag(event: DragEvent, itemId: string): void {
  if (!event.dataTransfer) return;
  current = itemId;
  event.dataTransfer.setData(ITEM_TYPE, itemId);
  event.dataTransfer.effectAllowed = "copyMove";
}

export function endItemDrag(): void {
  current = null;
}

/** The item being dragged, when the drag is one of ours. */
export function draggedItem(event: DragEvent): string | null {
  return event.dataTransfer?.types.includes(ITEM_TYPE) ? current : null;
}
