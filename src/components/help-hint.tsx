interface HelpHintProps {
  /** Secondary explanation shown as a native tooltip on hover/focus. */
  text: string;
  /** Optional accessible label; defaults to a generic description. */
  label?: string;
}

/** Small inline "?" chip for secondary explanations — keeps dense panels scannable
 *  by moving long clarifications into a tooltip instead of the visible layout. */
export function HelpHint({ text, label }: HelpHintProps) {
  return (
    <span
      className="help-hint"
      role="note"
      aria-label={label ?? 'More information'}
      title={text}
      tabIndex={0}
    >
      ?
    </span>
  );
}
