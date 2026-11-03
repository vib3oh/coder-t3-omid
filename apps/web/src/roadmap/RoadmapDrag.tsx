import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import { useState, type ReactNode } from "react";
import { GripVerticalIcon } from "lucide-react";
import type { RoadmapCard } from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type { RoadmapColumn } from "./roadmap.logic";

const collision: CollisionDetection = (input) => {
  const hits = pointerWithin(input);
  return hits.length
    ? hits.sort(
        (left, right) =>
          (input.droppableContainers.find((container) => container.id === right.id)?.data.current
            ?.priority ?? 0) -
          (input.droppableContainers.find((container) => container.id === left.id)?.data.current
            ?.priority ?? 0),
      )
    : closestCenter(input);
};

export function RoadmapDrag({
  cards,
  onMove,
  children,
}: {
  cards: ReadonlyArray<RoadmapCard>;
  onMove: (id: string, column: RoadmapColumn, beforeId?: string) => void;
  children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const active = cards.find((card) => card.id === activeId);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={({ active }) => setActiveId(String(active.data.current?.cardId ?? ""))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={({ active, over }) => {
        setActiveId(null);
        const target = over?.data.current;
        if (target?.column && active.data.current?.cardId !== target.beforeId)
          onMove(active.data.current?.cardId, target.column, target.beforeId);
      }}
    >
      {children}
      <DragOverlay>
        {active ? (
          <div className="w-64 rounded-lg border border-primary bg-popover p-4 text-sm font-medium shadow-lg">
            {active.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function RoadmapDropZone({
  id,
  column,
  label,
  disabled,
  group = false,
  children,
}: {
  id: string;
  column: RoadmapColumn;
  label: string;
  disabled: boolean;
  group?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled,
    data: { column, priority: group ? 2 : 1 },
  });
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={cn(
        group
          ? "space-y-2 rounded-lg p-1"
          : "flex w-72 shrink-0 flex-col rounded-xl border border-border/60 bg-muted/25",
        isOver && "ring-2 ring-primary/60",
      )}
    >
      {children}
    </section>
  );
}

export function RoadmapDragCard({
  card,
  column,
  disabled,
  onOpen,
  children,
}: {
  card: RoadmapCard;
  column: RoadmapColumn;
  disabled: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({ id: `card:${card.id}`, disabled, data: { cardId: card.id } });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `target:${card.id}`,
    disabled,
    data: { column, beforeId: card.id, priority: 3 },
  });
  return (
    <article
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      onClick={(event) => {
        if (!(event.target as Element).closest("button,a,input,textarea,select")) onOpen();
      }}
      className={cn(
        "relative space-y-3 rounded-lg border border-border bg-background p-3 shadow-sm",
        isDragging && "opacity-40",
        isOver && "ring-2 ring-primary/60",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="uppercase tracking-wide">
          {card.type} · {card.effort}
        </span>
        <Button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Drag ${card.title}`}
          className="touch-none"
        >
          <GripVerticalIcon className="size-3.5" />
        </Button>
      </div>
      {children}
    </article>
  );
}
