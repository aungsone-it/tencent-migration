import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "./ui/utils";
import type { Language } from "../contexts/language-core";
import {
  getMyanmarRegionLabel,
  getMyanmarTownshipLabel,
  getMyanmarTownshipSearchTerms,
} from "../utils/myanmarRegionLabels";

type MyanmarSearchableSelectProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  searchPlaceholder: string;
  emptyText: string;
  className?: string;
  language: Language;
  kind: "region" | "township";
};

export function MyanmarSearchableSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  disabled = false,
  searchPlaceholder,
  emptyText,
  className,
  language,
  kind,
}: MyanmarSearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchKey, setSearchKey] = useState(0);

  const getLabel = (option: string) =>
    kind === "region"
      ? getMyanmarRegionLabel(option, language)
      : getMyanmarTownshipLabel(option, language);

  const selectedLabel = value ? getLabel(value) : "";

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearchKey((k) => k + 1);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal", className)}
        >
          <span className={cn("truncate text-left", !value && "text-slate-500")}>
            {selectedLabel || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command key={searchKey}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={
                    kind === "township"
                      ? getMyanmarTownshipSearchTerms(option, language)
                      : `${option} ${getLabel(option)}`
                  }
                  onSelect={() => {
                    onValueChange(option);
                    handleOpenChange(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === option ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{getLabel(option)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
