import { RiArrowLeftSLine, RiArrowRightSLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { countLabel } from "@/lib/format";

const pagerButton = "disabled:bg-bg-white disabled:ring-stroke-soft disabled:text-text-disabled";

/** Footer row inside the table container: count, pager, page size. */
export function TableFooter({
  total,
  shown,
  label = "results",
  canPrev,
  canNext,
  onPrev,
  onNext,
  pageSize,
  pageSizes,
  onPageSize,
}: {
  /** Total rows, or null when unknown (cursor pagination): then `shown` is displayed. */
  total: number | null;
  shown?: number;
  label?: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  pageSize: number;
  pageSizes: number[];
  onPageSize: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t px-4 py-3">
      <span className="text-paragraph-sm text-text-sub">
        {total === null ? `${shown ?? 0} shown` : countLabel(total, label)}
      </span>
      <div className="flex">
        <Button
          size="icon"
          aria-label="Previous page"
          disabled={!canPrev}
          onClick={onPrev}
          className={`rounded-r-none ${pagerButton}`}
        >
          <RiArrowLeftSLine aria-hidden />
        </Button>
        <Button
          size="icon"
          aria-label="Next page"
          disabled={!canNext}
          onClick={onNext}
          className={`-ml-px rounded-l-none ${pagerButton}`}
        >
          <RiArrowRightSLine aria-hidden />
        </Button>
      </div>
      <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
        <SelectTrigger compact aria-label="Rows per page" className="w-auto">
          <SelectValue>{`${pageSize} / page`}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {pageSizes.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {`${n} / page`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
