// Minimal YAML serializer for the spec tab. Agent configs are shallow and
// well-typed, so we avoid a dependency and render them deterministically.
function scalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (text === "") return '""';

  return JSON.stringify(text);
}

function render(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`.trimStart();
    return value
      .map((item) => {
        if (item !== null && typeof item === "object") {
          return `${pad}-\n${render(item, indent + 1)}`;
        }
        return `${pad}- ${scalar(item)}\n`;
      })
      .join("");
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => {
        if (Array.isArray(child) && child.length === 0) return `${pad}${key}: []\n`;
        if (Array.isArray(child) && child.length > 0) {
          return `${pad}${key}:\n${render(child, indent)}`;
        }
        if (child !== null && typeof child === "object" && !Array.isArray(child)) {
          return `${pad}${key}:\n${render(child, indent + 1)}`;
        }
        if (typeof child === "string" && child.includes("\n")) {
          const block = child
            .split("\n")
            .map((line) => `${"  ".repeat(indent + 1)}${line}`)
            .join("\n");
          return `${pad}${key}: |\n${block}\n`;
        }
        return `${pad}${key}: ${scalar(child)}\n`;
      })
      .join("");
  }

  return `${pad}${scalar(value)}\n`;
}

export function toYaml(value: unknown): string {
  return render(value, 0).trimEnd() + "\n";
}
