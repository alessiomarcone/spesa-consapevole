import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaRoot = resolve(here, "../schemas/v1");
const supportedDocuments = new Set([
  "household",
  "needs",
  "catalog",
  "store-quote",
  "decision",
  "plan",
]);
const validators = new Map();

const ajv = new Ajv2020({ allErrors: true, strict: true, multipleOfPrecision: 6 });
ajv.addFormat("date-time", {
  type: "string",
  validate(value) {
    return !Number.isNaN(Date.parse(value)) && /[zZ]|[+-]\d\d:\d\d$/.test(value);
  },
});

export class SchemaValidationError extends Error {
  constructor(kind, errors) {
    const details = errors
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    super(`${kind} v1 validation failed: ${details}`);
    this.name = "SchemaValidationError";
    this.kind = kind;
    this.errors = errors;
  }
}

async function validatorFor(kind) {
  if (!supportedDocuments.has(kind)) {
    throw new TypeError(`Unsupported document kind: ${kind}`);
  }
  if (!validators.has(kind)) {
    const schema = JSON.parse(await readFile(resolve(schemaRoot, `${kind}.schema.json`), "utf8"));
    validators.set(kind, ajv.compile(schema));
  }
  return validators.get(kind);
}

export async function validateDocument(kind, document) {
  const validate = await validatorFor(kind);
  if (!validate(document)) {
    throw new SchemaValidationError(kind, structuredClone(validate.errors ?? []));
  }
  return document;
}
