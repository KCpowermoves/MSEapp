"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface MultiProps {
  multi: true;
  label?: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}

interface SingleProps {
  multi?: false;
  label?: string;
  options: string[];
  value: string | null;
  onChange: (next: string) => void;
}

type Props = MultiProps | SingleProps;

export function CrewPicker(props: Props) {
  const { options, label } = props;

  if (options.length === 0) {
    return (
      <div className="text-sm text-mse-muted">
        No active techs. Add techs to the Sheet first.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label && (
        <div className="text-sm font-semibold text-mse-navy">{label}</div>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((name) => {
          const active =
            props.multi
              ? props.value.includes(name)
              : props.value === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => {
                if (props.multi) {
                  const next = active
                    ? props.value.filter((n) => n !== name)
                    : [...props.value, name];
                  props.onChange(next);
                } else {
                  props.onChange(name);
                }
              }}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 h-11 rounded-full font-medium text-sm transition-[background-color,transform]",
                "active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
                active
                  ? "bg-mse-navy text-white"
                  : "bg-white border border-mse-light text-mse-navy hover:border-mse-navy/40"
              )}
            >
              {active && <Check className="w-4 h-4" />}
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
