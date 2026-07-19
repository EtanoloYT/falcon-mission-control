"use client";

import { Fragment, type ReactNode } from "react";

function formatInline(value: string) {
  return value
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function Markdown({ value }: { value: string }) {
  const lines = value.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let inCode = false;
  let codeBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) {
      return;
    }

    nodes.push(
      <ul key={`list-${nodes.length}`} className="ml-4 list-disc space-y-1 text-sm text-zinc-300">
        {listBuffer.map((item, index) => (
          <li key={index} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
        ))}
      </ul>
    );
    listBuffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        nodes.push(
          <pre key={`code-${nodes.length}`} className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-200">
            <code>{codeBuffer.join("\n")}</code>
          </pre>
        );
        codeBuffer = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (line.startsWith("# ")) {
      flushList();
      nodes.push(
        <h1 key={`h1-${nodes.length}`} className="mt-4 text-2xl font-semibold text-zinc-50">
          {line.slice(2)}
        </h1>
      );
      continue;
    }

    if (line.startsWith("## ")) {
      flushList();
      nodes.push(
        <h2 key={`h2-${nodes.length}`} className="mt-4 text-lg font-semibold text-zinc-100">
          {line.slice(3)}
        </h2>
      );
      continue;
    }

    if (line.startsWith("- ")) {
      listBuffer.push(line.slice(2));
      continue;
    }

    flushList();
    if (line.trim()) {
      nodes.push(
        <p key={`p-${nodes.length}`} className="text-sm leading-6 text-zinc-300" dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
      );
    }
  }

  flushList();

  return <div className="space-y-3">{nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>)}</div>;
}
