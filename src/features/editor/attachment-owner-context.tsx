import type { ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * The two things a node view needs about a file it is drawing: what it is
 * called, and how to hand it back to the reader.
 */
export interface AttachmentOwner {
  /** The rows for whatever document is on screen, keyed by the node's id. */
  attachments: { filename: string; id: number }[];
  download: (id: number, filename: string) => void;
}

/**
 * Which document's files the editor is currently showing.
 *
 * **Absent means an entry**, which is why nothing on the entry side had to
 * change: with no provider above them the attachment node views fall back to
 * the entries slice and to `downloadAttachment`, exactly as they always did.
 *
 * A letter provides this because its files live in their own table with their
 * own ids - letter attachment 4 and entry attachment 4 are different files -
 * so the id in a node is only meaningful together with the document that node
 * belongs to. Passing the owner down the tree is how the node learns which of
 * the two it is in without every node gaining a prop.
 */
const AttachmentOwnerContext = createContext<AttachmentOwner | null>(null);

export const AttachmentOwnerProvider = ({
  children,
  owner,
}: {
  children: ReactNode;
  owner: AttachmentOwner;
}) => (
  <AttachmentOwnerContext.Provider value={owner}>
    {children}
  </AttachmentOwnerContext.Provider>
);

export const useAttachmentOwner = () => useContext(AttachmentOwnerContext);
