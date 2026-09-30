import { useEffect, useState } from "react";
import { useI18n } from "./i18n";

/** How many rows a long list shows at first, and how many more each click adds. */
export const PAGE = 30;

export interface Paged<T> {
  shown: T[];
  /** Rows not shown yet. */
  left: number;
  showMore: () => void;
}

/**
 * The first rows of a long list; the rest one click away. Filtering happens on
 * the whole list before this. `reset` (e.g. the search text) starts again at one
 * page; `keep` is a row index that must stay visible (the selected one).
 */
export const usePaged = <T,>(items: T[], reset?: unknown, keep = -1): Paged<T> => {
  const [count, setCount] = useState(PAGE);
  useEffect(() => setCount(PAGE), [reset]);
  const limit = keep >= count ? Math.ceil((keep + 1) / PAGE) * PAGE : count;
  return {
    shown: items.length > limit ? items.slice(0, limit) : items,
    left: Math.max(0, items.length - limit),
    showMore: () => setCount(limit + PAGE),
  };
};

export const ShowMore = ({ left, onClick }: { left: number; onClick: () => void }) => {
  const { t } = useI18n();
  if (left <= 0) {
    return null;
  }
  return (
    <button className="ghost" style={{ margin: "8px auto", display: "block" }} onClick={onClick}>
      {t("list.showMore", { n: left })}
    </button>
  );
};
