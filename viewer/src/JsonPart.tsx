import { useState } from "react";
import type { JsonPart as JsonPartData } from "./api.ts";

export function JsonPart(props: { part: JsonPartData }) {
  return (
    <div className="jsonpart">
      <JsonNode value={props.part.data} depth={0} />
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
      <span className="json-empty">
        {openCh}
        {closeCh}
      </span>
    );
  }

  return (
    <>
      <span className="json-toggle" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {openCh}
      </span>
      {open ? (
        <span className="json-children">
          {entries.map(([key, val], i) => (
            <span className="json-child" key={key}>
              {!isArray ? (
                <>
                  <span className="json-key">"{key}"</span>
                  <span className="json-colon">: </span>
                </>
              ) : null}
              <JsonNode value={val} depth={props.depth + 1} />
              {i < entries.length - 1 ? <span className="json-comma">,</span> : null}
            </span>
          ))}
          <span className="json-close">{closeCh}</span>
        </span>
      ) : (
        <span className="json-summary">
          {" "}
          {summary} {closeCh}
        </span>
      )}
    </>
  );
}

function Primitive(props: { value: unknown }) {
  const type = (): string => {
    if (props.value === null) return "null";
    if (typeof props.value === "string") return "string";
    if (typeof props.value === "number") return "number";
    if (typeof props.value === "boolean") return "boolean";
    return "other";
  };
  const display = (): string => {
    if (props.value === null) return "null";
    if (typeof props.value === "string") return `"${props.value}"`;
    return String(props.value);
  };

  return <span className={`json-value json-${type()}`}>{display()}</span>;
}
