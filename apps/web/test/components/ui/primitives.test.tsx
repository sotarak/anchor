import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "@/components/ui/tooltip";

describe("Button", () => {
  it("button primary uses brand tokens", () => {
    render(<Button variant="primary">Save</Button>);
    const cls = screen.getByRole("button", { name: "Save" }).className;
    expect(cls).toContain("bg-primary-base");
    expect(cls).toContain("hover:bg-primary-darker");
  });

  it("button default is secondary xs", () => {
    render(<Button>Cancel</Button>);
    const cls = screen.getByRole("button", { name: "Cancel" }).className;
    expect(cls).toContain("ring-stroke-soft");
    expect(cls).toContain("bg-bg-white");
    expect(cls).toContain("h-8");
    expect(cls).toContain("text-label-xs");
  });
});

describe("StatusBadge", () => {
  it.each([
    ["success", "bg-success-lighter", "text-success-base"],
    ["warning", "bg-warning-lighter", "text-warning-base"],
    ["error", "bg-error-lighter", "text-error-base"],
    ["info", "bg-information-lighter", "text-information-base"],
    ["neutral", "bg-faded-lighter", "text-text-sub"],
  ] as const)("status badge maps %s to tinted tokens", (status, bg, text) => {
    render(<StatusBadge status={status}>Label</StatusBadge>);
    const el = screen.getByText("Label").closest("span[data-slot=status-badge]");
    expect(el?.className).toContain(bg);
    expect(el?.className).toContain(text);
    expect(el?.querySelector("svg")).not.toBeNull();
  });

  it("tag defaults to the feature tone; neutral is the key/path chip", () => {
    render(
      <>
        <Tag>admin</Tag>
        <Tag tone="neutral">/api</Tag>
      </>,
    );
    expect(screen.getByText("admin").className).toContain("bg-feature-lighter");
    expect(screen.getByText("/api").className).toContain("text-code-xs");
  });
});

describe("Table", () => {
  it("table head is sentence case and tokenized", () => {
    render(
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell primary>API_KEY</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>,
    );
    const th = screen.getByRole("columnheader", { name: "Key" });
    expect(th.className).toContain("text-label-sm");
    expect(th.className).toContain("text-text-sub");
    expect(th.className).not.toContain("uppercase");
    expect(screen.getByRole("cell", { name: "API_KEY" }).className).toContain("text-text-strong");
  });
});

describe("Sheet", () => {
  it("sheet renders title, body and footer with bg-bg-weak footer", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New project</SheetTitle>
            <SheetDescription>Create a project.</SheetDescription>
          </SheetHeader>
          <SheetBody>Fields</SheetBody>
          <SheetFooter>Buttons</SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByText("New project").className).toContain("text-label-md");
    expect(screen.getByText("Fields").className).toContain("p-6");
    expect(screen.getByText("Buttons").className).toContain("bg-bg-weak");
  });
});

describe("Motion", () => {
  const slot = (name: string) =>
    document.querySelector(`[data-slot="${name}"]`)?.className ?? `missing ${name}`;

  it("overlays animate in and out", () => {
    render(
      <>
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
        <Popover open>
          <PopoverTrigger>Open popover</PopoverTrigger>
          <PopoverContent>Popover</PopoverContent>
        </Popover>
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipProvider>
          <TooltipRoot open>
            <TooltipTrigger>Hover</TooltipTrigger>
            <TooltipContent>Tip</TooltipContent>
          </TooltipRoot>
        </TooltipProvider>
      </>,
    );
    for (const name of ["dialog-content", "popover-content", "dropdown-menu-content"]) {
      expect(slot(name), name).toMatch(/data-\[state=open\]:animate-in/);
      expect(slot(name), name).toMatch(/data-\[state=closed\]:animate-out/);
    }
    expect(slot("tooltip-content")).toMatch(/data-\[state=delayed-open\]:animate-in/);
    expect(slot("tooltip-content")).toMatch(/data-\[state=closed\]:animate-out/);
  });

  it("the sheet slides in and out", () => {
    render(
      <Sheet open>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle>Sheet</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(slot("sheet-content")).toMatch(/data-\[state=open\]:slide-in-from-right/);
    expect(slot("sheet-content")).toMatch(/data-\[state=closed\]:slide-out-to-right/);
  });

  it("the select menu animates in and out", () => {
    render(
      <Select open value="a">
        <SelectTrigger aria-label="Pick">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(slot("select-content")).toMatch(/data-\[state=open\]:animate-in/);
    expect(slot("select-content")).toMatch(/data-\[state=closed\]:animate-out/);
  });

  it("rows transition their hover color", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const row = screen.getByRole("row");
    expect(row.className).toContain("transition-colors");
    expect(row.className).toContain("duration-150");
    expect(row.parentElement?.className).toMatch(/\[&>tr\]:animate-in/);
  });
});

describe("Input", () => {
  it("input invalid uses ring-error-base", () => {
    render(<Input aria-label="Name" invalid />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.closest("[data-slot=input]")?.className).toContain("ring-error-base");
  });
});
