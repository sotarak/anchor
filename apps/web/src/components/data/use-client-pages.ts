import { type ComponentProps, useState } from "react";
import type { TableFooter } from "./table-footer";

const PAGE_SIZES = [10, 25, 50];

/** Client-side pagination for lists the API returns whole. The page is clamped when rows shrink. */
export function useClientPages<T>(rows: T[], initialPageSize = 10) {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const footer: ComponentProps<typeof TableFooter> = {
    total: rows.length,
    canPrev: current > 0,
    canNext: current < pages - 1,
    onPrev: () => setPage(current - 1),
    onNext: () => setPage(current + 1),
    pageSize,
    pageSizes: PAGE_SIZES,
    onPageSize: (n) => {
      setPageSize(n);
      setPage(0);
    },
  };
  return { rows: rows.slice(current * pageSize, (current + 1) * pageSize), footer };
}
