// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

interface ModulePlaceholderProps {
  title: string;
  description: string;
  milestone: string;
}

export function ModulePlaceholder({ title, description, milestone }: ModulePlaceholderProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      <span className="mt-2 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
        In arrivo con la {milestone}
      </span>
    </div>
  );
}
