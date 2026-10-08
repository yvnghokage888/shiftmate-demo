// Shared overlay modal used by the manager screens. Click-away to close;
// content scrolls within a max height. Plain styling for now.
import type { ReactNode } from "react";

export function Modal({
  children,
  onClose,
  wide,
}: {
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} max-h-[90vh] overflow-y-auto rounded-lg border bg-background p-5 shadow-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
