// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

import { FileText, Folder, Link2, Presentation, Table2 } from "lucide-react";
import { driveKindOf, type Attachment } from "@kancrm/shared";

/**
 * Icona di un allegato, **punto unico** per tutte le liste (pannelli task,
 * offerte, ticket, staging): un link Google Workspace porta il segno di cosa è
 * (documento, foglio, presentazione, cartella) grazie al mimeType dichiarato
 * dal selettore Drive; l'incolla-link resta il generico link. I file usano il
 * segno documento come sempre.
 */
export function AttachmentIcon({
  attachment,
  className = "size-4 shrink-0 text-muted-foreground",
}: {
  attachment: Pick<Attachment, "type" | "mimeType">;
  className?: string;
}) {
  if (attachment.type === "FILE") return <FileText className={className} />;
  switch (driveKindOf(attachment.mimeType)) {
    case "document":
      return <FileText className={className} />;
    case "spreadsheet":
      return <Table2 className={className} />;
    case "presentation":
      return <Presentation className={className} />;
    case "folder":
      return <Folder className={className} />;
    case "pdf":
      return <FileText className={className} />;
    default:
      return <Link2 className={className} />;
  }
}
