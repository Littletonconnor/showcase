import { useState } from "react";
import type { JsonPart as JsonPartData } from "./api.ts";

export function JsonPart(props: { part: JsonPartData }) {
  return (
    <div className="overflow-x-auto border-t-[0.5px] border-border px-3.5 pt-2.5 pb-3 font-mono text-[13px]/[1.5]">
      <div className="whitespace-pre-wrap">
        <JsonNode value={props.part.data} depth={0} />
      </div>
    </div>
  );
}

function JsonNode(props: { value: unknown; depth: number }) {
  const isContainer = typeof props.value === "object" && props.value !== null;
  return isContainer ? (
    <Container value={props.value as object} depth={props.depth} />
  ) : (
    <Primitive value={props.value} />
  );
}

type Entry = readonly [string, unknown];

function Container(props: { value: object; depth: number }) {
  const [open, setOpen] = useState(props.depth === 0);
  const isArray = Array.isArray(props.value);
  const entries: Entry[] = isArray
    ? (props.value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(props.value as Record<string, unknown>);
  const count = entries.length;
  const openCh = isArray ? "[" : "{";
  const closeCh = isArray ? "]" : "}";
  const summary = isArray
    ? `${count} item${count === 1 ? "" : "s"}`
    : `${count} key${count === 1 ? "" : "s"}`;

  if (count === 0) {
    return (
      <span className="text-faint">
        {openCh}
        {closeCh}
      </span>
    );
  }

  return (
    <>
      <span
        className="cursor-pointer whitespace-nowrap text-faint select-none hover:text-muted-foreground"
        onClick={() => setOpen(!open)}
      >
        {open ? "▾" : "▸"} {openCh}
      </span>
      {open ? (
        <span className="block pl-[18px]">
          {entries.map(([key, val], i) => (
            <span className="block" key={key}>
              {!isArray ? (
                <>
                  <span className="text-foreground">"{key}"</span>
                  <span className="text-faint">: </span>
                </>
              ) : null}
              <JsonNode value={val} depth={props.depth + 1} />
              {i < entries.length - 1 ? <span className="text-faint">,</span> : null}
            </span>
          ))}
          <span className="block">{closeCh}</span>
        </span>
      ) : (
        <span className="text-faint">
          {" "}
          {summary} {closeCh}
        </span>
      )}
    </>
  );
}

function Primitive(props: { value: unknown }) {
  const className = (): string => {
    if (props.value === null) return "text-faint";
    if (typeof props.value === "string") return "text-muted-foreground";
    if (typeof props.value === "number" || typeof props.value === "boolean") return "text-brand";
    return "";
  };
  const display = (): string => {
    if (props.value === null) return "null";
    if (typeof props.value === "string") return `"${props.value}"`;
    return String(props.value);
  };

  return <span className={`break-all whitespace-pre-wrap ${className()}`}>{display()}</span>;
}
