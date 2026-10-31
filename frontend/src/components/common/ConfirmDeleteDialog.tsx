import { useEffect, useRef } from "react";
import "./ConfirmDeleteDialog.css";

export type ConfirmDeleteDialogProps = {
  isOpen: boolean;
  workflowName: string;
  isDeleting: boolean;
  errorMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
};

export default function ConfirmDeleteDialog({
  isOpen,
  workflowName,
  isDeleting,
  errorMessage,
  onConfirm,
  onCancel,
  triggerRef,
}: ConfirmDeleteDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management: focus cancel button on open, return focus on close
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      cancelButtonRef.current?.focus();
    }, 50);

    const triggerElement = triggerRef?.current;

    return () => {
      clearTimeout(timer);
      triggerElement?.focus();
    };
  }, [isOpen, triggerRef]);

  // Keyboard navigation: Escape closes dialog, Tab traps focus
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!isDeleting) {
          onCancel();
        }
        return;
      }

      if (event.key === "Tab" && dialogRef.current) {
        const focusableElements =
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [tabindex="0"]:not([disabled])',
          );

        if (focusableElements.length === 0) return;

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isDeleting, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="confirm-delete-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          onCancel();
        }
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-desc"
        className="confirm-delete-dialog"
      >
        <header className="confirm-delete-dialog__header">
          <div className="confirm-delete-dialog__icon" aria-hidden="true">
            ⚠️
          </div>
          <div>
            <h2 id="confirm-delete-title">Delete Workflow</h2>
            <p id="confirm-delete-desc">
              Are you sure you want to delete{" "}
              <strong>&ldquo;{workflowName}&rdquo;</strong>? This action is
              permanent and cannot be undone. All nodes, connections, and
              associated workflow configuration will be deleted.
            </p>
          </div>
        </header>

        {errorMessage && (
          <div className="confirm-delete-dialog__error" role="alert">
            {errorMessage}
          </div>
        )}

        <div className="confirm-delete-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="confirm-delete-dialog__btn confirm-delete-dialog__btn--cancel"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-delete-dialog__btn confirm-delete-dialog__btn--delete"
            onClick={onConfirm}
            disabled={isDeleting}
            aria-label={`Confirm delete workflow: ${workflowName}`}
          >
            {isDeleting ? "Deleting..." : "Delete workflow"}
          </button>
        </div>
      </section>
    </div>
  );
}

