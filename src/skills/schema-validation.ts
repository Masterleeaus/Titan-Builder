export interface ObjectSchemaIssue {
  path: string;
  message: string;
}

export type ObjectSchemaValidationResult =
  | { success: true; issues: [] }
  | { success: false; issues: ObjectSchemaIssue[] };

type JsonObject = Record<string, unknown>;

export function validateObjectSchema(
  value: unknown,
  schema: Record<string, unknown>,
): ObjectSchemaValidationResult {
  const issues: ObjectSchemaIssue[] = [];
  if (!isObject(value)) {
    return {
      success: false,
      issues: [{ path: '$', message: 'Value must be an object.' }],
    };
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  const properties = isObject(schema.properties) ? schema.properties : {};

  for (const property of required) {
    if (!Object.prototype.hasOwnProperty.call(value, property)) {
      issues.push({ path: `$.${property}`, message: 'Required property is missing.' });
    }
  }

  if (schema.additionalProperties === false) {
    for (const property of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, property)) {
        issues.push({ path: `$.${property}`, message: 'Additional property is not allowed.' });
      }
    }
  }

  for (const [property, propertySchema] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(value, property) || !isObject(propertySchema)) continue;
    const expectedType = propertySchema.type;
    if (typeof expectedType !== 'string') continue;
    if (!matchesType(value[property], expectedType)) {
      issues.push({
        path: `$.${property}`,
        message: `Property must be of type ${expectedType}.`,
      });
    }
  }

  return issues.length === 0
    ? { success: true, issues: [] }
    : { success: false, issues };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function matchesType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    default:
      return true;
  }
}
