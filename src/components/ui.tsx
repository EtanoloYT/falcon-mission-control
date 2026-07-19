"use client";

import * as React from "react";

import { twMerge } from "tailwind-merge";

import { cn } from "@/lib/utils";

export type ButtonVariant = "default" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

const BUTTON_SIZES: readonly ButtonSize[] = ["sm", "md", "icon"];

function isButtonSize(value: string): value is ButtonSize {
  return (BUTTON_SIZES as readonly string[]).includes(value);
}

/**
 * Builds the class string for a button-styled element.
 *
 * Backward-tolerant overloads:
 *   buttonClassName()
 *   buttonClassName("ghost")
 *   buttonClassName("ghost", "sm")
 *   buttonClassName("ghost", "px-2 py-1 text-xs")           // legacy: 2nd arg as className
 *   buttonClassName("ghost", "sm", "px-2 py-1 text-xs")
 */
export function buttonClassName(
  variant: ButtonVariant = "default",
  sizeOrClassName?: ButtonSize | string,
  className?: string
) {
  let size: ButtonSize = "md";
  let extraClassName = className;

  if (sizeOrClassName !== undefined) {
    if (isButtonSize(sizeOrClassName)) {
      size = sizeOrClassName;
    } else {
      extraClassName = sizeOrClassName;
    }
  }

  return twMerge(
    "inline-flex items-center justify-center gap-2 shrink-0 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50",
    size === "md" && "h-9 px-3 text-sm",
    size === "sm" && "h-8 px-2.5 text-xs",
    size === "icon" && "h-9 w-9 p-0",
    variant === "default" && "bg-amber-500 text-black hover:bg-amber-400",
    variant === "ghost" && "bg-transparent text-zinc-200 hover:bg-zinc-900",
    variant === "outline" && "border border-zinc-800 bg-zinc-950 text-zinc-100 hover:bg-zinc-900",
    variant === "danger" && "border border-red-900 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300",
    extraClassName
  );
}

export function Button({
  className,
  variant = "default",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button className={buttonClassName(variant, size, className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-zinc-800 bg-zinc-950/80 shadow-[0_0_0_1px_rgba(0,0,0,0.1)]", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-zinc-800 px-4 py-3", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4", className)} {...props} />;
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-300", className)} {...props} />;
}

const FIELD_BASE =
  "w-full rounded-md border border-zinc-800 bg-zinc-950 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-500 focus-visible:ring-1 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={twMerge(FIELD_BASE, "h-9 px-3", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={twMerge(FIELD_BASE, "min-h-20 px-3 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={twMerge(FIELD_BASE, "h-9 appearance-none px-3", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs uppercase tracking-[0.16em] text-zinc-500", className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-zinc-900/70", className)} />;
}

export function Modal({
  open,
  title,
  children,
  footer,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button className={buttonClassName("ghost", "sm")} onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-4">{children}</div>
        {footer ? <div className="border-t border-zinc-800 px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  title,
  children,
  footer,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" role="dialog" aria-modal="true">
      <div className="flex h-full w-full max-w-xl flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button className={buttonClassName("ghost", "sm")} onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <div className="border-t border-zinc-800 px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
