/** A "?" next to a label: the explanation shows on hover and on keyboard focus. */
export const Hint = ({ text }: { text: string }) => (
  <span className="help" tabIndex={0} role="note" aria-label={text} data-tip={text}>
    ?
  </span>
);
